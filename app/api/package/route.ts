/**
 * Package API Route
 * Queues packaging jobs by triggering GitHub Actions workflows
 * or leaving them in queued state for local packager pickup
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getDatabase } from '@/lib/db';
import {
  isGitHubActionsConfigured,
  triggerPackagingWorkflow,
  type WorkflowInputs,
} from '@/lib/github-actions';
import { getAppConfig } from '@/lib/config';
import { parseAccessToken } from '@/lib/auth-utils';
import { getFeatureFlags } from '@/lib/features';
import { isValidInstallerUrl, isValidSha256 } from '@/lib/custom-app';
import { verifyTenantConsent } from '@/lib/msp/consent-verification';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { checkStoredConsent } from '@/lib/msp/consent-cache';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { buildIntuneAppDescription } from '@/lib/intune-description';
import { acquireGraphToken } from '@/lib/graph-token';
import { deployStoreApp } from '@/lib/store-app-deploy';
import {
  STALE_JOB_TIMEOUT_MINUTES,
  INTERMEDIATE_STATES,
  STALE_JOB_ERROR_MESSAGE,
  keepActuallyStaleJobs,
} from '@/lib/stale-jobs';
import type { PackagingJob } from '@/lib/db/types';
import type { CartItem, Win32CartItem, StoreCartItem } from '@/types/upload';
import { isStoreCartItem, isWin32CartItem } from '@/types/upload';

export const maxDuration = 60;

interface PackageRequestBody {
  items: CartItem[];
  forceCreate?: boolean;
}

interface PackagingJobRecord {
  id: string;
  user_id: string;
  tenant_id: string;
  winget_id: string;
  version: string;
  display_name: string;
  publisher: string;
  status: string;
  package_config: CartItem;
  github_run_id?: string;
  github_run_url?: string;
  created_at: string;
}

export async function POST(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const userId = user.userId;
    const userEmail = user.userEmail;
    const tokenTenantId = user.tenantId;

    // Check for MSP tenant override header and enforce tenant access checks
    // (membership, managed tenant consent, and customer-only access mode)
    const mspTenantId = request.headers.get('X-MSP-Tenant-Id');
    const { tenantId, errorResponse: tenantError } = await resolveTargetTenantId({
      supabase: createServerClient(),
      userId,
      tokenTenantId,
      requestedTenantId: mspTenantId,
    });

    if (tenantError) {
      return tenantError;
    }

    // Verify admin consent for the target tenant before accepting jobs
    // This prevents jobs from being queued when uploads will ultimately fail.
    //
    // Fast path: if a recent successful verification is cached in Supabase
    // (verify-consent route writes this on every successful check), trust it
    // and skip the live token call. The cart's "Ready to deploy" indicator
    // already does an authoritative check via /api/auth/verify-consent, so a
    // present cache record means the user just passed that gate moments ago.
    // This also avoids transient token-endpoint blips that would otherwise be
    // misclassified as a deployment-blocking error.
    const hasCachedConsent = await checkStoredConsent(tenantId);
    let consentResult: Awaited<ReturnType<typeof verifyTenantConsent>>;

    if (hasCachedConsent) {
      consentResult = { verified: true };
    } else {
      consentResult = await verifyTenantConsent(tenantId);
    }

    if (!consentResult.verified) {
      const isPermissionError = consentResult.error === 'insufficient_intune_permissions';
      const isTransient = consentResult.error === 'network_error' || consentResult.error === 'missing_credentials';

      const errorTitle = isPermissionError
        ? 'Intune permissions required'
        : isTransient
          ? 'Could not verify consent'
          : 'Admin consent required';

      const errorMessage = isPermissionError
        ? 'Admin consent was granted but Intune permissions (DeviceManagementApps.ReadWrite.All) are missing. Please have a Global Administrator re-grant admin consent.'
        : consentResult.error === 'network_error'
          ? "We couldn't reach Microsoft to verify your tenant's consent right now. This is usually a transient issue — please try again in a moment."
          : consentResult.error === 'missing_credentials'
            ? 'Server configuration issue. Please contact your administrator.'
            : 'Admin consent has not been granted for your organization. Please complete the onboarding process.';

      return NextResponse.json(
        {
          error: errorTitle,
          message: errorMessage,
          consentRequired: consentResult.error === 'consent_not_granted',
          permissionsRequired: isPermissionError,
          retryable: isTransient,
        },
        { status: isTransient ? 503 : 403 }
      );
    }

    // Parse request body
    const body: PackageRequestBody = await request.json();
    const { items, forceCreate } = body;

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'No items provided for packaging' },
        { status: 400 }
      );
    }

    // Limit batch size
    if (items.length > 10) {
      return NextResponse.json(
        { error: 'Maximum 10 items per batch' },
        { status: 400 }
      );
    }

    // Get database adapter (SQLite or Supabase)
    const db = getDatabase();

    // Partition items into store apps and win32 apps
    const storeItems: StoreCartItem[] = [];
    const win32Items: Win32CartItem[] = [];

    for (const item of items) {
      if (isStoreCartItem(item)) {
        storeItems.push(item);
      } else {
        // Treat missing appSource as win32 for backward compatibility
        win32Items.push(item as Win32CartItem);
      }
    }

    // Validate installer URLs for win32 items. Custom apps (issue #109)
    // accept arbitrary user-provided URLs, so reject anything that is not
    // a well-formed http(s) URL before queueing packaging jobs.
    for (const item of win32Items) {
      if (!isValidInstallerUrl(item.installerUrl)) {
        return NextResponse.json(
          {
            error: `Invalid installer URL for "${item.displayName || item.wingetId}": the installer URL must be a valid http or https URL`,
          },
          { status: 400 }
        );
      }
      const installerSha256 = item.installerSha256?.trim() || '';
      if (installerSha256 && !isValidSha256(installerSha256)) {
        return NextResponse.json(
          {
            error: `Invalid installer SHA256 for "${item.displayName || item.wingetId}": expected a 64-character hexadecimal value`,
          },
          { status: 400 }
        );
      }
      // Catalog packages must retain their trusted manifest hash. Custom apps
      // may omit it and have the packaging runner calculate it after download.
      if (!installerSha256 && item.sourceType !== 'custom') {
        return NextResponse.json(
          {
            error: `Missing installer SHA256 for "${item.displayName || item.wingetId}": catalog packages require a trusted manifest hash`,
          },
          { status: 400 }
        );
      }
    }

    const jobs: PackagingJobRecord[] = [];
    const errors: { wingetId: string; error: string }[] = [];

    // ========================================================================
    // Handle Store apps - deploy synchronously via Graph API (no packaging)
    // ========================================================================
    if (storeItems.length > 0) {
      let accessToken: string | undefined;
      try {
        const tokenResult = await acquireGraphToken(tenantId);
        accessToken = tokenResult.accessToken;
      } catch (error) {
        // If token fails, mark all store items as errors
        for (const item of storeItems) {
          errors.push({
            wingetId: item.wingetId,
            error: `Token acquisition failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          });
        }
      }

      if (accessToken) {
        const storeResults = await Promise.allSettled(
          storeItems.map(async (item) => {
            const jobId = crypto.randomUUID();

            // Create job record (store apps have no installer fields)
            const jobRecord = await db.jobs.create({
              id: jobId,
              user_id: userId,
              user_email: userEmail,
              tenant_id: tenantId,
              winget_id: item.wingetId,
              version: item.version,
              display_name: item.displayName,
              publisher: item.publisher,
              package_config: item as unknown as import('@/types/database').Json,
              status: 'uploading',
              progress_percent: 50,
              app_source: 'store',
            } as Record<string, unknown>);

            if (!jobRecord) throw new Error('Failed to create job record');

            try {
              // Deploy via Graph API
              const result = await deployStoreApp(item, accessToken!);

              // Mark as deployed
              await db.jobs.update(jobId, {
                status: 'deployed',
                progress_percent: 100,
                intune_app_id: result.intuneAppId,
                intune_app_url: result.intuneAppUrl,
                completed_at: new Date().toISOString(),
              });

              // Write upload history
              await db.uploadHistory.create({
                packaging_job_id: jobId,
                user_id: userId,
                winget_id: item.wingetId,
                version: item.version,
                display_name: item.displayName,
                publisher: item.publisher,
                intune_app_id: result.intuneAppId,
                intune_app_url: result.intuneAppUrl,
                intune_tenant_id: tenantId,
              });

              return {
                jobId,
                item,
                result,
                createdAt: jobRecord.created_at || new Date().toISOString(),
              };
            } catch (deployError) {
              // Mark job as failed so it doesn't stay stuck in 'uploading'
              await db.jobs.update(jobId, {
                status: 'failed',
                progress_percent: 0,
                error_message: deployError instanceof Error ? deployError.message : 'Deployment failed',
                completed_at: new Date().toISOString(),
              }).catch(() => {}); // Best-effort cleanup
              throw deployError;
            }
          })
        );

        for (let i = 0; i < storeResults.length; i++) {
          const result = storeResults[i];
          if (result.status === 'fulfilled') {
            const { jobId, item, createdAt } = result.value;
            jobs.push({
              id: jobId,
              user_id: userId,
              tenant_id: tenantId,
              winget_id: item.wingetId,
              version: item.version,
              display_name: item.displayName,
              publisher: item.publisher,
              status: 'deployed',
              package_config: item,
              created_at: createdAt,
            });
          } else {
            errors.push({
              wingetId: storeItems[i]?.wingetId || 'unknown',
              error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
            });
          }
        }
      }
    }

    // ========================================================================
    // Handle Win32 apps - existing packaging pipeline
    // ========================================================================
    if (win32Items.length > 0) {
      // Check if packaging pipeline is configured
      const config = getAppConfig();
      const features = getFeatureFlags();
      const isLocalPackagerMode = features.localPackager;

      if (!features.pipeline) {
        for (const item of win32Items) {
          errors.push({ wingetId: item.wingetId, error: 'Packaging pipeline not configured' });
        }
      } else if (!isLocalPackagerMode && !isGitHubActionsConfigured()) {
        for (const item of win32Items) {
          errors.push({ wingetId: item.wingetId, error: 'GitHub Actions packaging service not configured' });
        }
      } else {
        // Get callback URL from environment (only used in GitHub mode)
        const config2 = getAppConfig();
        const baseUrl = config2.app.url || (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000');
        const callbackUrl = `${baseUrl}/api/package/callback`;

        const pendingDispatches: {
          item: Win32CartItem;
          jobId: string;
          createdAt: string;
        }[] = [];

        // Phase 1: Create all win32 job records
        for (const item of win32Items) {
          try {
            const jobId = crypto.randomUUID();
            const installerSha256 = item.installerSha256?.trim() || '';

            const jobRecord = await db.jobs.create({
              id: jobId,
              user_id: userId,
              user_email: userEmail,
              tenant_id: tenantId,
              winget_id: item.wingetId,
              version: item.version,
              display_name: item.displayName,
              publisher: item.publisher,
              architecture: item.architecture,
              installer_type: item.installerType,
              installer_url: item.installerUrl,
              installer_sha256: installerSha256,
              install_command: item.installCommand,
              uninstall_command: item.uninstallCommand,
              install_scope: item.installScope,
              detection_rules: item.detectionRules as unknown as import('@/types/database').Json,
              package_config: item as unknown as import('@/types/database').Json,
              status: 'queued',
              progress_percent: 0,
            });

            if (!jobRecord) {
              errors.push({ wingetId: item.wingetId, error: 'Failed to create job record' });
              continue;
            }

            // Local packager mode: leave job in queued state for pickup
            if (isLocalPackagerMode) {
              jobs.push({
                id: jobId,
                user_id: userId,
                tenant_id: tenantId,
                winget_id: item.wingetId,
                version: item.version,
                display_name: item.displayName,
                publisher: item.publisher,
                status: 'queued',
                package_config: item,
                created_at: jobRecord?.created_at || new Date().toISOString(),
              });
              continue;
            }

            pendingDispatches.push({
              item,
              jobId,
              createdAt: jobRecord?.created_at || new Date().toISOString(),
            });
          } catch (error) {
            errors.push({
              wingetId: item.wingetId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        }

        // Phase 2: Dispatch workflows. Upload execution is serialized per tenant
        // by the workflow concurrency group, preventing Intune URI/SAS bursts.
        const isBatch = pendingDispatches.length > 1;

        const dispatchResults = await Promise.allSettled(
          pendingDispatches.map(async ({ item, jobId, createdAt }) => {
            const installerSha256 = item.installerSha256?.trim() || '';
            const workflowInputs: WorkflowInputs = {
              jobId,
              tenantId,
              wingetId: item.wingetId,
              displayName: item.displayName,
              description: buildIntuneAppDescription({
                description: item.description,
                fallback: `Deployed via IntuneGet from Winget: ${item.wingetId}`,
              }),
              publisher: item.publisher,
              version: item.version,
              architecture: item.architecture,
              installerUrl: item.installerUrl,
              installerSha256,
              hashValidationMode: installerSha256 ? 'strict' : 'calculate',
              installerType: item.installerType,
              nestedInstallerType: item.nestedInstallerType,
              nestedInstallerPath: item.nestedInstallerPath,
              silentSwitches: extractSilentSwitches(item.installCommand, item.installerType),
              uninstallCommand: item.uninstallCommand,
              callbackUrl,
              psadtConfig: item.psadtConfig ? JSON.stringify(item.psadtConfig) : undefined,
              detectionRules: item.detectionRules ? JSON.stringify(item.detectionRules) : undefined,
              requirementRules: item.requirementRules ? JSON.stringify(item.requirementRules) : undefined,
              assignments: item.assignments ? JSON.stringify(item.assignments) : undefined,
              categories: item.categories ? JSON.stringify(item.categories) : undefined,
              espProfiles: item.espProfiles ? JSON.stringify(item.espProfiles) : undefined,
              relationships: item.relationships && item.relationships.length > 0
                ? JSON.stringify(item.relationships)
                : undefined,
              installScope: item.installScope,
              forceCreate: item.forceCreate || forceCreate,
            };

            const triggerResult = await triggerPackagingWorkflow(
              workflowInputs,
              undefined,
              { skipRunCapture: isBatch }
            );

            const updateData: Record<string, unknown> = {
              status: 'packaging',
              packaging_started_at: new Date().toISOString(),
            };

            if (triggerResult.runId) {
              updateData.github_run_id = triggerResult.runId.toString();
              updateData.github_run_url = triggerResult.runUrl;
            }

            await db.jobs.update(jobId, updateData);

            return { item, jobId, createdAt, triggerResult };
          })
        );

        // Collect results from parallel dispatches
        for (let idx = 0; idx < dispatchResults.length; idx++) {
          const result = dispatchResults[idx];
          if (result.status === 'fulfilled') {
            const { item, jobId, createdAt } = result.value;
            jobs.push({
              id: jobId,
              user_id: userId,
              tenant_id: tenantId,
              winget_id: item.wingetId,
              version: item.version,
              display_name: item.displayName,
              publisher: item.publisher,
              status: 'packaging',
              package_config: item,
              created_at: createdAt,
            });
          } else {
            const dispatch = pendingDispatches[idx];
            const dispatchError = result.reason instanceof Error ? result.reason.message : 'Unknown error';
            if (dispatch) {
              await db.jobs.update(dispatch.jobId, {
                status: 'failed',
                progress_percent: 0,
                error_stage: 'authenticate',
                error_category: 'network',
                error_code: 'WORKFLOW_DISPATCH_FAILED',
                error_message: dispatchError,
                completed_at: new Date().toISOString(),
              }).catch((updateError) => {
                console.error(`Failed to mark dispatch ${dispatch.jobId} as failed:`, updateError);
              });
            }
            errors.push({
              wingetId: dispatch?.item.wingetId || 'unknown',
              error: dispatchError,
            });
          }
        }
      }
    }

    // Return results
    const totalJobs = jobs.length;
    const storeDeployed = jobs.filter(j => j.status === 'deployed').length;
    const win32Queued = totalJobs - storeDeployed;

    return NextResponse.json({
      success: totalJobs > 0,
      jobs,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length > 0
        ? `${totalJobs} job(s) processed, ${errors.length} failed`
        : storeDeployed > 0 && win32Queued > 0
          ? `${storeDeployed} Store app(s) deployed, ${win32Queued} Win32 app(s) queued`
          : storeDeployed > 0
            ? `${storeDeployed} Store app(s) deployed successfully`
            : `${win32Queued} job(s) queued successfully`,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Cap read-side healing per request to keep the GET fast
const STALE_HEAL_BATCH_SIZE = 25;

/**
 * Mark jobs stuck in intermediate states beyond the stale timeout as failed.
 * Read-side safety net for deployments where the cleanup cron never runs
 * (e.g. missing CRON_SECRET or self-hosted without cron). Returns the job
 * list with corrected statuses.
 */
async function healStaleJobs(
  db: ReturnType<typeof getDatabase>,
  jobs: PackagingJob[]
): Promise<PackagingJob[]> {
  const cutoff = Date.now() - STALE_JOB_TIMEOUT_MINUTES * 60 * 1000;

  const staleCandidates = jobs
    .filter((job) => {
      if (!INTERMEDIATE_STATES.includes(job.status)) return false;
      const lastActivity = job.updated_at || job.created_at;
      return new Date(lastActivity).getTime() < cutoff;
    })
    .slice(0, STALE_HEAL_BATCH_SIZE);

  const staleJobs = await keepActuallyStaleJobs(staleCandidates);

  if (staleJobs.length === 0) {
    return jobs;
  }

  const now = new Date().toISOString();
  const results = await Promise.all(
    staleJobs.map((job) =>
      db.jobs
        .update(job.id, {
          status: 'failed',
          error_message: STALE_JOB_ERROR_MESSAGE,
          completed_at: now,
          updated_at: now,
        })
        .catch((error) => {
          console.error(`Failed to heal stale job ${job.id}:`, error);
          return null;
        })
    )
  );

  const healedIds = new Set(
    staleJobs.filter((_, index) => results[index] !== null).map((job) => job.id)
  );

  if (healedIds.size === 0) {
    return jobs;
  }

  return jobs.map((job) =>
    healedIds.has(job.id)
      ? {
          ...job,
          status: 'failed',
          error_message: STALE_JOB_ERROR_MESSAGE,
          completed_at: now,
          updated_at: now,
        }
      : job
  );
}

/**
 * GET handler for checking job status
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  const db = getDatabase();

  try {
    if (jobId) {
      const user = await parseAccessToken(request.headers.get('Authorization'));
      if (!user) {
        return NextResponse.json(
          { error: 'Authentication required' },
          { status: 401 }
        );
      }

      const job = await db.jobs.getById(jobId);

      // Return 404 (not 403) on a foreign job so job existence isn't leaked
      // to a caller who doesn't own it.
      if (!job || (job as { user_id?: string }).user_id !== user.userId) {
        return NextResponse.json(
          { error: 'Job not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({ job });
    }

    // List the signed-in user's jobs. Use the token's userId (the same value
    // jobs are stored under and the dashboard reads) instead of trusting a
    // client-supplied id, so older completed activity shows here too.
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // scope=tenant shows every user's deployments in the tenant (so a team on
    // one tenant can see each other's IntuneGet apps and avoid duplicates).
    const scope = searchParams.get('scope');
    if (scope === 'tenant') {
      const mspTenantId = request.headers.get('X-MSP-Tenant-Id');
      const { tenantId, errorResponse } = await resolveTargetTenantId({
        supabase: createServerClient(),
        userId: user.userId,
        tokenTenantId: user.tenantId,
        requestedTenantId: mspTenantId,
      });
      if (errorResponse) {
        return errorResponse;
      }

      const tenantJobs = await db.jobs.getByTenantId(tenantId, 50);
      return NextResponse.json({ jobs: tenantJobs, scope: 'tenant' });
    }

    const jobs = await db.jobs.getByUserId(user.userId, 50);

    // Self-heal jobs stuck in intermediate states (safety net for
    // deployments where the cleanup cron is not running)
    const healedJobs = await healStaleJobs(db, jobs);

    return NextResponse.json({ jobs: healedJobs });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}
