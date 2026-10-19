import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  classifyWingetSyncRun,
  createWingetManifestClient,
  resolveWingetManifest,
} from '@/lib/winget-sync-resolution.mjs';
import { normalizeInstaller, normalizeManifestInstallers } from '@/lib/manifest-api';
import { selectAppsToSync } from './select-apps';

const BATCH_SIZE = 10;
const SYNC_STATUS_ID = 'sync-manifests-hot';
// Bump when installer normalization or locale derivation changes.
const SYNC_DERIVATION_VERSION = 1;
const FULL_REFRESH_MS = 24 * 60 * 60 * 1000;
interface SyncValidator { etag: string; version: string; fetchedAt: string; deriv: number }

function previousValidator(metadata: unknown, wingetId: string, version: string | null, now: number): SyncValidator | null {
  if (!version || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const entries = (metadata as Record<string, unknown>).upstream_etags;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries) || !Object.hasOwn(entries, wingetId)) return null;
  const value = (entries as Record<string, unknown>)[wingetId];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Record<string, unknown>;
  if (entry.version !== version || version.length > 128 || /[\x00-\x1f\x7f]/.test(version) ||
      !/^\d/.test(version) || !(/^\d+[\d._-]*\d*$/.test(version) || version.includes('.')) ||
      entry.deriv !== SYNC_DERIVATION_VERSION || typeof entry.etag !== 'string' ||
      !/^(W\/)?"[0-9A-Za-z]{1,128}"$/.test(entry.etag) || typeof entry.fetchedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(entry.fetchedAt)) return null;
  const fetched = Date.parse(entry.fetchedAt);
  if (!Number.isFinite(fetched) || fetched > now || now - fetched >= FULL_REFRESH_MS) return null;
  return { etag: entry.etag, version, fetchedAt: entry.fetchedAt, deriv: SYNC_DERIVATION_VERSION };
}

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
  upstream_miss_count: number;
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
    const { data: previousStatus, error: previousStatusError } = await supabase
      .from('curated_sync_status').select('metadata').eq('id', SYNC_STATUS_ID).maybeSingle();
    if (previousStatusError) throw previousStatusError;
    const validators = new Map<string, SyncValidator>();
    let validatorsSent = 0;
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

            const previous = process.env.GITHUB_PAT
              ? previousValidator(previousStatus?.metadata, winget_id, latest_version, Date.now()) : null;
            if (previous) validatorsSent++;
            const listing = await manifestClient.fetchVersionsWithValidator(winget_id, previous?.etag ?? null);
            if (listing.notModified && previous) {
              validators.set(winget_id, previous);
              skipped++;
              return;
            }

            const resolution = await resolveWingetManifest({
              client: manifestClient,
              wingetId: winget_id,
              storedVersion: latest_version,
              preferLive: true,
              versions: listing.versions,
            });
            if (resolution.status === 'unavailable') {
              unavailable++;
              unavailableItems.push({
                id: winget_id,
                reason: resolution.reason || 'upstream_unavailable',
              });
              if (resolution.reason === 'package_or_version_missing') {
                const missCount = (app.upstream_miss_count || 0) + 1;
                if (missCount >= 3) {
                  const { error: blockError } = await supabase
                    .from('package_eligibility_blocks')
                    .upsert({
                      winget_id,
                      block_code: 'upstream_removed',
                      detail: `WinGet package resolution failed ${missCount} consecutive times with package_or_version_missing.`,
                      source_url: `https://github.com/microsoft/winget-pkgs/tree/master/manifests/${winget_id[0].toLowerCase()}`,
                      updated_at: new Date().toISOString(),
                    }, { onConflict: 'winget_id' });
                  if (blockError) throw new Error(`eligibility block upsert failed: ${blockError.message}`);
                }
                const { error: missError } = await supabase
                  .from('curated_apps')
                  .update({ upstream_miss_count: missCount, updated_at: new Date().toISOString() })
                  .eq('winget_id', winget_id);
                if (missError) throw new Error(`upstream miss update failed: ${missError.message}`);
              }
              return;
            }

            const latestVersion = resolution.version;
            const installerManifest = resolution.manifest;

            // Fetch locale manifest for metadata
            const localeManifest = await manifestClient.fetchLocaleManifest(winget_id, latestVersion);

            // Extract installer data
            const installers = normalizeManifestInstallers(installerManifest);
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
              silent_args: defaultInstaller.Architecture
                ? normalizeInstaller(defaultInstaller).silentArgs || null
                : null,
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
              upstream_miss_count: 0,
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

            // Only acknowledge upstream after BOTH derived writes succeeded.
            // Carried 304 entries keep their original full-refresh timestamp.
            if (listing.etag) validators.set(winget_id, {
              etag: listing.etag, version: latestVersion,
              fetchedAt: new Date().toISOString(), deriv: SYNC_DERIVATION_VERSION,
            });

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
        cache_hits: skipped,
        validators_sent: validatorsSent,
        upstream_etags: Object.fromEntries([...validators].slice(0, 200)),
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
