/**
 * Check Updates Cron Job
 * Runs daily to detect available updates for deployed Intune apps
 * Stores results in update_check_results for notification processing
 * Triggers auto-updates for apps with auto_update policy
 */

import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getDatabase, isSqliteMode } from '@/lib/db';
import { runSqliteUpdateCheck } from '@/lib/auto-update/sqlite';
import { parseVersion, compareVersions } from '@/lib/version-compare';
import {
  AutoUpdateTrigger,
  getLatestInstallerInfo,
} from '@/lib/auto-update/trigger';
import { AppUpdatePolicy, shouldSkipUpdate } from '@/types/update-policies';
import { getCatalogSource } from '@/lib/catalog';

const BATCH_SIZE = 50;

interface UploadHistoryRecord {
  id: string;
  user_id: string;
  winget_id: string;
  version: string;
  display_name: string;
  intune_app_id: string;
  intune_tenant_id: string | null;
  deployed_at?: string | null;
}

interface UpdateCheckInsert {
  user_id: string;
  tenant_id: string;
  winget_id: string;
  intune_app_id: string;
  display_name: string;
  current_version: string;
  latest_version: string;
  is_critical: boolean;
  is_managed: boolean;
  notified_at: string | null;
  detected_at: string;
  updated_at: string;
}

interface AutoUpdateResult {
  triggered: number;
  skipped: number;
  failed: number;
  errors: string[];
}

interface ExistingUpdateCheckRow {
  id: string;
  user_id: string;
  tenant_id: string;
  winget_id: string;
  intune_app_id: string;
  current_version: string;
  display_name: string;
  latest_version: string;
  is_managed: boolean | null;
  notified_at: string | null;
}

interface FilterPolicyRow {
  user_id: string;
  tenant_id: string;
  winget_id: string;
  policy_type: string;
  pinned_version: string | null;
}

// PostgREST caps every response (1000 rows by default), so list reads are
// paged to make sure a large result is never silently truncated.
const PAGE_SIZE = 1000;
// Keeps each `id=in.(...)` delete well inside URL length limits.
const DELETE_CHUNK_SIZE = 100;

/**
 * Read every row of a query with keyset paging on `id`. The callback must
 * return the query filtered to `id > afterId` (when set), ordered by `id`
 * and limited to PAGE_SIZE. Keyset paging does not skip rows when other
 * requests delete rows between pages, and a project can lower max-rows
 * below PAGE_SIZE, so only an empty page ends the read.
 */
async function fetchAllRows(
  query: (
    afterId: string | null
  ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<{ data: unknown[]; error: { message: string } | null }> {
  const rows: unknown[] = [];
  let afterId: string | null = null;
  for (;;) {
    const { data, error } = await query(afterId);
    if (error) {
      return { data: rows, error };
    }
    const page = data ?? [];
    if (page.length === 0) {
      return { data: rows, error: null };
    }
    rows.push(...page);
    const lastId = (page[page.length - 1] as { id?: unknown }).id;
    if (typeof lastId !== 'string' || lastId === afterId) {
      // Never loop on a page that cannot advance the key.
      return { data: rows, error: { message: 'Paged read did not return an advancing id' } };
    }
    afterId = lastId;
  }
}

function deployedAtMs(record: UploadHistoryRecord): number {
  const time = record.deployed_at ? Date.parse(record.deployed_at) : NaN;
  return Number.isNaN(time) ? 0 : time;
}

/**
 * Process auto-updates for detected updates
 */
async function processAutoUpdates(
  supabase: SupabaseClient,
  autoUpdateTrigger: AutoUpdateTrigger,
  updates: UpdateCheckInsert[]
): Promise<AutoUpdateResult> {
  const result: AutoUpdateResult = {
    triggered: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Read every enabled auto-update policy. Few users have one, while a user
  // filter would list every user with an update and exceed URL limits.
  const { data: policyRows, error: policyError } = await fetchAllRows((afterId) => {
    const query = supabase
      .from('app_update_policies')
      .select('*')
      .eq('policy_type', 'auto_update')
      .eq('is_enabled', true);
    return (afterId ? query.gt('id', afterId) : query).order('id').limit(PAGE_SIZE);
  });

  if (policyError) {
    result.errors.push(`Failed to fetch policies: ${policyError.message}`);
    return result;
  }

  const policies = policyRows as AppUpdatePolicy[];
  if (policies.length === 0) {
    return result;
  }

  // Create lookup map for policies
  const policyMap = new Map<string, AppUpdatePolicy>();
  policies.forEach((policy) => {
    const key = `${policy.user_id}:${policy.tenant_id}:${policy.winget_id}`;
    policyMap.set(key, policy);
  });

  // Process each update that has an auto-update policy
  for (const update of updates) {
    const policyKey = `${update.user_id}:${update.tenant_id}:${update.winget_id}`;
    const policy = policyMap.get(policyKey);

    if (!policy) {
      // No auto-update policy for this app
      continue;
    }

    // Check if update should be skipped based on policy
    if (shouldSkipUpdate(policy, update.latest_version)) {
      result.skipped++;
      continue;
    }

    try {
      // Get installer info for the new version
      const installerResolution = await getLatestInstallerInfo(
        supabase,
        update.winget_id,
        policy.deployment_config?.architecture,
        policy.deployment_config?.installScope
      );

      if (!installerResolution.ok) {
        result.errors.push(
          `${update.winget_id} v${update.latest_version}: ${installerResolution.failure.message}`
        );
        result.failed++;
        continue;
      }
      const installerInfo = installerResolution.info;

      // Add current version to installer info.
      // Look up the most recent upload_history record to get the current
      // Intune app ID, since update_check_results.intune_app_id can be stale
      // if the app was redeployed since the last update check.
      installerInfo.currentVersion = update.current_version;
      const { data: latestUploadForCron } = await supabase
        .from('upload_history')
        .select('intune_app_id')
        .eq('user_id', update.user_id)
        .eq('intune_tenant_id', update.tenant_id)
        .eq('winget_id', update.winget_id)
        .order('deployed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      installerInfo.currentIntuneAppId =
        latestUploadForCron?.intune_app_id || update.intune_app_id;

      // Trigger the auto-update
      const triggerResult = await autoUpdateTrigger.triggerAutoUpdate(
        policy,
        installerInfo
      );

      if (triggerResult.success) {
        result.triggered++;
      } else if (triggerResult.skipped) {
        result.skipped++;
        if (triggerResult.code === 'CURATED_LICENCE_NOT_ACCEPTED' || triggerResult.code?.startsWith('CURATED_CONFIG_VERIFICATION')) {
          console.warn(`[auto-update] ${update.winget_id} skipped for tenant ${update.tenant_id}: ${triggerResult.skipReason}`);
        }
      } else {
        result.failed++;
        result.errors.push(
          `Failed to trigger auto-update for ${update.winget_id}: ${triggerResult.error}`
        );
      }
    } catch (error) {
      result.failed++;
      result.errors.push(
        `Error processing auto-update for ${update.winget_id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return result;
}

export async function GET(request: Request) {
  // Fail closed: without a configured secret, "Bearer undefined" must not pass.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Self-hosted deployments have no Supabase. Run the catalog-based check
  // through the database adapter and queue any auto-update jobs for the local
  // packager. Schedule this route externally (see the self-hosting docs).
  if (isSqliteMode()) {
    try {
      const summary = await runSqliteUpdateCheck(getDatabase());
      return NextResponse.json({ success: true, mode: 'sqlite', ...summary });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Update check failed' },
        { status: 500 }
      );
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: 'Missing Supabase configuration' },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Initialize auto-update trigger
  const autoUpdateTrigger = new AutoUpdateTrigger(supabaseUrl, supabaseServiceKey);

  try {
    // Get users with notifications enabled
    const { data: notificationUsers, error: usersError } = await supabase
      .from('notification_preferences')
      .select('user_id, notify_critical_only')
      .eq('email_enabled', true);

    if (usersError) {
      throw usersError;
    }

    // Also get users with enabled webhooks
    const { data: webhookUsers, error: webhooksError } = await supabase
      .from('webhook_configurations')
      .select('user_id')
      .eq('is_enabled', true);

    if (webhooksError) {
      throw webhooksError;
    }

    // Also get users with auto-update policies
    const { data: autoUpdateUsers, error: autoUpdateError } = await supabase
      .from('app_update_policies')
      .select('user_id')
      .eq('policy_type', 'auto_update')
      .eq('is_enabled', true);

    if (autoUpdateError) {
      throw autoUpdateError;
    }

    // Always include users that have deployed apps tracked in upload_history.
    // Without this, updates can stay at zero for users who did not enable notifications.
    const { data: deploymentUsers, error: deploymentUsersError } = await fetchAllRows((afterId) => {
      const query = supabase.from('upload_history').select('id, user_id');
      return (afterId ? query.gt('id', afterId) : query).order('id').limit(PAGE_SIZE);
    });

    if (deploymentUsersError) {
      throw deploymentUsersError;
    }

    // Combine unique user IDs
    const userIds = new Set<string>();
    notificationUsers?.forEach((u) => userIds.add(u.user_id));
    webhookUsers?.forEach((u) => userIds.add(u.user_id));
    autoUpdateUsers?.forEach((u) => userIds.add(u.user_id));
    (deploymentUsers as Array<{ user_id: string }>).forEach((u) => userIds.add(u.user_id));

    if (userIds.size === 0) {
      return NextResponse.json({
        success: true,
        message: 'No users with tracked deployments',
        usersChecked: 0,
        updatesFound: 0,
        autoUpdates: { triggered: 0, skipped: 0, failed: 0 },
      });
    }

    // Get all curated apps with their latest versions
    const curatedApps = await getCatalogSource().getAllLatestVersions();

    // Create a map for quick lookup
    const latestVersions = new Map<string, string>();
    curatedApps?.forEach((app) => {
      if (app.latest_version) {
        latestVersions.set(app.winget_id, app.latest_version);
      }
    });

    // Get all ignore/pin policies to filter out updates
    // A missing policy would let an ignored or pinned app through, so a
    // failed read stops the run.
    const { data: filterPolicies, error: filterPoliciesError } = await fetchAllRows((afterId) => {
      const query = supabase
        .from('app_update_policies')
        .select('id, user_id, tenant_id, winget_id, policy_type, pinned_version')
        .in('policy_type', ['ignore', 'pin_version']);
      return (afterId ? query.gt('id', afterId) : query).order('id').limit(PAGE_SIZE);
    });

    if (filterPoliciesError) {
      throw filterPoliciesError;
    }

    // Create lookup for ignored apps
    const ignoredApps = new Set<string>();
    const pinnedVersions = new Map<string, string>();
    (filterPolicies as FilterPolicyRow[]).forEach((policy) => {
      const key = `${policy.user_id}:${policy.tenant_id}:${policy.winget_id}`;
      if (policy.policy_type === 'ignore') {
        ignoredApps.add(key);
      } else if (policy.policy_type === 'pin_version' && policy.pinned_version) {
        pinnedVersions.set(key, policy.pinned_version);
      }
    });

    let totalUpdatesFound = 0;
    let totalUsersChecked = 0;
    const errors: string[] = [];
    const allUpdates: UpdateCheckInsert[] = [];

    // Process users in batches
    const userIdArray = Array.from(userIds);

    for (let i = 0; i < userIdArray.length; i += BATCH_SIZE) {
      const batch = userIdArray.slice(i, i + BATCH_SIZE);

      // Get deployed apps for this batch of users
      const { data: deployedRows, error: deployedError } = await fetchAllRows((afterId) => {
        const query = supabase.from('upload_history').select('*').in('user_id', batch);
        return (afterId ? query.gt('id', afterId) : query).order('id').limit(PAGE_SIZE);
      });

      if (deployedError) {
        const message = `Skipped a batch, could not load deployed apps: ${deployedError.message}`;
        console.error(`[check-updates] ${message}`);
        errors.push(message);
        continue;
      }

      const deployedApps = deployedRows as UploadHistoryRecord[];
      if (deployedApps.length === 0) {
        continue;
      }

      // Load prior update rows for this batch so the upsert can preserve
      // notified_at for unchanged updates but reset it to null when
      // latest_version changed. Without the reset, an app that was already
      // notified for an older version never notifies again on the next bump.
      // Without these rows every pending update would look new and be
      // notified again, so the batch is skipped when they cannot be loaded.
      const { data: priorData, error: priorError } = await fetchAllRows((afterId) => {
        const query = supabase
          .from('update_check_results')
          .select('id, user_id, tenant_id, winget_id, intune_app_id, current_version, display_name, latest_version, is_managed, notified_at')
          .in('user_id', batch);
        return (afterId ? query.gt('id', afterId) : query).order('id').limit(PAGE_SIZE);
      });

      if (priorError) {
        const message = `Skipped a batch, could not load existing update rows: ${priorError.message}`;
        console.error(`[check-updates] ${message}`);
        errors.push(message);
        continue;
      }

      const priorRows = priorData as ExistingUpdateCheckRow[];
      const priorMap = new Map<string, ExistingUpdateCheckRow>();
      const priorRowsByApp = new Map<string, ExistingUpdateCheckRow[]>();
      priorRows.forEach((row) => {
        priorMap.set(`${row.user_id}:${row.tenant_id}:${row.winget_id}:${row.intune_app_id}`, row);
        const appKey = `${row.user_id}:${row.tenant_id}:${row.winget_id}`;
        priorRowsByApp.set(appKey, [...(priorRowsByApp.get(appKey) ?? []), row]);
      });

      // Row keys whose app this batch compared against the catalog. Only these
      // may be removed by the stale cleanup below. Rows written by the
      // on-demand refresh for apps the cron never scans (teammate deployments,
      // claimed apps, manual mappings, catalog matches) are left alone; the
      // refresh recomputes them and the 30 day cleanup is their backstop.
      const evaluatedUpdateKeys = new Set<string>();
      const activeUpdateKeys = new Set<string>();

      // Group by user and tenant
      const userTenantApps = new Map<string, UploadHistoryRecord[]>();
      deployedApps.forEach((app: UploadHistoryRecord) => {
        const key = `${app.user_id}:${app.intune_tenant_id || 'default'}`;
        if (!userTenantApps.has(key)) {
          userTenantApps.set(key, []);
        }
        userTenantApps.get(key)!.push(app);
      });

      // Check for updates
      const updates: UpdateCheckInsert[] = [];

      for (const [key, apps] of userTenantApps) {
        const [userId, tenantId] = key.split(':');
        totalUsersChecked++;

        // Get unique apps by winget_id (keep the latest deployment). Ties go
        // to the most recent deployment, the closest match without a Graph
        // call to the refresh, which prefers the most recently modified
        // Intune object. The cron cannot see objects deleted in Intune: if the
        // newest deployment was deleted there, the refresh compares an older
        // object, and the two can still disagree about that app.
        const uniqueApps = new Map<string, UploadHistoryRecord>();
        apps.forEach((app) => {
          const existing = uniqueApps.get(app.winget_id);
          if (!existing) {
            uniqueApps.set(app.winget_id, app);
            return;
          }
          const comparison = compareVersions(app.version, existing.version);
          if (comparison > 0 || (comparison === 0 && deployedAtMs(app) > deployedAtMs(existing))) {
            uniqueApps.set(app.winget_id, app);
          }
        });

        for (const app of uniqueApps.values()) {
          const latestVersion = latestVersions.get(app.winget_id);
          if (!latestVersion) continue;

          // Check if this app is ignored
          const appKey = `${userId}:${tenantId}:${app.winget_id}`;
          if (ignoredApps.has(appKey)) {
            continue; // Skip ignored apps
          }

          // Check if pinned to a specific version
          const pinnedVersion = pinnedVersions.get(appKey);
          if (pinnedVersion && latestVersion !== pinnedVersion) {
            continue; // Skip if pinned to different version
          }

          // Every deployment of this app by this user is covered by the
          // comparison below: the newest one is compared and older Intune
          // objects of the same app are superseded by it.
          const ownIntuneAppIds = new Set(
            apps
              .filter((deployment) => deployment.winget_id === app.winget_id)
              .map((deployment) => deployment.intune_app_id)
          );
          for (const intuneAppId of ownIntuneAppIds) {
            evaluatedUpdateKeys.add(`${appKey}:${intuneAppId}`);
          }

          // Compare versions
          if (compareVersions(app.version, latestVersion) < 0) {
            // The refresh keeps one row per app, for the newest Intune object
            // in the tenant. When that is an object this user did not deploy
            // (for example a teammate's copy) that is at least as new as the
            // user's deployment and still outdated, update that row instead
            // of adding a second row for the same app.
            const refreshRow = (priorRowsByApp.get(appKey) ?? [])
              .filter((row) => !ownIntuneAppIds.has(row.intune_app_id))
              .reduce<ExistingUpdateCheckRow | null>(
                (newest, row) =>
                  !newest || compareVersions(row.current_version, newest.current_version) > 0
                    ? row
                    : newest,
                null
              );
            const target =
              refreshRow &&
              compareVersions(refreshRow.current_version, app.version) >= 0 &&
              compareVersions(refreshRow.current_version, latestVersion) < 0
                ? {
                    intune_app_id: refreshRow.intune_app_id,
                    display_name: refreshRow.display_name,
                    current_version: refreshRow.current_version,
                    // Keep the refresh's provenance for an object this user
                    // did not deploy.
                    is_managed: refreshRow.is_managed ?? true,
                  }
                : {
                    intune_app_id: app.intune_app_id,
                    display_name: app.display_name,
                    current_version: app.version,
                    // The cron only scans apps from upload_history, so its
                    // own rows are for IntuneGet-managed apps.
                    is_managed: true,
                  };

            // Check if it's a critical update (major version change)
            const latestMajor = parseVersion(latestVersion).major;
            const isCritical = latestMajor > parseVersion(target.current_version).major;

            // Preserve notified_at only when the same version is still pending;
            // a changed latest_version resets it so the new version notifies.
            const targetKey = `${appKey}:${target.intune_app_id}`;
            const prior = priorMap.get(targetKey);
            const notifiedAt =
              prior && prior.latest_version === latestVersion ? prior.notified_at : null;
            const now = new Date().toISOString();

            const updateRecord = {
              user_id: userId,
              tenant_id: tenantId,
              winget_id: app.winget_id,
              ...target,
              latest_version: latestVersion,
              is_critical: isCritical,
              notified_at: notifiedAt,
              detected_at: now,
              updated_at: now,
            };

            updates.push(updateRecord);
            // Auto-updates act on this user's own deployment.
            allUpdates.push({
              ...updateRecord,
              intune_app_id: app.intune_app_id,
              display_name: app.display_name,
              current_version: app.version,
              is_critical: latestMajor > parseVersion(app.version).major,
              is_managed: true,
            });
            activeUpdateKeys.add(targetKey);
          }
        }
      }

      // Upsert updates
      let upsertFailed = false;
      if (updates.length > 0) {
        const { error: upsertError } = await supabase
          .from('update_check_results')
          .upsert(updates, {
            onConflict: 'user_id,tenant_id,winget_id,intune_app_id',
          });

        if (upsertError) {
          upsertFailed = true;
          const message = `Error upserting updates, kept the batch's existing rows: ${upsertError.message}`;
          console.error(`[check-updates] ${message}`);
          errors.push(message);
        } else {
          totalUpdatesFound += updates.length;
        }
      }

      // Remove stale rows for apps this batch evaluated that are no longer
      // outdated. This clears outdated entries from older Intune app objects
      // and resolved updates. Rows for apps the batch did not evaluate are
      // kept with their notified and dismissed state, so they are not
      // notified again. When the upsert failed, nothing is removed, so the
      // batch keeps a consistent set of rows until the next run.
      const staleIds = upsertFailed ? [] : priorRows
        .filter((row) => {
          const rowKey = `${row.user_id}:${row.tenant_id}:${row.winget_id}:${row.intune_app_id}`;
          return evaluatedUpdateKeys.has(rowKey) && !activeUpdateKeys.has(rowKey);
        })
        .map((row) => row.id);

      for (let start = 0; start < staleIds.length; start += DELETE_CHUNK_SIZE) {
        const { error: staleDeleteError } = await supabase
          .from('update_check_results')
          .delete()
          .in('id', staleIds.slice(start, start + DELETE_CHUNK_SIZE));

        if (staleDeleteError) {
          errors.push(`Error deleting stale updates: ${staleDeleteError.message}`);
        }
      }

      // Rate limiting between batches
      if (i + BATCH_SIZE < userIdArray.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // Process auto-updates for all detected updates
    let autoUpdateResult: AutoUpdateResult = {
      triggered: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    if (allUpdates.length > 0) {
      autoUpdateResult = await processAutoUpdates(
        supabase,
        autoUpdateTrigger,
        allUpdates
      );

      if (autoUpdateResult.errors.length > 0) {
        errors.push(...autoUpdateResult.errors);
      }
    }

    // Clean up old update records that no longer apply
    // (app was updated or removed)
    const { error: cleanupError } = await supabase
      .from('update_check_results')
      .delete()
      .lt('detected_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    if (cleanupError) {
      errors.push(`Cleanup error: ${cleanupError.message}`);
    }

    return NextResponse.json({
      success: errors.length === 0,
      usersChecked: totalUsersChecked,
      updatesFound: totalUpdatesFound,
      autoUpdates: {
        triggered: autoUpdateResult.triggered,
        skipped: autoUpdateResult.skipped,
        failed: autoUpdateResult.failed,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof (error as { message?: unknown })?.message === 'string'
          ? (error as { message: string }).message
          : 'Unknown error';
    console.error(`[check-updates] Update check failed: ${errorMessage}`);
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Allow up to 5 minutes for the job to complete
export const maxDuration = 300;
