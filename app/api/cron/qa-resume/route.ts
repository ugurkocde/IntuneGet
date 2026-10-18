import { isQaMaintenanceMode } from '@/lib/qa/maintenance';
import { reopenSupersededQaFailures } from '@/lib/qa/customer-failure-recovery';
import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
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
import { reconcileCatalogInstaller } from '@/lib/catalog-installer-reconciliation';
import { getPackageCompatibilityBlock, PACKAGE_VERSION_UNAVAILABLE_MESSAGE } from '@/lib/package-eligibility';
import { enforceQaGate, describeQaGateError, QaGateError, QaGateNotPassedError, QaSecurityGateError, QaCompatibilityGateError } from '@/lib/qa/gate';
import { installerSecurityReason } from '@/lib/qa/installer-security-holds';
import { CuratedCatalogError, CuratedEvidenceMismatchError } from '@/lib/curated-catalog/core.mjs';
import type { Win32CartItem } from '@/types/upload';
import type { Json } from '@/types/database';
import { holdCustomerUpstreamJob, reopenCustomerUpstreamJobs } from '@/lib/customer-upstream-recovery';

const RESUME_BATCH_SIZE = 25;
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
    } | null = null;
    if (job.qa_candidate_id && !skipCustomerQa) {
      const { data, error: candidateError } = await supabase
        .from('qa_candidates')
        .select('id, status, phase, github_run_id, failure_summary, package_profile_sha256')
        .eq('id', job.qa_candidate_id)
        .maybeSingle();
      if (candidateError) throw candidateError;
      candidate = data;
    }

    let candidateStatus = candidate?.status;
    let candidateFailureSummary = candidate?.failure_summary;
    let appVersionAlreadyPassed = false;

    if (!skipCustomerQa && (!candidate || candidateStatus === 'superseded')) {
      // A waiting job can outlive the catalog metadata and packager revision
      // that created it. Reconcile the exact version against the trusted live
      // manifest before rebuilding QA demand, then persist that refreshed
      // execution input so the eventual customer package uses the same
      // installer command that passed in the VM. Explicit PSADT command
      // overrides remain authoritative inside reconcileCatalogInstaller.
      if (item.sourceType !== 'custom') {
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
      }
      const installerType = item.installerType || job.installer_type || 'exe';
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
          .select('id, status, phase, github_run_id, failure_summary, package_profile_sha256')
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
      let failureUpdate = supabase
        .from('packaging_jobs')
        .update({
          status: 'qa_failed',
          status_message: PACKAGE_VERSION_UNAVAILABLE_MESSAGE,
          error_message: PACKAGE_VERSION_UNAVAILABLE_MESSAGE,
          error_code: 'QA_PACKAGE_COMPATIBILITY_BLOCKED',
          error_stage: 'validation',
          error_category: 'installer',
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
        await handleAutoUpdateJobCompletion(job.id, 'failed', PACKAGE_VERSION_UNAVAILABLE_MESSAGE);
      }
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
      })
      .eq('id', job.id)
      .eq('status', 'awaiting_qa'))
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
