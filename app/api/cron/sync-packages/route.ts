import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import YAML from 'yaml';
import { selectAppsToSync } from './select-apps';

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests';
const GITHUB_API_BASE = 'https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests';
const BATCH_SIZE = 10;

function githubHeaders(accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'IntuneGet',
    Accept: accept,
  };
  const token = process.env.GITHUB_PAT;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
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

  try {
    // Mark sync as started
    await supabase.from('curated_sync_status').upsert({
      id: 'sync-manifests',
      last_run_started_at: new Date().toISOString(),
      last_run_status: 'running',
      error_message: null,
      updated_at: new Date().toISOString(),
    });

    // Get curated apps that need syncing (top ranked apps plus apps that
    // have never been synced, which NULL popularity_rank would push past
    // a single ranked limit)
    const curatedApps = await selectAppsToSync(supabase);

    if (curatedApps.length === 0) {
      // No curated apps yet, update sync status
      await supabase.from('curated_sync_status').upsert({
        id: 'sync-manifests',
        last_run_completed_at: new Date().toISOString(),
        last_run_status: 'success',
        items_processed: 0,
        error_message: 'No curated apps to sync',
        updated_at: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        count: 0,
        message: 'No curated apps to sync. Run build-app-list workflow first.',
      });
    }

    let synced = 0;
    let failed = 0;
    let skipped = 0;
    const newVersions: { wingetId: string; oldVersion: string; newVersion: string }[] = [];

    // Process apps in batches
    for (let i = 0; i < curatedApps.length; i += BATCH_SIZE) {
      const batch = curatedApps.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (app) => {
          try {
            const { winget_id, latest_version } = app;

            // Fetch available versions from GitHub
            const versions = await fetchVersions(winget_id);
            if (versions.length === 0) {
              skipped++;
              return;
            }

            const latestVersion = versions[0];

            // Always refresh the current version. Publishers and winget-pkgs
            // can correct a URL or SHA256 without changing the version.
            const installerManifest = await fetchInstallerManifest(winget_id, latestVersion);
            if (!installerManifest) {
              failed++;
              return;
            }

            // Fetch locale manifest for metadata
            const localeManifest = await fetchLocaleManifest(winget_id, latestVersion);

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
              failed++;
              return;
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

            await supabase
              .from('curated_apps')
              .update(appUpdate)
              .eq('winget_id', winget_id);

            // Track new versions
            if (latest_version && latest_version !== latestVersion) {
              newVersions.push({
                wingetId: winget_id,
                oldVersion: latest_version,
                newVersion: latestVersion,
              });
            }

            synced++;
          } catch {
            failed++;
          }
        })
      );

      // Rate limiting for GitHub API
      if (i + BATCH_SIZE < curatedApps.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Update sync status
    await supabase.from('curated_sync_status').upsert({
      id: 'sync-manifests',
      last_run_completed_at: new Date().toISOString(),
      last_run_status: failed > 0 && synced === 0 ? 'failed' : 'success',
      items_processed: synced,
      error_message: failed > 0 ? `${failed} apps failed to sync` : null,
      metadata: {
        synced,
        failed,
        skipped,
        new_versions: newVersions.length,
      },
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      synced,
      failed,
      skipped,
      newVersions: newVersions.length,
      message: `Synced ${synced} apps, ${failed} failed, ${skipped} skipped`,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Update sync status to failed
    await supabase.from('curated_sync_status').upsert({
      id: 'sync-manifests',
      last_run_status: 'failed',
      error_message: errorMessage,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// Helper functions

/**
 * Build the manifest directory path for a winget ID. Every dot-separated
 * segment of the ID is a directory in winget-pkgs (e.g. MongoDB.Compass.Full
 * -> m/MongoDB/Compass/Full), so multi-part IDs must not keep their dots.
 */
function manifestBasePath(wingetId: string): string | null {
  const parts = wingetId.split('.');
  if (parts.length < 2) return null;
  const firstLetter = parts[0].charAt(0).toLowerCase();
  return `${firstLetter}/${parts.join('/')}`;
}

function localeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function hasLocaleDescription(manifest: Record<string, unknown> | null): boolean {
  return Boolean(
    manifest &&
      (localeText(manifest.ShortDescription) || localeText(manifest.Description))
  );
}

async function fetchVersions(wingetId: string): Promise<string[]> {
  const basePath = manifestBasePath(wingetId);
  if (!basePath) return [];

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/${basePath}`,
      {
        headers: githubHeaders('application/vnd.github.v3+json'),
      }
    );

    if (!response.ok) return [];

    const dirs = await response.json();
    // Keep only version-like directory names (same filter as the
    // sync-manifests GitHub Actions workflow) so non-version directories
    // such as ".validation" or named subfolders are never picked as latest
    return dirs
      .filter((d: { type: string }) => d.type === 'dir')
      .map((d: { name: string }) => d.name)
      .filter((name: string) => /^\d/.test(name))
      .filter((name: string) => /^\d+[\d._-]*\d*$/.test(name) || name.includes('.'))
      .sort((a: string, b: string) =>
        b.localeCompare(a, undefined, { numeric: true })
      );
  } catch {
    return [];
  }
}

async function fetchInstallerManifest(
  wingetId: string,
  version: string
): Promise<Record<string, unknown> | null> {
  const basePath = manifestBasePath(wingetId);
  if (!basePath) return null;

  const url = `${GITHUB_RAW_BASE}/${basePath}/${version}/${wingetId}.installer.yaml`;

  try {
    const response = await fetch(url, {
      headers: githubHeaders('text/plain'),
    });

    if (!response.ok) return null;

    const yamlContent = await response.text();
    return YAML.parse(yamlContent);
  } catch {
    return null;
  }
}

/**
 * Fetch and parse a manifest YAML with one retry on transient failures
 * (network errors, 429/5xx). 404 means the file does not exist and is
 * not retried.
 */
async function fetchManifestYaml(
  url: string
): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: githubHeaders('text/plain'),
      });

      if (response.status === 404) return null;

      if (response.ok) {
        return YAML.parse(await response.text());
      }
    } catch {
      // Network or parse error: fall through to the retry
    }

    if (attempt === 0) {
      // Short backoff: this route runs many fetches inside Vercel's
      // maxDuration budget, so retries must stay cheap.
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return null;
}

/**
 * Resolve the locale manifest for a package version. en-US is preferred,
 * but when it is absent or carries no description (packages whose
 * DefaultLocale is not en-US name their locale file accordingly, e.g.
 * <id>.locale.zh-CN.yaml), the DefaultLocale declared in <id>.yaml is
 * fetched instead. Singleton manifests carry the locale fields directly
 * in <id>.yaml and are handled by the same lookup.
 */
async function fetchLocaleManifest(
  wingetId: string,
  version: string
): Promise<Record<string, unknown> | null> {
  const basePath = manifestBasePath(wingetId);
  if (!basePath) return null;

  const versionDir = `${GITHUB_RAW_BASE}/${basePath}/${version}`;

  const enUS = await fetchManifestYaml(
    `${versionDir}/${wingetId}.locale.en-US.yaml`
  );
  if (hasLocaleDescription(enUS)) return enUS;

  const versionManifest = await fetchManifestYaml(`${versionDir}/${wingetId}.yaml`);
  if (hasLocaleDescription(versionManifest)) return versionManifest;

  const defaultLocale = localeText(versionManifest?.DefaultLocale);
  if (defaultLocale && defaultLocale.toLowerCase() !== 'en-us') {
    const defaultManifest = await fetchManifestYaml(
      `${versionDir}/${wingetId}.locale.${defaultLocale}.yaml`
    );
    if (hasLocaleDescription(defaultManifest) || (defaultManifest && !enUS)) {
      return defaultManifest;
    }
  }

  return enUS;
}

// Allow up to 5 minutes for the sync to complete
export const maxDuration = 300;
