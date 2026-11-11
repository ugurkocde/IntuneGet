import { loadInstallerSecurityHolds, installerSecurityReason } from '@/lib/qa/installer-security-holds';
import { isQaMaintenanceMode } from '@/lib/qa/maintenance';
import { reopenSupersededQaFailures } from '@/lib/qa/customer-failure-recovery';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { dispatchRateLimitHold, WorkflowDispatchRateLimitError, WorkflowDispatchUnconfirmedError } from '@/lib/workflow-dispatch-rate-limit';
import { unsupportedDependencyMessage, knownUnavailableDisposition, isExactPretestCandidate } from '@/lib/unsupported-dependency';
import { findPendingApprovalBlocks, type IntuneApprovalBlock } from '@/lib/intune-approval-guard';
import { createServerClient } from '@/lib/supabase';
import { getFeatureFlags } from '@/lib/features';
import { getAppConfig } from '@/lib/config';
import { buildIntuneAppDescription } from '@/lib/intune-description';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { triggerPackagingWorkflow, type WorkflowInputs } from '@/lib/github-actions';
import { assertCuratedLicenceAccepted, CuratedLicenceError } from '@/lib/curated-catalog/licence';
import { handleAutoUpdateJobCompletion } from '@/lib/auto-update/cleanup';
import { ensureQaDemand } from '@/lib/qa/demand';
import { isDeferredCustomerQaEnabled } from '@/lib/qa/continuity';
import { QA_PRIORITY_CUSTOMER, QA_PRIORITY_DEMAND } from '@/lib/qa/constants';
import { InstallerPreflightError } from '@/lib/installer-preflight';
import { reconcileCatalogInstaller } from '@/lib/catalog-installer-reconciliation';
import { getPackageCompatibilityBlock, PACKAGE_VERSION_UNAVAILABLE_MESSAGE } from '@/lib/package-eligibility';
import { enforceQaGate, describeQaGateError, QaGateError, QaGateNotPassedError, QaSecurityGateError, QaCompatibilityGateError } from '@/lib/qa/gate';
import { CuratedCatalogError, CuratedEvidenceMismatchError } from '@/lib/curated-catalog/core.mjs';
import type { Win32CartItem } from '@/types/upload';
import type { Json } from '@/types/database';
import { holdCustomerUpstreamJob, reopenCustomerUpstreamJobs } from '@/lib/customer-upstream-recovery';

const RESUME_BATCH_SIZE = 25;
const MANIFEST_FAILURE_MESSAGE = 'The selected package could not be validated. Review your selection before trying again.';
const TERMINAL_MANIFEST_CODES = new Set(['MANIFEST_UNAVAILABLE', 'INSTALLER_TYPE_UNAVAILABLE', 'INSTALL_SCOPE_UNAVAILABLE', 'SILENT_INSTALL_UNAVAILABLE']);
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const approvalSignal = AbortSignal.timeout(40_000);
  const probeBudget = { remaining: 20 };
  const approvalCache = new Map<string, IntuneApprovalBlock[]>();
  const waitingIds: string[] = [];
  const supabase = createServerClient();
  const { data: jobs, error: jobsError } = await supabase
    .from('packaging_jobs')
    .select('*')
    .eq('status', 'awaiting_qa')
    .lte('qa_resume_due_at', new Date(startedAt).toISOString())
    .order('qa_resume_due_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(RESUME_BATCH_SIZE);
  if (jobsError) throw new Error(`Could not read QA-waiting jobs: ${jobsError.message}`);

  const features = getFeatureFlags();
  const config = getAppConfig();
  const baseUrl = config.app.url || (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000');
  const callbackUrl = `${baseUrl}/api/package/callback`;
  let resumed = 0;
  let failed = 0;
  let waiting = 0;
  let held = 0;
  let deferred = 0;
  let budgetExhausted = false;
  let visited = 0;

  for (const job of jobs || []) {
    if (Date.now() - startedAt >= 45_000) {
      budgetExhausted = true;
      deferred += (jobs?.length || 0) - visited;
      break;
    }
    visited++;
    try {
      if (await holdCustomerUpstreamJob(supabase, job)) { held++; continue; }
    } catch {
      waitingIds.push(job.id); waiting++; continue;
    }
    const skipCustomerQa = !job.is_auto_update && isQaMaintenanceMode();
    let item = job.package_config as unknown as Win32CartItem;
    // Automatic updates store detection rules on the job, while cart jobs
    // carry them inside package_config. Preserve an explicit cart choice.
    if (job.is_auto_update && item && item.detectionRules == null && job.detection_rules != null) {
      item = { ...item, detectionRules: job.detection_rules as unknown as Win32CartItem['detectionRules'] };
    }
    let observed = {
      qa_candidate_id: job.qa_candidate_id,
      installer_sha256: job.installer_sha256,
      architecture: job.architecture,
      package_config: job.package_config,
    };
    let candidate: {
      id: string;
      status: string;
      phase: string | null;
      github_run_id: string | null;
      failure_summary: string | null;
      package_profile_sha256: string | null;
      winget_id: string | null; version: string | null; architecture: string | null; installer_sha256: string | null;
    } | null = null;
    if (job.qa_candidate_id && !skipCustomerQa) {
      const { data, error: candidateError } = await supabase
        .from('qa_candidates')
        .select('id, status, phase, github_run_id, failure_summary, package_profile_sha256, winget_id, version, architecture, installer_sha256')
        .eq('id', job.qa_candidate_id)
        .maybeSingle();
      if (candidateError) throw candidateError;
      candidate = data;
    }

    let candidateStatus = candidate?.status;
    let candidateFailureSummary = candidate?.failure_summary;
    let appVersionAlreadyPassed = false;
    let demandWasEvaluated = false;

    if (!skipCustomerQa && (!candidate || candidateStatus === 'superseded')) {
      // A waiting job can outlive the catalog metadata and packager revision
      // that created it. Reconcile the exact version against the trusted live
      // manifest before rebuilding QA demand, then persist that refreshed
      // execution input so the eventual customer package uses the same
      // installer command that passed in the VM. Explicit PSADT command
      // overrides remain authoritative inside reconcileCatalogInstaller.
      if (item.sourceType !== 'custom') {
        try {
          const reconciled = await reconcileCatalogInstaller({
            ...item,
            wingetId: job.winget_id,
            displayName: job.display_name || item.displayName,
            publisher: job.publisher || item.publisher,
            version: job.version,
            architecture: (job.architecture || item.architecture) as Win32CartItem['architecture'],
            installerUrl: job.installer_url || item.installerUrl,
            installerSha256: job.installer_sha256 || item.installerSha256,
            installerType: (job.installer_type || item.installerType) as Win32CartItem['installerType'],
            installCommand: job.install_command || item.installCommand,
            uninstallCommand: job.uninstall_command || item.uninstallCommand,
            installScope: (job.install_scope || item.installScope) as Win32CartItem['installScope'],
          });
          item = reconciled.item;
        } catch (error) {
          const terminal = error instanceof InstallerPreflightError && !error.retryable && TERMINAL_MANIFEST_CODES.has(error.code);
          if (!terminal) {
            waitingIds.push(job.id); waiting++; continue;
          }
          // Fail only this unchanged execution input. Never expose producer text,
          // or overwrite a cancellation, relink, or concurrently dispatched job.
          let update = supabase.from('packaging_jobs').update({
            status: 'qa_failed', status_message: MANIFEST_FAILURE_MESSAGE,
            error_message: MANIFEST_FAILURE_MESSAGE, error_code: error.code,
            error_stage: 'validation', error_category: 'installer',
            completed_at: new Date().toISOString(),
          }).eq('id', job.id).eq('status', 'awaiting_qa')
            .eq('updated_at', job.updated_at).eq('winget_id', job.winget_id).eq('version', job.version)
            .is('cancelled_at', null).is('archived_at', null).is('github_run_id', null).is('intune_app_id', null);
          for (const [field, value] of [
            ['qa_candidate_id', job.qa_candidate_id], ['installer_url', job.installer_url],
            ['installer_sha256', job.installer_sha256], ['architecture', job.architecture],
            ['package_config->>installerSha256', item.installerSha256], ['package_config->>architecture', item.architecture],
          ] as const) update = value == null ? update.is(field, null) : update.eq(field, value);
          const result = await update.select('id').maybeSingle();
          if (result.error) { waitingIds.push(job.id); waiting++; continue; }
          if (result.data) {
            failed++;
            await handleAutoUpdateJobCompletion(job.id, 'failed', MANIFEST_FAILURE_MESSAGE);
          }
          continue;
        }
      }
      const installerType = item.installerType || job.installer_type || 'exe';
      demandWasEvaluated = true;
      const demand = await ensureQaDemand(supabase, {
        wingetId: job.winget_id,
        displayName: item.displayName || job.display_name,
        publisher: item.publisher || job.publisher || 'Unknown Publisher',
        version: job.version,
        architecture: item.architecture || job.architecture || 'x64',
        installerUrl: item.installerUrl || job.installer_url || '',
        installerSha256: item.installerSha256 || job.installer_sha256 || '',
        installerType,
        nestedInstallerType: item.nestedInstallerType,
        nestedInstallerPath: item.nestedInstallerPath,
        silentSwitches: extractSilentSwitches(
          item.installCommand || job.install_command || '',
          installerType,
          item.nestedInstallerType
        ),
        installerSuccessCodes: item.installerSuccessCodes,
        uninstallCommand: item.uninstallCommand || job.uninstall_command || '',
        installScope: item.installScope || job.install_scope || 'machine',
        psadtConfig: item.psadtConfig ? JSON.stringify(item.psadtConfig) : undefined,
        detectionRules: item.detectionRules ? JSON.stringify(item.detectionRules) : undefined,
        priority: job.is_auto_update ? QA_PRIORITY_DEMAND : QA_PRIORITY_CUSTOMER,
        demandSource: job.is_auto_update ? 'auto_update' : 'customer',
      });
      candidateStatus = demand.state === 'waiting' ? 'queued' : demand.state;
      candidateFailureSummary = demand.failureSummary || null;
      appVersionAlreadyPassed = demand.state === 'passed';

      const { data: relinkedJob, error: relinkError } = await supabase
        .from('packaging_jobs')
        .update({
          qa_candidate_id: demand.candidateId || job.qa_candidate_id,
          execution_profile_sha256: demand.identity.executionProfileSha256,
          presentation_profile_sha256: demand.identity.presentationProfileSha256,
          qa_requested_at: new Date().toISOString(),
          package_config: item as unknown as Json,
          installer_url: item.installerUrl || job.installer_url,
          installer_sha256: item.installerSha256 || job.installer_sha256,
          installer_type: item.installerType || job.installer_type,
          install_command: item.installCommand || job.install_command,
          uninstall_command: item.uninstallCommand || job.uninstall_command,
          install_scope: item.installScope || job.install_scope,
          status_message: demand.state === 'waiting'
            ? 'Waiting for installation validation before deployment'
            : job.status_message,
        })
        .eq('id', job.id)
        .eq('status', 'awaiting_qa')
        .select('qa_candidate_id, installer_sha256, architecture, package_config')
        .maybeSingle();
      if (relinkError) throw new Error(`Could not relink superseded QA demand: ${relinkError.message}`);
      if (!relinkedJob) continue;
      observed = relinkedJob;
      if (demand.state === 'waiting') {
        // Demand can reuse a completed run awaiting publication. Read its
        // actual state before continuity decides whether packaging may start.
        if (!demand.candidateId) {
          waitingIds.push(job.id);
          waiting++;
          continue;
        }
        const { data, error: candidateError } = await supabase
          .from('qa_candidates')
          .select('id, status, phase, github_run_id, failure_summary, package_profile_sha256, winget_id, version, architecture, installer_sha256')
          .eq('id', demand.candidateId)
          .maybeSingle();
        if (candidateError) throw candidateError;
        candidate = data;
        if (!candidate) {
          waitingIds.push(job.id);
          waiting++;
          continue;
        }
        candidateStatus = candidate.status;
        candidateFailureSummary = candidate.failure_summary;
      }
    }

    // Waiting jobs may have been linked before this payload was quarantined.
    // Check the execution input after reconciliation, including continuity and
    // maintenance releases: local packaging has no later workflow QA gate.
    let compatibilityBlock;
    const observedConfig = observed.package_config as unknown as Win32CartItem | null;
    try {
      compatibilityBlock = await getPackageCompatibilityBlock(supabase, {
        wingetId: job.winget_id,
        version: job.version,
        architecture: features.localPackager
          ? observed.architecture || 'x64'
          : observedConfig?.architecture || observed.architecture || 'x64',
        installerSha256: features.localPackager
          ? observed.installer_sha256 || ''
          : observedConfig?.installerSha256 || observed.installer_sha256 || '',
      });
    } catch {
      // An unavailable lookup is not evidence of eligibility. Keep this job
      // waiting while allowing unrelated verified jobs in the batch to proceed.
      waitingIds.push(job.id);
      waiting++;
      continue;
    }
    const guardObservedIdentity = <T extends { eq: (key: string, value: string) => T; is: (key: string, value: null) => T }>(query: T): T => {
      const identityFields = [
        ['qa_candidate_id', observed.qa_candidate_id],
        ['installer_sha256', observed.installer_sha256],
        ['architecture', observed.architecture],
        ['package_config->>installerSha256', observedConfig?.installerSha256],
        ['package_config->>architecture', observedConfig?.architecture],
      ] as const;
      for (const [column, value] of identityFields) {
        query = value == null ? query.is(column, null) : query.eq(column, value);
      }
      return query;
    };
    if (compatibilityBlock) {
      const now = new Date().toISOString();
      const unsupportedMessage = unsupportedDependencyMessage(compatibilityBlock);
      const message = unsupportedMessage || PACKAGE_VERSION_UNAVAILABLE_MESSAGE;
      let failureUpdate = supabase
        .from('packaging_jobs')
        .update({
          status: unsupportedMessage ? 'failed' : 'qa_failed',
          status_message: message,
          error_message: message,
          error_code: unsupportedMessage ? 'DEPENDENCY_NOT_SUPPORTED' : 'QA_PACKAGE_COMPATIBILITY_BLOCKED',
          error_stage: 'validation',
          error_category: unsupportedMessage ? 'validation' : 'installer',
          completed_at: now,
        })
        .eq('id', job.id)
        .eq('status', 'awaiting_qa');
      // Another invocation can relink this job without changing its status.
      // Fail only the raw stored identity that the lookup actually observed.
      failureUpdate = guardObservedIdentity(failureUpdate);
      const { data: blockedJob, error: blockError } = await failureUpdate
        .select('id')
        .maybeSingle();
      if (blockError) throw new Error(`Could not hold quarantined QA job: ${blockError.message}`);
      if (blockedJob) {
        failed++;
        await handleAutoUpdateJobCompletion(job.id, 'failed', message);
      }
      continue;
    }


    const unavailable = !skipCustomerQa && demandWasEvaluated && candidateStatus === 'failed' && !observed.qa_candidate_id
      ? knownUnavailableDisposition(candidateFailureSummary) : null;
    if (unavailable) {
      const { data: changed, error: unavailableError } = await guardObservedIdentity(supabase.from('packaging_jobs').update({
        status: 'failed', status_message: unavailable.message, error_message: unavailable.message,
        error_code: unavailable.code, error_stage: 'validation', error_category: 'validation',
        qa_completed_at: null, completed_at: new Date().toISOString(),
      }).eq('id', job.id).eq('status', 'awaiting_qa')).select('id').maybeSingle();
      if (unavailableError) { waitingIds.push(job.id); waiting++; }
      else if (changed) { failed++; await handleAutoUpdateJobCompletion(job.id, 'failed', unavailable.message); }
      continue;
    }

    // A completed VM run may still be awaiting result publication. Keep its
    // customer jobs waiting for normal QA reconciliation, including during
    // continuity, without treating publication failure as installer failure.
    if (!skipCustomerQa && candidateStatus === 'error' &&
        candidate?.phase === 'publishing' && candidate.github_run_id) {
      waitingIds.push(job.id);
      waiting++;
      continue;
    }


    if (!skipCustomerQa && isExactPretestCandidate(candidate, {
      candidateId: observed.qa_candidate_id, wingetId: job.winget_id, version: job.version,
      architecture: observedConfig?.architecture || observed.architecture || 'x64',
      hash: observedConfig?.installerSha256 || observed.installer_sha256 || '', profile: job.execution_profile_sha256,
    })) {
      try {
        const holds = await loadInstallerSecurityHolds(supabase, [candidate.installer_sha256!]);
        const hold = holds.get(candidate.installer_sha256!.toLowerCase());
        if (hold && [installerSecurityReason(0), installerSecurityReason(1)].includes(hold.reason)) {
          const { data: failedResult, error: failedError } = await supabase.from('qa_package_results').select('outcome')
            .eq('package_profile_sha256', candidate.package_profile_sha256!).eq('winget_id', job.winget_id)
            .eq('tested_version', job.version).eq('architecture', candidate.architecture!)
            .eq('installer_sha256', candidate.installer_sha256!).eq('outcome', 'Failed').limit(1).maybeSingle();
          if (failedError) throw new Error('Security hold evidence unavailable');
          if (!failedResult) {
            const now = Date.now();
            const next = Date.parse(hold.nextCheckAt);
            if (!Number.isFinite(next)) throw new Error('Security hold schedule unavailable');
            const { data: heldJob, error: holdError } = await guardObservedIdentity(supabase.from('packaging_jobs').update({
              status_message: hold.reason, qa_resume_due_at: new Date(Math.max(now + 60_000, Math.min(next, now + 86_400_000))).toISOString(),
            }).eq('id', job.id).eq('status', 'awaiting_qa')).select('id').maybeSingle();
            if (holdError) throw new Error('Could not defer security-held deployment');
            if (heldJob) held++;
            continue;
          }
        }
      } catch {
        waitingIds.push(job.id); waiting++; continue;
      }
    }

    if (!skipCustomerQa && (!candidateStatus || ['failed', 'error'].includes(candidateStatus))) {
      const now = new Date().toISOString();
      const failureReason = candidateFailureSummary?.trim() || 'The required installation test could not complete.';
      const { data: updated } = await supabase
        .from('packaging_jobs')
        .update({
          status: 'qa_failed',
          status_message: failureReason,
          error_message: failureReason,
          error_code: 'QA_FAILED_EXECUTION_PROFILE',
          error_stage: 'validation',
          error_category: 'installer',
          qa_completed_at: now,
          completed_at: now,
        })
        .eq('id', job.id)
        .eq('status', 'awaiting_qa')
        .select('id')
        .maybeSingle();
      if (updated) {
        failed++;
        await handleAutoUpdateJobCompletion(
          job.id,
          'failed',
          failureReason
        );
      }
      continue;
    }
    const qaDeferred = skipCustomerQa || (
      !job.is_auto_update && isDeferredCustomerQaEnabled() &&
      Boolean(candidateStatus && ['queued', 'dispatched', 'running'].includes(candidateStatus))
    );
    if (candidateStatus !== 'passed' && !qaDeferred) {
      waitingIds.push(job.id);
      waiting++;
      continue;
    }

    if (!appVersionAlreadyPassed && !qaDeferred) {
      const { data: result, error: resultError } = candidate?.package_profile_sha256
        ? await supabase
            .from('qa_package_results')
            .select('outcome')
            .eq('package_profile_sha256', candidate.package_profile_sha256)
            .maybeSingle()
        : { data: null, error: null };
      if (resultError) throw resultError;
      if (result?.outcome !== 'Passed') {
        waitingIds.push(job.id);
        waiting++;
        continue;
      }
    }

    // Keep reputation holds waiting before any claim. Local packaging has no
    // later workflow gate, and a hosted dispatch failure must not turn a
    // pending verdict into a terminal job failure.
    try {
      await enforceQaGate({
        wingetId: job.winget_id,
        version: job.version,
        architecture: features.localPackager
          ? observed.architecture || 'x64'
          : observedConfig?.architecture || observed.architecture || 'x64',
        installerSha256: features.localPackager
          ? observed.installer_sha256 || ''
          : observedConfig?.installerSha256 || observed.installer_sha256 || '',
        packageProfileSha256: job.execution_profile_sha256 || '',
        qaOverride: skipCustomerQa,
        sourceType: observedConfig?.sourceType,
        curatedReleaseId: observedConfig?.curatedReleaseId,
      });
    } catch (error) {
      const terminal = error instanceof QaGateError || error instanceof QaCompatibilityGateError ||
        error instanceof CuratedEvidenceMismatchError ||
        (error instanceof QaSecurityGateError && error.details.malicious >= 2);
      const message = error instanceof CuratedEvidenceMismatchError
        ? 'The requested package does not match its approved curated test evidence.'
        : error instanceof CuratedCatalogError ? 'Curated release verification is pending. Packaging remains on hold.'
        : error instanceof QaSecurityGateError ? installerSecurityReason(error.details.malicious)
        : error instanceof QaGateError || error instanceof QaCompatibilityGateError || error instanceof QaGateNotPassedError
          ? describeQaGateError(error) : 'Installer security verification is temporarily unavailable. Packaging remains on hold.';
      const patch = terminal ? {
        status: 'qa_failed', status_message: message, error_message: message,
        error_code: error.code, error_stage: 'validation', error_category: error instanceof CuratedEvidenceMismatchError ? 'validation' : 'installer',
        completed_at: new Date().toISOString(),
      } : { status_message: message };
      const result = await guardObservedIdentity(supabase.from('packaging_jobs').update(patch)
        .eq('id', job.id).eq('status', 'awaiting_qa')).select('id').maybeSingle();
      if (result.error) throw new Error('Could not preserve the customer gate disposition');
      if (!result.data) continue;
      if (terminal) {
        failed++;
        await handleAutoUpdateJobCompletion(job.id, 'failed', message);
      } else {
        waitingIds.push(job.id);
        waiting++;
      }
      continue;
    }

    if (features.localPackager) {
      // The local packager can claim queued jobs straight from the database,
      // so the licence must be checked before the job is released to it.
      try {
        await assertCuratedLicenceAccepted(job.tenant_id, job.winget_id);
      } catch (error) {
        if (!(error instanceof CuratedLicenceError)) {
          waitingIds.push(job.id);
          waiting++;
          continue;
        }
        const { data: failedJob } = await supabase
          .from('packaging_jobs')
          .update({
            status: 'failed',
            status_message: 'The tenant has not accepted the publisher licence agreement for this application',
            error_code: error.code,
            error_stage: 'validation',
            error_category: 'validation',
            error_message: error.message,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('status', 'awaiting_qa')
          .select('id')
          .maybeSingle();
        if (failedJob) await handleAutoUpdateJobCompletion(job.id, 'failed', error.message);
        failed++;
        continue;
      }
    }

    // Recheck existing jobs too: an earlier upload can fail approval while
    // this job is waiting on QA. This narrows, but does not serialize, that race.
    const cacheKey = JSON.stringify([job.tenant_id, job.winget_id]);
    let blocks = approvalCache.get(cacheKey);
    if (!blocks && job.tenant_id) {
      if (Date.now() - startedAt >= 30_000 || probeBudget.remaining <= 0 || approvalSignal.aborted) {
        budgetExhausted = true;
        deferred += (jobs?.length || 0) - visited + 1;
        break; // Unreached jobs retain their due time and lead the next cycle.
      }
      try {
        blocks = await findPendingApprovalBlocks({
          tenantId: job.tenant_id, wingetIds: [job.winget_id],
        }, { db: getDatabase(), signal: approvalSignal, probeBudget });
      } catch {
        blocks = [{ wingetId: job.winget_id, code: 'INTUNE_APPROVAL_PENDING',
          reason: 'release_check_failed',
          message: 'The earlier deployment approval could not be verified. No new deployment was started.' }];
      }
      if (approvalSignal.aborted || probeBudget.remaining <= 0) budgetExhausted = true;
      approvalCache.set(cacheKey, blocks);
    }
    // Even a cached clean check must never release after cancellation.
    const block = blocks?.[0];
    if (!job.tenant_id || block || approvalSignal.aborted) {
      const present = block?.reason === 'retained_app_present';
      const { error: holdError } = await supabase.from('packaging_jobs').update({
        status_message: block?.message || 'The earlier deployment approval could not be verified. No new deployment was started.',
        qa_resume_due_at: new Date(Date.now() + (present ? 600_000 : 300_000)).toISOString(),
      }).eq('id', job.id).eq('status', 'awaiting_qa');
      if (holdError) throw new Error('Could not schedule approval verification retry');
      held++;
      continue;
    }

    const now = new Date().toISOString();
    const nextStatus = features.localPackager ? 'queued' : 'packaging';
    const { data: claimed, error: claimError } = await guardObservedIdentity(supabase
      .from('packaging_jobs')
      .update({
        status: nextStatus,
        status_message: qaDeferred
          ? skipCustomerQa ? 'Preparing deployment' : 'Preparing deployment while installation validation remains scheduled'
          : 'Installation test passed; packaging started automatically',
        qa_completed_at: qaDeferred ? null : now,
        packaging_started_at: features.localPackager ? null : now,
        ...(['WORKFLOW_DISPATCH_RATE_LIMITED', 'WORKFLOW_DISPATCH_UNCONFIRMED'].includes(job.error_code ?? '') ? {
          error_code: null, error_message: null, error_stage: null, error_category: null,
        } : {}),
      })
      .eq('id', job.id)
      .eq('status', 'awaiting_qa')
      .is('callback_run_id', null))
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) continue;

    if (features.localPackager) {
      resumed++;
      continue;
    }

    try {
      const installerSha256 = item.installerSha256 || job.installer_sha256 || '';
      const autoUpdate = job.is_auto_update ? item as Win32CartItem & {
        sourceIntuneAppId?: string; autoSupersede?: boolean; supersedenceType?: string;
      } : undefined;
      const workflowInputs: WorkflowInputs = {
        qaOverride: skipCustomerQa,
        jobId: job.id,
        tenantId: job.tenant_id || '',
        wingetId: job.winget_id,
        displayName: item.displayName || job.display_name,
        description: buildIntuneAppDescription({
          description: item.description,
          fallback: `Deployed via IntuneGet from Winget: ${job.winget_id}`,
        }),
        publisher: item.publisher || job.publisher || 'Unknown Publisher',
        version: job.version,
        architecture: item.architecture || job.architecture || 'x64',
        installerUrl: item.installerUrl || job.installer_url || '',
        installerSha256,
        hashValidationMode: 'strict',
        installerType: item.installerType || job.installer_type || 'exe',
        nestedInstallerType: item.nestedInstallerType,
        nestedInstallerPath: item.nestedInstallerPath,
        silentSwitches: extractSilentSwitches(
          item.installCommand || job.install_command || '',
          item.installerType || job.installer_type,
          item.nestedInstallerType
        ),
        installerSuccessCodes: item.installerSuccessCodes,
        uninstallCommand: item.uninstallCommand || job.uninstall_command || '',
        callbackUrl,
        psadtConfig: item.psadtConfig ? JSON.stringify(item.psadtConfig) : undefined,
        detectionRules: item.detectionRules ? JSON.stringify(item.detectionRules) : undefined,
        requirementRules: item.requirementRules ? JSON.stringify(item.requirementRules) : undefined,
        assignments: item.assignments ? JSON.stringify(item.assignments) : undefined,
        categories: item.categories ? JSON.stringify(item.categories) : undefined,
        espProfiles: item.espProfiles ? JSON.stringify(item.espProfiles) : undefined,
        relationships: item.relationships?.length ? JSON.stringify(item.relationships) : undefined,
        installScope: (item.installScope || job.install_scope) === 'user' ? 'user' : 'machine',
        forceCreate: item.forceCreate,
        sourceIntuneAppId: autoUpdate?.sourceIntuneAppId,
        carryOverAssignments: autoUpdate?.assignmentMigration?.carryOverAssignments,
        removeAssignmentsFromPreviousApp: autoUpdate?.assignmentMigration?.removeAssignmentsFromPreviousApp,
        autoSupersede: autoUpdate?.autoSupersede,
        supersedenceType: autoUpdate?.supersedenceType,
        sourceType: item.sourceType,
        curatedReleaseId: item.curatedReleaseId,
      };
      const trigger = await triggerPackagingWorkflow(workflowInputs);
      await supabase
        .from('packaging_jobs')
        .update({
          github_run_id: trigger.runId?.toString() || null,
          github_run_url: trigger.runUrl || null,
        })
        .eq('id', job.id)
        .eq('status', 'packaging');
      resumed++;
    } catch (error) {
      const licenceRequired = error instanceof CuratedLicenceError;
      const rateLimit = error instanceof WorkflowDispatchRateLimitError || error instanceof WorkflowDispatchUnconfirmedError ? error : null;
      const rateHold = rateLimit ? dispatchRateLimitHold(rateLimit, job.error_details) : null;
      if (rateLimit) {
        const { data: heldJob, error: holdError } = await guardObservedIdentity(supabase
          .from('packaging_jobs')
          .update(rateHold ? { ...rateHold, qa_completed_at: job.qa_completed_at ?? null } : {
            status: 'failed',
            status_message: 'Automatic packaging retries have stopped. Check deployment status before trying again.',
            error_code: rateLimit.code,
            error_stage: 'authenticate', error_category: 'network', error_message: rateLimit.message,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id)
          .eq('status', 'packaging')
          .is('github_run_id', null)
          .is('callback_run_id', null)
          .is('cancelled_at', null)
          .is('archived_at', null))
          .select('id')
          .maybeSingle();
        if (holdError) throw holdError;
        if (heldJob && rateHold) held++;
        if (heldJob && !rateHold) {
          await handleAutoUpdateJobCompletion(job.id, 'failed', rateLimit.message);
          failed++;
        }
        continue;
      }
      // This typed failure is raised before dispatch. Ambiguous dispatch
      // failures must retain the terminal path below rather than be replayed.
      if (error instanceof InstallerPreflightError && error.retryable) {
        const { data: heldJob, error: holdError } = await guardObservedIdentity(supabase
          .from('packaging_jobs')
          .update({
            status: 'awaiting_qa',
            status_message: 'Installer verification is temporarily unavailable. Packaging remains on hold.',
            qa_completed_at: job.qa_completed_at ?? null,
            packaging_started_at: null,
            qa_resume_due_at: new Date(Date.now() + 60_000).toISOString(),
          })
          .eq('id', job.id)
          .eq('status', 'packaging')
          .is('github_run_id', null))
          .select('id')
          .maybeSingle();
        if (holdError) throw holdError;
        if (heldJob) held++;
        continue;
      }
      const { data: failedJob } = await supabase
        .from('packaging_jobs')
        .update({
          status: 'failed',
          status_message: licenceRequired
            ? 'The tenant has not accepted the publisher licence agreement for this application'
            : qaDeferred
            ? 'Packaging could not start during the continuity window'
            : 'Installation test passed, but packaging could not start automatically',
          error_code: licenceRequired ? error.code : 'QA_RESUME_DISPATCH_FAILED',
          error_stage: licenceRequired ? 'validation' : 'authenticate',
          error_category: licenceRequired ? 'validation' : 'network',
          error_message: error instanceof Error ? error.message : 'Unknown resume error',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('status', 'packaging')
        .select('id')
        .maybeSingle();
      if (failedJob) {
        await handleAutoUpdateJobCompletion(
          job.id,
          'failed',
          error instanceof Error ? error.message : 'Unknown resume error'
        );
      }
      failed++;
    }
  }

  if (waitingIds.length) {
    const { error: waitError } = await supabase.from('packaging_jobs').update({
      qa_resume_due_at: new Date(Date.now() + 60_000).toISOString(),
    }).in('id', waitingIds).eq('status', 'awaiting_qa');
    if (waitError) throw new Error('Could not schedule waiting QA jobs');
  }
  // Existing waiting jobs get the full batch first. Recovered failures enter the
  // same guarded path on the next invocation, never a separate dispatch path.
  let reopened = 0;
  let recoveryDeferred = false;
  let upstreamReopened = 0;
  if (Date.now() - startedAt < 35_000) {
    try { upstreamReopened = await reopenCustomerUpstreamJobs(supabase, startedAt + 45_000); }
    catch { recoveryDeferred = true; }
  }
  try {
    reopened = await reopenSupersededQaFailures(supabase);
  } catch {
    recoveryDeferred = true;
  }
  return NextResponse.json({ success: true, scanned: jobs?.length || 0, resumed, failed, waiting,
    held, deferred, budgetExhausted, reopened: reopened + upstreamReopened, recoveryDeferred });
}
