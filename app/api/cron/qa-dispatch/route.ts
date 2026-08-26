import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { dispatchQaCandidate } from '@/lib/qa/dispatch';
import { QA_PSADT_TOOLCHAIN, validateCurrentQaPackageProfile } from '@/lib/qa/package-profile';
import { getQaPipelineControl, isQaPackagerReleaseReady } from '@/lib/qa/pipeline-control';
import { qaTimeoutRecoveryUpdate } from '@/lib/qa/recovery';
import { InstallerPreflightError } from '@/lib/installer-preflight';
import { isQaRunnerArchitectureSupported } from '@/lib/qa/candidate';
import { getGitHubActionsHealth } from '@/lib/qa/github-actions-health';

const DISPATCH_TIMEOUT_MS = 15 * 60 * 1000;
const RUN_TIMEOUT_MS = 5 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 2;
const QUEUE_SCAN_PAGE_SIZE = 100;
const MAX_QUEUE_SCAN_PAGES = 10;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function queueCursor(candidate: {
  id: unknown;
  priority: unknown;
  enqueued_at: unknown;
}): { priority: number; enqueuedAt: string; id: string } | null {
  if (!Number.isInteger(candidate.priority)) return null;
  if (typeof candidate.id !== 'string' || !UUID_PATTERN.test(candidate.id)) return null;
  if (
    typeof candidate.enqueued_at !== 'string' ||
    !candidate.enqueued_at ||
    Number.isNaN(Date.parse(candidate.enqueued_at))
  ) {
    return null;
  }
  return {
    priority: candidate.priority as number,
    enqueuedAt: candidate.enqueued_at,
    id: candidate.id,
  };
}

function postgrestQuoted(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const control = await getQaPipelineControl(supabase);
  if (control.paused) {
    return NextResponse.json({
      success: true,
      dispatched: false,
      reason: 'maintenance_paused',
      maintenanceReason: control.reason,
      pausedAt: control.updatedAt,
    });
  }
  if (!isQaPackagerReleaseReady(control, QA_PSADT_TOOLCHAIN.packagerCommit)) {
    return NextResponse.json({
      success: true,
      dispatched: false,
      reason: 'packager_release_pending',
    });
  }
  const githubActions = await getGitHubActionsHealth();
  if (!githubActions.operational) {
    return NextResponse.json({
      success: true,
      dispatched: false,
      reason: 'github_actions_unavailable',
      githubActionsStatus: githubActions.status,
    });
  }
  const now = new Date();
  const { data: active, error: activeError } = await supabase
    .from('qa_candidates')
    .select('*')
    .eq('test_level', 'psadt-package')
    .in('status', ['dispatched', 'running']);
  if (activeError) throw new Error(`Could not reconcile QA candidates: ${activeError.message}`);

  let reconciled = 0;
  for (const candidate of active || []) {
    const timestamp = candidate.status === 'running' ? candidate.started_at : candidate.dispatched_at;
    const timeout = candidate.status === 'running' ? RUN_TIMEOUT_MS : DISPATCH_TIMEOUT_MS;
    if (timestamp && now.getTime() - new Date(timestamp).getTime() <= timeout) continue;

    const recovery = qaTimeoutRecoveryUpdate(candidate, now.toISOString(), MAX_ATTEMPTS);
    const { error } = await supabase
      .from('qa_candidates')
      .update(recovery)
      .eq('id', candidate.id)
      .eq('status', candidate.status);
    if (error) throw error;
    reconciled++;
  }

  const { data: stillActive, error: stillActiveError } = await supabase
    .from('qa_candidates')
    .select('id')
    .eq('test_level', 'psadt-package')
    .in('status', ['dispatched', 'running'])
    .limit(1);
  if (stillActiveError) throw stillActiveError;
  if (stillActive?.length) {
    return NextResponse.json({ success: true, dispatched: false, reason: 'qa_active', reconciled });
  }

  let cursor: { priority: number; enqueuedAt: string; id: string } | null = null;
  let scanned = 0;
  let superseded = 0;
  let lastInstallerQuarantine: { candidateId: string; code: string } | null = null;
  let lastInstallerUnavailable: {
    candidateId: string;
    code: string;
    attempts: number;
    exhausted: boolean;
  } | null = null;
  const supersededAt = new Date().toISOString();

  for (let pageIndex = 0; pageIndex < MAX_QUEUE_SCAN_PAGES; pageIndex++) {
    let queueQuery = supabase
      .from('qa_candidates')
      .select(
        'id, winget_id, version, architecture, installer_sha256, package_profile_sha256, test_config, priority, enqueued_at, attempts'
      )
      .eq('test_level', 'psadt-package')
      .eq('status', 'queued')
      .order('priority', { ascending: false })
      .order('enqueued_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(QUEUE_SCAN_PAGE_SIZE);
    if (cursor) {
      const enqueuedAt = postgrestQuoted(cursor.enqueuedAt);
      const id = postgrestQuoted(cursor.id);
      queueQuery = queueQuery.or(
        `priority.lt.${cursor.priority},and(priority.eq.${cursor.priority},enqueued_at.gt.${enqueuedAt}),and(priority.eq.${cursor.priority},enqueued_at.eq.${enqueuedAt},id.gt.${id})`
      );
    }

    const { data: page, error: queueError } = await queueQuery;
    if (queueError) throw queueError;
    if (!page?.length) break;
    scanned += page.length;

    const eligible = [];
    const invalidByReason = new Map<string, string[]>();
    const addInvalid = (reason: string, id: string) => {
      const ids = invalidByReason.get(reason) || [];
      ids.push(id);
      invalidByReason.set(reason, ids);
    };
    for (const candidate of page) {
      if (!queueCursor(candidate)) {
        addInvalid('queue-metadata-invalid', candidate.id);
        continue;
      }
      if (!isQaRunnerArchitectureSupported(candidate.architecture)) {
        addInvalid('runner-architecture-unsupported', candidate.id);
        continue;
      }
      const validation = validateCurrentQaPackageProfile({
        testConfig: candidate.test_config,
        candidatePackageProfileSha256: candidate.package_profile_sha256,
        candidateWingetId: candidate.winget_id,
        candidateVersion: candidate.version,
        candidateArchitecture: candidate.architecture,
        candidateInstallerSha256: candidate.installer_sha256,
      });
      if (validation.valid) {
        eligible.push(candidate);
        continue;
      }
      addInvalid(validation.reason, candidate.id);
    }

    for (const [reason, ids] of invalidByReason) {
      const { data: updated, error: supersedeError } = await supabase
        .from('qa_candidates')
        .update({
          status: 'superseded',
          finished_at: supersededAt,
          failure_summary: `Superseded before dispatch: ${reason}.`,
          updated_at: supersededAt,
        })
        .in('id', ids)
        .eq('status', 'queued')
        .select('id');
      if (supersedeError) throw supersedeError;
      superseded += updated?.length || 0;
    }

    let nextCursor: { priority: number; enqueuedAt: string; id: string } | null = null;
    for (let index = page.length - 1; index >= 0; index--) {
      nextCursor = queueCursor(page[index]);
      if (nextCursor) break;
    }
    if (!nextCursor) {
      return NextResponse.json({
        success: true,
        dispatched: false,
        reason: 'queue_metadata_invalid',
        reconciled,
        scanned,
        superseded,
      });
    }
    cursor = nextCursor;

    for (const candidate of eligible) {
      const dispatchedAt = new Date().toISOString();
      const { data: claimed, error: claimError } = await supabase
        .from('qa_candidates')
        .update({
          status: 'dispatched',
          attempts: candidate.attempts + 1,
          dispatched_at: dispatchedAt,
          phase: null,
          phase_started_at: null,
          phase_updated_at: null,
          failure_summary: null,
          updated_at: dispatchedAt,
        })
        .eq('id', candidate.id)
        .eq('status', 'queued')
        .select('*')
        .maybeSingle();
      if (claimError?.code === '23505') {
        return NextResponse.json({
          success: true,
          dispatched: false,
          reason: 'claim_lost',
          reconciled,
          scanned,
          superseded,
        });
      }
      if (claimError) throw claimError;
      // A lost compare-and-set means another dispatcher is already making
      // progress. Do not move on to a second row and violate single-flight QA.
      if (!claimed) {
        return NextResponse.json({
          success: true,
          dispatched: false,
          reason: 'claim_lost',
          reconciled,
          scanned,
          superseded,
        });
      }

      try {
        await dispatchQaCandidate(claimed);
        return NextResponse.json({
          success: true,
          dispatched: true,
          candidateId: claimed.id,
          reconciled,
          scanned,
          superseded,
        });
      } catch (error) {
        console.error(`QA dispatch failed for candidate ${claimed.id}:`, error);
        if (error instanceof InstallerPreflightError && !error.retryable) {
          const quarantinedAt = new Date().toISOString();
          const summary = `Installer source quarantined before QA: ${error.code}. ${error.message}`
            .slice(0, 1000);
          const { data: quarantinedRows, error: quarantineError } = await supabase
            .from('qa_candidates')
            .update({
              status: 'superseded',
              finished_at: quarantinedAt,
              phase: 'preparing_package',
              phase_started_at: claimed.dispatched_at || quarantinedAt,
              phase_updated_at: quarantinedAt,
              failure_summary: summary,
              updated_at: quarantinedAt,
            })
            .in('id', [claimed.id])
            .eq('status', 'dispatched')
            .select('id');
          if (quarantineError) throw quarantineError;
          superseded += quarantinedRows?.length || 0;
          lastInstallerQuarantine = {
            candidateId: claimed.id,
            code: error.code,
          };
          // A deterministic bad tuple must not consume the entire dispatch
          // tick. Continue scanning the already-validated queue page so one
          // high-priority candidate cannot starve unrelated applications.
          continue;
        }
        if (error instanceof InstallerPreflightError && error.retryable) {
          const deferredAt = new Date().toISOString();
          const attempts = Number.isInteger(claimed.attempts)
            ? claimed.attempts
            : candidate.attempts + 1;
          const exhausted = attempts >= MAX_ATTEMPTS;
          const { error: deferError } = await supabase
            .from('qa_candidates')
            .update(exhausted
              ? {
                  status: 'error',
                  attempts,
                  finished_at: deferredAt,
                  phase: null,
                  phase_started_at: null,
                  phase_updated_at: null,
                  failure_summary:
                    `The installer source remained unavailable after ${attempts} verification attempts. The app was not tested.`,
                  updated_at: deferredAt,
                }
              : {
                  status: 'queued',
                  attempts,
                  enqueued_at: deferredAt,
                  dispatched_at: null,
                  phase: null,
                  phase_started_at: null,
                  phase_updated_at: null,
                  failure_summary:
                    'The installer source is temporarily unavailable; retry scheduled behind other queued apps.',
                  updated_at: deferredAt,
                })
            .eq('id', claimed.id)
            .eq('status', 'dispatched');
          if (deferError) throw deferError;
          lastInstallerUnavailable = {
            candidateId: claimed.id,
            code: error.code,
            attempts,
            exhausted,
          };
          console.warn('QA installer preflight deferred', lastInstallerUnavailable);
          // A transient publisher/CDN response must not block unrelated apps.
          // Move the candidate behind the current queue (or terminate after the
          // bounded retry limit) and continue within this dispatch tick.
          continue;
        }
        await supabase
          .from('qa_candidates')
          .update({
            status: 'queued',
            attempts: candidate.attempts,
            dispatched_at: null,
            phase: null,
            phase_started_at: null,
            phase_updated_at: null,
            failure_summary: 'The installation test could not start; retry scheduled.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', claimed.id)
          .eq('status', 'dispatched');
        throw error;
      }
    }

    if (page.length < QUEUE_SCAN_PAGE_SIZE) break;
  }

  return NextResponse.json({
    success: true,
    dispatched: false,
    reason: lastInstallerQuarantine
      ? 'installer_quarantined'
      : lastInstallerUnavailable
        ? 'installer_unavailable'
      : scanned >= QUEUE_SCAN_PAGE_SIZE * MAX_QUEUE_SCAN_PAGES
        ? 'scan_limit'
        : 'queue_empty',
    ...(lastInstallerQuarantine || {}),
    ...(lastInstallerUnavailable || {}),
    reconciled,
    scanned,
    superseded,
  });
}

/** Operator recovery for a terminal infrastructure error; protected by CRON_SECRET. */
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { candidateId?: string } | null;
  if (!body?.candidateId || !/^[0-9a-fA-F-]{36}$/.test(body.candidateId)) {
    return NextResponse.json({ error: 'A candidate UUID is required' }, { status: 400 });
  }

  const supabase = createServerClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('qa_candidates')
    .update({
      status: 'queued',
      attempts: 0,
      dispatched_at: null,
      started_at: null,
      finished_at: null,
      github_run_id: null,
      github_run_url: null,
      phase: null,
      phase_started_at: null,
      phase_updated_at: null,
      failure_summary: null,
      updated_at: now,
    })
    .eq('id', body.candidateId)
    .eq('test_level', 'psadt-package')
    .in('status', ['error', 'superseded'])
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return NextResponse.json({ error: 'Candidate is not retryable' }, { status: 409 });
  }
  return NextResponse.json({ success: true, candidateId: data.id });
}

// Installer preflight downloads and hashes the exact vendor payload before
// dispatching a runner job. Large installers need the same bounded function
// window as the customer packaging route; otherwise the function can be
// terminated after claiming a candidate but before GitHub receives a run.
export const maxDuration = 300;
