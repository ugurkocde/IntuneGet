import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getFeatureFlags } from '@/lib/features';
import { getAppConfig } from '@/lib/config';
import { buildIntuneAppDescription } from '@/lib/intune-description';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { triggerPackagingWorkflow, type WorkflowInputs } from '@/lib/github-actions';
import { handleAutoUpdateJobCompletion } from '@/lib/auto-update/cleanup';
import { ensureQaDemand } from '@/lib/qa/demand';
import type { Win32CartItem } from '@/types/upload';

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
      const item = job.package_config as unknown as Win32CartItem;
      const installerType = job.installer_type || item.installerType;
      const demand = await ensureQaDemand(supabase, {
        wingetId: job.winget_id,
        displayName: job.display_name,
        publisher: job.publisher || item.publisher || 'Unknown Publisher',
        version: job.version,
        architecture: job.architecture || item.architecture,
        installerUrl: job.installer_url || item.installerUrl,
        installerSha256: job.installer_sha256 || item.installerSha256 || '',
        installerType,
        nestedInstallerType: item.nestedInstallerType,
        nestedInstallerPath: item.nestedInstallerPath,
        silentSwitches: extractSilentSwitches(
          job.install_command || item.installCommand,
          installerType,
          item.nestedInstallerType
        ),
        installerSuccessCodes: item.installerSuccessCodes,
        uninstallCommand: job.uninstall_command || item.uninstallCommand,
        installScope: job.install_scope || item.installScope,
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
    if (candidateStatus !== 'passed') {
      waiting++;
      continue;
    }

    if (!appVersionAlreadyPassed) {
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
        status_message: 'Installation test passed; packaging started automatically',
        qa_completed_at: now,
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
      const item = job.package_config as unknown as Win32CartItem;
      const installerSha256 = job.installer_sha256 || '';
      const workflowInputs: WorkflowInputs = {
        jobId: job.id,
        tenantId: job.tenant_id || '',
        wingetId: job.winget_id,
        displayName: job.display_name,
        description: buildIntuneAppDescription({
          description: item.description,
          fallback: `Deployed via IntuneGet from Winget: ${job.winget_id}`,
        }),
        publisher: job.publisher || item.publisher || 'Unknown Publisher',
        version: job.version,
        architecture: job.architecture || item.architecture,
        installerUrl: job.installer_url || item.installerUrl,
        installerSha256,
        hashValidationMode: 'strict',
        installerType: job.installer_type || item.installerType,
        nestedInstallerType: item.nestedInstallerType,
        nestedInstallerPath: item.nestedInstallerPath,
        silentSwitches: extractSilentSwitches(
          job.install_command || item.installCommand,
          job.installer_type || item.installerType,
          item.nestedInstallerType
        ),
        installerSuccessCodes: item.installerSuccessCodes,
        uninstallCommand: job.uninstall_command || item.uninstallCommand,
        callbackUrl,
        psadtConfig: item.psadtConfig ? JSON.stringify(item.psadtConfig) : undefined,
        detectionRules: item.detectionRules ? JSON.stringify(item.detectionRules) : undefined,
        requirementRules: item.requirementRules ? JSON.stringify(item.requirementRules) : undefined,
        assignments: item.assignments ? JSON.stringify(item.assignments) : undefined,
        categories: item.categories ? JSON.stringify(item.categories) : undefined,
        espProfiles: item.espProfiles ? JSON.stringify(item.espProfiles) : undefined,
        relationships: item.relationships?.length ? JSON.stringify(item.relationships) : undefined,
        installScope: (job.install_scope || item.installScope) === 'user' ? 'user' : 'machine',
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
          status_message: 'Installation test passed, but packaging could not start automatically',
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
