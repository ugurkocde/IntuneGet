/**
 * Trigger Updates API Route
 * POST - Manually trigger update(s) for apps
 */

import { NextRequest, NextResponse } from 'next/server';
import { DISPATCH_IDENTITY_KEY, UNCONFIRMED_AT_KEY, dispatchRateLimitHold, WorkflowDispatchUnconfirmedError, WorkflowDispatchRateLimitError, WorkflowDispatchRetryStopped } from '@/lib/workflow-dispatch-rate-limit';
import { buildStoredJobWorkflowInputs, storedJobItem } from '@/lib/auto-update/stored-job-workflow-inputs';
import { createServerClient, isSupabaseServerConfigured } from '@/lib/supabase';
import { getCatalogSource } from '@/lib/catalog';
import { parseAccessToken } from '@/lib/auth-utils';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import {
  AutoUpdateTrigger,
  getLatestInstallerInfo,
} from '@/lib/auto-update/trigger';
import {
  isGitHubActionsConfigured,
  triggerPackagingWorkflow,
} from '@/lib/github-actions';
import { getAppConfig } from '@/lib/config';
import { getFeatureFlags } from '@/lib/features';
import { buildDeploymentConfigForApp } from '@/lib/update-policies/build-deployment-config';
import type {
  TriggerUpdateRequest,
  TriggerUpdateResponse,
  AppUpdatePolicy,
  DeploymentConfig,
} from '@/types/update-policies';
import type { Json, Database } from '@/types/database';
import { isSelfUpdatingApp } from '@/lib/self-updating-apps';
import { describeQaGateError, isQaGateError } from '@/lib/qa/gate';

// Batches of up to 10 apps run sequentially (DB lookups, job creation, and a
// workflow dispatch each); the platform default duration times out mid-batch
// and returns a non-JSON error page to the client
export const maxDuration = 300;

/**
 * POST /api/updates/trigger
 * Manually trigger update deployment for one or more apps
 */
export async function POST(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: TriggerUpdateRequest = await request.json();

    // Validate request - either single update or bulk
    let updateRequests: { winget_id: string; tenant_id: string }[] = [];

    if (body.updates && Array.isArray(body.updates) && body.updates.length > 0) {
      updateRequests = body.updates;
    } else if (body.winget_id && body.tenant_id) {
      updateRequests = [{ winget_id: body.winget_id, tenant_id: body.tenant_id }];
    } else {
      return NextResponse.json(
        { error: 'Either winget_id/tenant_id or updates array is required' },
        { status: 400 }
      );
    }

    // Limit bulk updates
    if (updateRequests.length > 10) {
      return NextResponse.json(
        { error: 'Maximum 10 updates can be triggered at once' },
        { status: 400 }
      );
    }

    if (!isSupabaseServerConfigured()) {
      const unavailableError =
        'Update deployment requires Supabase and is not available on this self-hosted deployment';
      return NextResponse.json(
        {
          success: false,
          triggered: 0,
          failed: updateRequests.length,
          results: updateRequests.map((req) => ({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: unavailableError,
          })),
          error: unavailableError,
        },
        { status: 503 }
      );
    }

    const supabase = createServerClient();

    // The tenant ids come from the request body. Each one must be the
    // caller's own tenant or a customer tenant their MSP role may deploy to.
    // Rows stored earlier for a tenant are not proof of current access.
    for (const tenantId of new Set(updateRequests.map((req) => req.tenant_id))) {
      const tenantResolution = await resolveTargetTenantId({
        supabase,
        userId: user.userId,
        tokenTenantId: user.tenantId,
        requestedTenantId: tenantId,
        requiredPermission: 'deploy_apps',
      });
      if (tenantResolution.errorResponse) {
        return tenantResolution.errorResponse;
      }
    }

    // Get Supabase config for trigger
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const autoUpdateTrigger = new AutoUpdateTrigger(supabaseUrl, supabaseServiceKey);

    const response: TriggerUpdateResponse = {
      success: true,
      triggered: 0,
      failed: 0,
      results: [],
    };

    // Read the user's global update settings once for the whole batch - they
    // do not change mid-request and per-item reads add up across 10 apps
    const { data: userSettingsRow, error: userSettingsError } = await (supabase as any)
      .from('user_settings')
      .select('settings')
      .eq('user_id', user.userId)
      .maybeSingle();
    if (userSettingsError) {
      console.warn(
        `Failed to read user_settings for ${user.userId}: ${userSettingsError.message}`
      );
    }
    const userSettings = (userSettingsRow?.settings as Record<string, unknown> | null) || null;
    const globalCarryOver = Boolean(userSettings?.carryOverAssignments);

    for (const req of updateRequests) {
      try {
        // Self-updating apps are excluded from update detection; guard here
        // too in case a stale check result from before the exclusion remains
        if (isSelfUpdatingApp(req.winget_id)) {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: `${req.winget_id} keeps itself up to date on the device (Click-to-Run); IntuneGet does not deploy updates for it. Refresh the updates list to remove it.`,
          });
          continue;
        }

        // Get the update check result for this app
        const { data: updateResult, error: updateError } = await supabase
          .from('update_check_results')
          .select('*')
          .eq('user_id', user.userId)
          .eq('tenant_id', req.tenant_id)
          .eq('winget_id', req.winget_id)
          .single();

        if (updateError || !updateResult) {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: 'Update not found',
          });
          continue;
        }

        // Get or create policy for this app
        let { data: policy } = await supabase
          .from('app_update_policies')
          .select('*')
          .eq('user_id', user.userId)
          .eq('tenant_id', req.tenant_id)
          .eq('winget_id', req.winget_id)
          .single();

        // If no policy exists, check for prior deployment to get config
        if (!policy) {
          const built = await buildDeploymentConfigForApp(supabase, {
            userId: user.userId,
            tenantId: req.tenant_id,
            wingetId: req.winget_id,
            latestVersion: updateResult.latest_version,
          });

          if (built.status === 'orphaned_job') {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: 'Could not retrieve deployment configuration',
            });
            continue;
          }

          if (built.status === 'unavailable') {
            // Distinguish missing installer data from a missing catalog
            // entry so the user knows whether waiting for the catalog
            // sync can help
            const catalogRow = await getCatalogSource().appExists(req.winget_id);
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: catalogRow
                ? `No installer data is available for ${req.winget_id} ${updateResult.latest_version} yet - the catalog has not synced this version's manifest. Try again after the next catalog sync.`
                : `${req.winget_id} is not in the app catalog, so a deployment configuration cannot be built for it.`,
            });
            continue;
          }

          const { deploymentConfig, originalUploadHistoryId } = built;

          // Create a policy for this manual trigger
          const { data: newPolicy, error: policyError } = await supabase
            .from('app_update_policies')
            .insert({
              user_id: user.userId,
              tenant_id: req.tenant_id,
              winget_id: req.winget_id,
              policy_type: 'notify',
              deployment_config: deploymentConfig as unknown as Json,
              original_upload_history_id: originalUploadHistoryId,
              is_enabled: true,
            })
            .select()
            .single();

          if (policyError) {
            response.failed++;
            response.results.push({
              winget_id: req.winget_id,
              tenant_id: req.tenant_id,
              success: false,
              error: `Failed to create policy: ${policyError.message}`,
            });
            continue;
          }

          policy = newPolicy;
        }

        // This explicit attempt does not resume the stored automatic policy.
        // Keep the same attempt object through config backfills and dispatch.
        policy.policy_type = 'auto_update';
        policy.is_enabled = true;
        policy.consecutive_failures = 0;

        // Get installer info
        const deploymentConfig = policy.deployment_config as unknown as DeploymentConfig | null;
        const installerResolution = await getLatestInstallerInfo(
          supabase,
          req.winget_id,
          deploymentConfig?.architecture,
          deploymentConfig?.installScope
        );

        if (!installerResolution.ok) {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            error: installerResolution.failure.message,
          });
          continue;
        }
        const installerInfo = installerResolution.info;

        installerInfo.currentVersion = updateResult.current_version;

        // Look up the most recent upload_history record to get the current
        // Intune app ID. The update_check_results.intune_app_id can be stale
        // if the app was redeployed (forceCreate) since the last update check.
        const { data: latestUpload } = await supabase
          .from('upload_history')
          .select('intune_app_id')
          .eq('user_id', user.userId)
          .eq('intune_tenant_id', req.tenant_id)
          .eq('winget_id', req.winget_id)
          .order('deployed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        installerInfo.currentIntuneAppId =
          latestUpload?.intune_app_id || updateResult.intune_app_id;

        // Trigger the update (creates packaging job + history record in DB)
        // Manual triggers skip rate limits since the user explicitly confirmed
        const triggerResult = await autoUpdateTrigger.triggerAutoUpdate(
          policy as AppUpdatePolicy,
          installerInfo,
          { skipRateLimits: true, skipPriorDeploymentCheck: true, bypassUpdateScope: true,
            assignmentMigrationOverride: { carryOverAssignments: globalCarryOver, removeAssignmentsFromPreviousApp: false } }
        );

        if (triggerResult.success && triggerResult.packagingJobId) {
          // Dispatch the GitHub Actions workflow to actually run the packaging
          const features = getFeatureFlags();
          const isLocalPackagerMode = features.localPackager;

          if (!isLocalPackagerMode && isGitHubActionsConfigured()) {
            const appConfig = getAppConfig();
            const baseUrl = appConfig.app.url || (process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : 'http://localhost:3000');
            const callbackUrl = `${baseUrl}/api/package/callback`;

            const deploymentConfig = policy.deployment_config as unknown as DeploymentConfig;

            // First dispatch and resume must hash the same persisted execution input.
            const { data: job, error: readError } = await supabase.from('packaging_jobs')
              .select('*').eq('id', triggerResult.packagingJobId)
              .eq('user_id', user.userId).eq('tenant_id', req.tenant_id)
              .eq('auto_update_policy_id', policy.id).eq('is_auto_update', true)
              .in('status', ['queued', 'awaiting_qa'])
              .is('github_run_id', null).is('callback_run_id', null)
              .is('cancelled_at', null).is('archived_at', null).maybeSingle();
            if (readError || !job) {
              if (readError) {
                const message = 'Packaging could not start safely. Refresh the deployment status.';
                const { data: won, error: writeError } = await supabase.from('packaging_jobs')
                  .update({ status: 'failed', error_message: message, completed_at: new Date().toISOString() })
                  .eq('id', triggerResult.packagingJobId).eq('user_id', user.userId)
                  .eq('tenant_id', req.tenant_id).eq('auto_update_policy_id', policy.id)
                  .eq('is_auto_update', true).in('status', ['queued', 'awaiting_qa'])
                  .is('github_run_id', null).is('callback_run_id', null)
                  .is('cancelled_at', null).is('archived_at', null).is('error_details', null)
                  .select('id').maybeSingle();
                if (won && !writeError) {
                  await supabase.from('app_update_policies').update({ last_auto_update_version: null, updated_at: new Date().toISOString() })
                    .eq('id', policy.id).eq('user_id', user.userId).eq('tenant_id', req.tenant_id)
                    .eq('last_auto_update_version', installerInfo.latestVersion);
                  if (triggerResult.historyId) {
                    await supabase.from('auto_update_history').update({ status: 'failed',
                      error_message: message, completed_at: new Date().toISOString(),
                    }).eq('id', triggerResult.historyId);
                  }
                }
              }
              response.failed++;
              response.results.push({ winget_id: req.winget_id, tenant_id: req.tenant_id,
                success: false, packaging_job_id: triggerResult.packagingJobId,
                error: readError ? 'Packaging could not start safely. Refresh the deployment status.'
                  : 'Deployment status changed before packaging could start. Refresh the deployment status.',
              });
              continue;
            }
            const item = storedJobItem(job);
            const workflowInputs = buildStoredJobWorkflowInputs(job, item, {
              callbackUrl, qaOverride: false, sanitizeAssignments: true,
            });
            const isBatch = updateRequests.length > 1;
            const customSource = [deploymentConfig.sourceType, installerInfo.sourceType, item.sourceType].includes('custom');
            let claimedAt: string | null = null;
            let sentIdentity: string | undefined;
            const ownedWrite = (patch: Database['public']['Tables']['packaging_jobs']['Update'], afterClaim = false) => {
              let query = supabase.from('packaging_jobs').update(patch)
                .eq('id', job.id).eq('user_id', user.userId).eq('tenant_id', req.tenant_id)
                .eq('auto_update_policy_id', policy.id).eq('is_auto_update', true)
                .eq('status', afterClaim ? 'packaging' : job.status)
                .is('github_run_id', null).is('callback_run_id', null)
                .is('cancelled_at', null).is('archived_at', null).is('error_details', null);
              for (const field of ['qa_candidate_id', 'installer_sha256', 'architecture'] as const) {
                query = job[field] == null ? query.is(field, null) : query.eq(field, job[field]);
              }
              if (afterClaim) query = query.eq('packaging_started_at', claimedAt!);
              else if (job.status === 'awaiting_qa') query = job.qa_resume_due_at == null
                ? query.is('qa_resume_due_at', null) : query.eq('qa_resume_due_at', job.qa_resume_due_at);
              return query.select('id').maybeSingle();
            };
            try {
              await triggerPackagingWorkflow(workflowInputs, undefined, {
                skipRunCapture: isBatch,
                requireQaPass: true,
                newJobAdmission: !customSource,
                beforeDispatch: async identity => {
                  sentIdentity = identity;
                  if (job.status !== 'awaiting_qa') return;
                  const now = new Date().toISOString();
                  const { data: won, error } = await ownedWrite({ status: 'packaging',
                    status_message: customSource ? 'Preparing deployment' : 'Installation test passed; packaging started',
                    packaging_started_at: now, qa_completed_at: job.qa_completed_at ?? (customSource ? null : now) });
                  if (error) throw new Error('Could not claim packaging safely. Refresh the deployment status.');
                  if (!won) throw new WorkflowDispatchRetryStopped();
                  claimedAt = now;
                },
              });
            } catch (error) {
              if (error instanceof WorkflowDispatchRetryStopped) {
                response.failed++;
                response.results.push({ winget_id: req.winget_id, tenant_id: req.tenant_id,
                  success: false, packaging_job_id: job.id,
                  error: 'Deployment status changed before packaging could start. Refresh the deployment status.' });
                continue;
              }
              if (error instanceof WorkflowDispatchUnconfirmedError || error instanceof WorkflowDispatchRateLimitError) {
                // Only a fresh ownerless admission can be deferred. The resume
                // path checks the exact payload pin before claiming or posting.
                const hold = customSource
                  ? item.sourceType === 'custom' &&
                    typeof sentIdentity === 'string' && /^[a-f0-9]{64}$/i.test(sentIdentity)
                    ? dispatchRateLimitHold(error, { [DISPATCH_IDENTITY_KEY]: sentIdentity, ...(error instanceof WorkflowDispatchUnconfirmedError ? { [UNCONFIRMED_AT_KEY]: claimedAt ?? new Date().toISOString() } : {}) }) : null
                  : error instanceof WorkflowDispatchRateLimitError
                  ? error.dispatchIdentity === undefined ? null
                    : dispatchRateLimitHold(error, { [DISPATCH_IDENTITY_KEY]: error.dispatchIdentity })
                  : dispatchRateLimitHold(error, null);
                if (customSource && hold && error instanceof WorkflowDispatchUnconfirmedError) hold.status_message = 'Checking whether GitHub started packaging. No retry has been sent.';
                const patch: Database['public']['Tables']['packaging_jobs']['Update'] = hold ?? {
                  status: 'failed', error_code: error.code, error_stage: 'authenticate',
                  error_category: 'network', error_message: error.message,
                  completed_at: new Date().toISOString(),
                };
                const { data: won, error: writeError } = claimedAt
                  ? await ownedWrite(patch, true)
                  : await supabase.from('packaging_jobs').update(patch)
                    .eq('id', job.id).in('status', hold ? ['queued', 'awaiting_qa'] : ['queued'])
                    .is('github_run_id', null).is('callback_run_id', null)
                    .is('cancelled_at', null).is('archived_at', null).is('error_details', null)
                    .select('id').maybeSingle();
                if (won && !writeError && hold) {
                  response.triggered++;
                  response.results.push({
                    winget_id: req.winget_id, tenant_id: req.tenant_id,
                    success: true, packaging_job_id: triggerResult.packagingJobId,
                    code: error.code,
                  });
                  continue;
                }
                if (won && !writeError && triggerResult.historyId) {
                  await supabase.from('auto_update_history').update({
                    status: 'failed', error_message: error.message,
                    completed_at: new Date().toISOString(),
                  }).eq('id', triggerResult.historyId);
                }
                response.failed++;
                response.results.push({
                  winget_id: req.winget_id, tenant_id: req.tenant_id, success: false,
                  packaging_job_id: triggerResult.packagingJobId, code: error.code,
                  error: writeError ? 'Could not schedule the automatic retry. Refresh the deployment status.'
                    : won ? 'Packaging could not start safely. Refresh the deployment status.'
                    : 'Deployment status changed before the retry could be scheduled. Refresh the deployment status.',
                });
                continue;
              }
              if (!isQaGateError(error)) {
                if (claimedAt) {
                  await ownedWrite({ status: 'awaiting_qa', packaging_started_at: null,
                    qa_resume_due_at: new Date(Date.now() + 60_000).toISOString() }, true);
                }
                throw error;
              }

              // The status can change between the pre-job auto-update gate and
              // the final dispatch gate. Make that race an explicit safety
              // cancellation rather than leaving a queued/failed mystery job.
              const message = describeQaGateError(error);
              const completedAt = new Date().toISOString();
              const { data: cancelled, error: cancelError } = await ownedWrite({
                  status: 'cancelled',
                  status_message: 'Waiting for the installation test to finish',
                  error_message: message,
                  cancelled_at: completedAt,
                  completed_at: completedAt,
                });
              if (cancelled && !cancelError && triggerResult.historyId) {
                await supabase
                  .from('auto_update_history')
                  .update({
                    status: 'cancelled',
                    error_message: message,
                    completed_at: completedAt,
                  })
                  .eq('id', triggerResult.historyId);
              }

              response.failed++;
              response.results.push({
                winget_id: req.winget_id,
                tenant_id: req.tenant_id,
                success: false,
                skipped: true,
                code: error.code,
                error: cancelled && !cancelError ? message : 'Deployment status changed before packaging could start. Refresh the deployment status.',
              });
              continue;
            }
          }
          // If local packager mode, the job stays in 'queued'/'packaging' for local pickup

          response.triggered++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: true,
            packaging_job_id: triggerResult.packagingJobId,
          });
        } else if (!triggerResult.success) {
          response.failed++;
          response.results.push({
            winget_id: req.winget_id,
            tenant_id: req.tenant_id,
            success: false,
            skipped: triggerResult.skipped || undefined,
            code: triggerResult.code,
            error: triggerResult.error || triggerResult.skipReason || 'Unknown error',
          });
        }
      } catch (error) {
        response.failed++;
        response.results.push({
          winget_id: req.winget_id,
          tenant_id: req.tenant_id,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    response.success = response.failed === 0;

    return NextResponse.json(response);
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
