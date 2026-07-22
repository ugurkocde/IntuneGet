import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  classifyWingetSyncRun,
  createWingetManifestClient,
  resolveWingetManifest,
} from '@/lib/winget-sync-resolution.mjs';
import { selectAppsToSync } from './select-apps';

const BATCH_SIZE = 10;
const SYNC_STATUS_ID = 'sync-manifests-hot';

interface VersionHistoryRecord {
  winget_id: string;
  version: string;
  installer_url: string | null;
  installer_sha256: string | null;
  installer_type: string | null;
  silent_args: string | null;
  installers: string;
  manifest_fetched_at: string;
  updated_at: string;
}

interface CuratedAppUpdate {
  winget_id: string;
  latest_version: string;
  description?: string;
  homepage?: string;
  license?: string;
  updated_at: string;
}

export async function GET(request: Request) {
  // Verify cron secret (Vercel adds this header for cron jobs)
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
  const manifestClient = createWingetManifestClient({
    token: process.env.GITHUB_PAT,
    maxRetries: 2,
  });

  try {
    // Mark sync as started
    const { error: startStatusError } = await supabase.from('curated_sync_status').upsert({
      id: SYNC_STATUS_ID,
      last_run_started_at: new Date().toISOString(),
      last_run_status: 'running',
      error_message: null,
      updated_at: new Date().toISOString(),
    });
    if (startStatusError) throw startStatusError;

    // Get curated apps that need syncing (top ranked apps plus apps that
    // have never been synced, which NULL popularity_rank would push past
    // a single ranked limit)
    const curatedApps = await selectAppsToSync(supabase);

    if (curatedApps.length === 0) {
      // No curated apps yet, update sync status
      const { error: emptyStatusError } = await supabase.from('curated_sync_status').upsert({
        id: SYNC_STATUS_ID,
        last_run_completed_at: new Date().toISOString(),
        last_run_status: 'success',
        items_processed: 0,
        error_message: 'No curated apps to sync',
        updated_at: new Date().toISOString(),
      });
      if (emptyStatusError) throw emptyStatusError;

      return NextResponse.json({
        success: true,
        count: 0,
        synced: 0,
        failed: 0,
        skipped: 0,
        unavailable: 0,
        newVersions: 0,
        message: 'No curated apps to sync. Run build-app-list workflow first.',
      });
    }

    let synced = 0;
    let failed = 0;
    let skipped = 0;
    let unavailable = 0;
    const unavailableItems: Array<{ id: string; reason: string }> = [];
    const failedItems: Array<{ id: string; reason: string }> = [];
    const newVersions: { wingetId: string; oldVersion: string; newVersion: string }[] = [];

    // Process apps in batches
    for (let i = 0; i < curatedApps.length; i += BATCH_SIZE) {
      const batch = curatedApps.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (app) => {
          try {
            const { winget_id, latest_version } = app;

            const resolution = await resolveWingetManifest({
              client: manifestClient,
              wingetId: winget_id,
              storedVersion: latest_version,
              preferLive: true,
            });
            if (resolution.status === 'unavailable') {
              unavailable++;
              unavailableItems.push({
                id: winget_id,
                reason: resolution.reason || 'upstream_unavailable',
              });
              return;
            }

            const latestVersion = resolution.version;
            const installerManifest = resolution.manifest;

            // Fetch locale manifest for metadata
            const localeManifest = await manifestClient.fetchLocaleManifest(winget_id, latestVersion);

            // Extract installer data
            const installers = (installerManifest.Installers as Array<Record<string, unknown>>) || [];
            const defaultInstaller = installers[0] || {};

            // Prepare version history record
            const versionRecord: VersionHistoryRecord = {
              winget_id,
              version: latestVersion,
              installer_url: (defaultInstaller.InstallerUrl as string) || null,
              installer_sha256: (defaultInstaller.InstallerSha256 as string) || null,
              installer_type:
                (defaultInstaller.InstallerType as string) ||
                (installerManifest.InstallerType as string) ||
                null,
              silent_args:
                (defaultInstaller.InstallerSwitches as Record<string, string>)?.Silent ||
                (installerManifest.InstallerSwitches as Record<string, string>)?.Silent ||
                null,
              installers: JSON.stringify(installers),
              manifest_fetched_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };

            // Upsert version history
            const { error: vhError } = await supabase
              .from('version_history')
              .upsert(versionRecord, { onConflict: 'winget_id,version' });

            if (vhError) {
              throw new Error(`version_history upsert failed: ${vhError.message}`);
            }

            // Update curated_apps with latest version and metadata.
            // Locale fields are only written when a non-empty value was
            // extracted, so a failed locale fetch can never wipe data a
            // previous sync already stored.
            const appUpdate: CuratedAppUpdate = {
              winget_id,
              latest_version: latestVersion,
              updated_at: new Date().toISOString(),
            };

            const description =
              localeText(localeManifest?.ShortDescription) ||
              localeText(localeManifest?.Description);
            if (description) appUpdate.description = description;

            const homepage =
              localeText(localeManifest?.PackageUrl) ||
              localeText(localeManifest?.PublisherUrl);
            if (homepage) appUpdate.homepage = homepage;

            const license = localeText(localeManifest?.License);
            if (license) appUpdate.license = license;

            const { error: appUpdateError } = await supabase
              .from('curated_apps')
              .update(appUpdate)
              .eq('winget_id', winget_id);
            if (appUpdateError) {
              throw new Error(`curated_apps update failed: ${appUpdateError.message}`);
            }

            // Track new versions
            if (latest_version && latest_version !== latestVersion) {
              newVersions.push({
                wingetId: winget_id,
                oldVersion: latest_version,
                newVersion: latestVersion,
              });
            }

            synced++;
          } catch (error) {
            failed++;
            failedItems.push({
              id: app.winget_id,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        })
      );

      // Rate limiting for GitHub API
      if (i + BATCH_SIZE < curatedApps.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    const classification = classifyWingetSyncRun({ complete: true, failed, unavailable });
    const errorMessage = failed > 0
      ? `${failed} operational sync failures`
      : unavailable > 0
        ? `${unavailable} upstream packages unavailable`
        : null;

    const { error: completionStatusError } = await supabase.from('curated_sync_status').upsert({
      id: SYNC_STATUS_ID,
      last_run_completed_at: new Date().toISOString(),
      last_run_status: classification.status,
      items_processed: synced,
      error_message: errorMessage,
      metadata: {
        synced,
        failed,
        skipped,
        unavailable,
        unavailable_samples: unavailableItems.slice(0, 20),
        failed_samples: failedItems.slice(0, 20),
        new_versions: newVersions.length,
      },
      updated_at: new Date().toISOString(),
    });
    if (completionStatusError) throw completionStatusError;

    return NextResponse.json({
      success: !classification.shouldFail,
      synced,
      failed,
      skipped,
      unavailable,
      newVersions: newVersions.length,
      message: `Synced ${synced} apps, ${unavailable} unavailable, ${failed} failed, ${skipped} skipped`,
    }, { status: classification.shouldFail ? 500 : 200 });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Update sync status to failed
    await supabase.from('curated_sync_status').upsert({
      id: SYNC_STATUS_ID,
      last_run_status: 'failed',
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

function localeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

// Allow up to 5 minutes for the sync to complete
export const maxDuration = 300;
