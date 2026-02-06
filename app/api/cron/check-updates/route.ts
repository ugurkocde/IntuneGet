/**
 * Check Updates Cron Job
 * Runs daily to detect available updates for deployed Intune apps
 * Stores results in update_check_results for notification processing
 * Triggers auto-updates for apps with auto_update policy
 */

import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parseVersion, compareVersions } from '@/lib/version-compare';
import {
  AutoUpdateTrigger,
  getLatestInstallerInfo,
} from '@/lib/auto-update/trigger';
import { AppUpdatePolicy, shouldSkipUpdate } from '@/types/update-policies';

const BATCH_SIZE = 50;

interface UploadHistoryRecord {
  id: string;
  user_id: string;
  winget_id: string;
  version: string;
  display_name: string;
  intune_app_id: string;
  intune_tenant_id: string | null;
}

interface CuratedApp {
  winget_id: string;
  latest_version: string;
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
  detected_at: string;
  updated_at: string;
}

interface AutoUpdateResult {
  triggered: number;
  skipped: number;
  failed: number;
  errors: string[];
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

  // Get all policies for the users/tenants/apps with updates
  const policyKeys = updates.map((u) => ({
    user_id: u.user_id,
    tenant_id: u.tenant_id,
    winget_id: u.winget_id,
  }));

  // Fetch policies in batches
  const uniqueUserIds = [...new Set(policyKeys.map((p) => p.user_id))];
  const { data: policies, error: policyError } = await supabase
    .from('app_update_policies')
    .select('*')
    .in('user_id', uniqueUserIds)
    .eq('policy_type', 'auto_update')
    .eq('is_enabled', true);

  if (policyError) {
    result.errors.push(`Failed to fetch policies: ${policyError.message}`);
    return result;
  }

  if (!policies || policies.length === 0) {
    return result;
  }

  // Create lookup map for policies
  const policyMap = new Map<string, AppUpdatePolicy>();
  policies.forEach((policy: AppUpdatePolicy) => {
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
      const installerInfo = await getLatestInstallerInfo(supabase, update.winget_id);

      if (!installerInfo) {
        result.errors.push(
          `No installer info found for ${update.winget_id} v${update.latest_version}`
        );
        result.failed++;
        continue;
      }

      // Add current version to installer info
      installerInfo.currentVersion = update.current_version;

      // Trigger the auto-update
      const triggerResult = await autoUpdateTrigger.triggerAutoUpdate(
        policy,
        installerInfo
      );

      if (triggerResult.success) {
        result.triggered++;
      } else if (triggerResult.skipped) {
        result.skipped++;
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
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

    // Combine unique user IDs
    const userIds = new Set<string>();
    notificationUsers?.forEach((u) => userIds.add(u.user_id));
    webhookUsers?.forEach((u) => userIds.add(u.user_id));
    autoUpdateUsers?.forEach((u) => userIds.add(u.user_id));

    if (userIds.size === 0) {
      return NextResponse.json({
        success: true,
        message: 'No users with notifications or auto-update enabled',
        usersChecked: 0,
        updatesFound: 0,
        autoUpdates: { triggered: 0, skipped: 0, failed: 0 },
      });
    }

    // Get all curated apps with their latest versions
    const { data: curatedApps, error: curatedError } = await supabase
      .from('curated_apps')
      .select('winget_id, latest_version')
      .not('latest_version', 'is', null);

    if (curatedError) {
      throw curatedError;
    }

    // Create a map for quick lookup
    const latestVersions = new Map<string, string>();
    curatedApps?.forEach((app: CuratedApp) => {
      if (app.latest_version) {
        latestVersions.set(app.winget_id, app.latest_version);
      }
    });

    // Get all ignore/pin policies to filter out updates
    const { data: filterPolicies } = await supabase
      .from('app_update_policies')
      .select('user_id, tenant_id, winget_id, policy_type, pinned_version')
      .in('policy_type', ['ignore', 'pin_version']);

    // Create lookup for ignored apps
    const ignoredApps = new Set<string>();
    const pinnedVersions = new Map<string, string>();
    filterPolicies?.forEach((policy) => {
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
      const { data: deployedApps, error: deployedError } = await supabase
        .from('upload_history')
        .select('*')
        .in('user_id', batch);

      if (deployedError) {
        errors.push(`Error fetching deployed apps: ${deployedError.message}`);
        continue;
      }

      if (!deployedApps || deployedApps.length === 0) {
        continue;
      }

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

        // Get unique apps by winget_id (keep the latest deployment)
        const uniqueApps = new Map<string, UploadHistoryRecord>();
        apps.forEach((app) => {
          const existing = uniqueApps.get(app.winget_id);
          if (!existing || compareVersions(app.version, existing.version) > 0) {
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

          // Compare versions
          if (compareVersions(app.version, latestVersion) < 0) {
            // Update available
            const currentParsed = parseVersion(app.version);
            const latestParsed = parseVersion(latestVersion);

            // Check if it's a critical update (major version change)
            const isCritical = latestParsed.major > currentParsed.major;

            const updateRecord = {
              user_id: userId,
              tenant_id: tenantId,
              winget_id: app.winget_id,
              intune_app_id: app.intune_app_id,
              display_name: app.display_name,
              current_version: app.version,
              latest_version: latestVersion,
              is_critical: isCritical,
              detected_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            updates.push(updateRecord);
            allUpdates.push(updateRecord);
          }
        }
      }

      // Upsert updates
      if (updates.length > 0) {
        const { error: upsertError } = await supabase
          .from('update_check_results')
          .upsert(updates, {
            onConflict: 'user_id,tenant_id,winget_id,intune_app_id',
          });

        if (upsertError) {
          errors.push(`Error upserting updates: ${upsertError.message}`);
        } else {
          totalUpdatesFound += updates.length;
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Allow up to 5 minutes for the job to complete
export const maxDuration = 300;
