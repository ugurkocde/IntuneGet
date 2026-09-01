import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getFeatureFlags } from '@/lib/features';
import { getAppConfig } from '@/lib/config';
import { buildIntuneAppDescription } from '@/lib/intune-description';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { triggerPackagingWorkflow, type WorkflowInputs } from '@/lib/github-actions';
import { handleAutoUpdateJobCompletion } from '@/lib/auto-update/cleanup';
import { ensureQaDemand } from '@/lib/qa/demand';
import { isDeferredCustomerQaEnabled } from '@/lib/qa/continuity';
import { reconcileCatalogInstaller } from '@/lib/catalog-installer-reconciliation';
import type { Win32CartItem } from '@/types/upload';
import type { Json } from '@/types/database';

const RESUME_BATCH_SIZE = 25;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const { data: jobs, error: jobsError } = await supabase
    .from('packaging_jobs')
    .select('*')
    .eq('status', 'awaiting_qa')
    .order('created_at', { ascending: true })
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

  for (const job of jobs || []) {
    let item = job.package_config as unknown as Win32CartItem;
    let candidate: {
      id: string;
      status: string;
      failure_summary: string | null;
      package_profile_sha256: string | null;
    } | null = null;
    if (job.qa_candidate_id) {
      const { data, error: candidateError } = await supabase
        .from('qa_candidates')
        .select('id, status, failure_summary, package_profile_sha256')
        .eq('id', job.qa_candidate_id)
        .maybeSingle();
      if (candidateError) throw candidateError;
      candidate = data;
    }

    let candidateStatus = candidate?.status;
    let candidateFailureSummary = candidate?.failure_summary;
    let appVersionAlreadyPassed = false;

    if (!candidate || candidateStatus === 'superseded') {
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
        priority: 2000,
        demandSource: job.is_auto_update ? 'auto_update' : 'customer',
      });
      candidateStatus = demand.state === 'waiting' ? 'queued' : demand.state;
      candidateFailureSummary = demand.failureSummary || null;
      appVersionAlreadyPassed = demand.state === 'passed';

      const { error: relinkError } = await supabase
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
            ? 'Running an isolated installation test to make sure this app works before deployment'
            : job.status_message,
        })
        .eq('id', job.id)
        .eq('status', 'awaiting_qa');
      if (relinkError) throw new Error(`Could not relink superseded QA demand: ${relinkError.message}`);
    }

    if (!candidateStatus || ['failed', 'error'].includes(candidateStatus)) {
      const now = new Date().toISOString();
      const { data: updated } = await supabase
        .from('packaging_jobs')
        .update({
          status: 'qa_failed',
          status_message: candidateFailureSummary || 'The required installation test could not complete.',
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
          candidateFailureSummary || 'The required installation test could not complete.'
        );
      }
      continue;
    }
    const qaDeferred = !job.is_auto_update &&
      isDeferredCustomerQaEnabled() &&
      Boolean(candidateStatus && ['queued', 'dispatched', 'running'].includes(candidateStatus));
    if (candidateStatus !== 'passed' && !qaDeferred) {
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
        waiting++;
        continue;
      }
    }

    const now = new Date().toISOString();
    const nextStatus = features.localPackager ? 'queued' : 'packaging';
    const { data: claimed, error: claimError } = await supabase
      .from('packaging_jobs')
      .update({
        status: nextStatus,
        status_message: qaDeferred
          ? 'Preparing deployment while installation validation remains scheduled'
          : 'Installation test passed; packaging started automatically',
        qa_completed_at: qaDeferred ? null : now,
        packaging_started_at: features.localPackager ? null : now,
      })
      .eq('id', job.id)
      .eq('status', 'awaiting_qa')
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
      const { data: failedJob } = await supabase
        .from('packaging_jobs')
        .update({
          status: 'failed',
          status_message: qaDeferred
            ? 'Packaging could not start during the continuity window'
            : 'Installation test passed, but packaging could not start automatically',
          error_code: 'QA_RESUME_DISPATCH_FAILED',
          error_stage: 'authenticate',
          error_category: 'network',
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

  return NextResponse.json({ success: true, scanned: jobs?.length || 0, resumed, failed, waiting });
}
