import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import YAML from 'yaml';

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests';
const GITHUB_API_BASE = 'https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests';
const BATCH_SIZE = 10;

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
  description: string | null;
  homepage: string | null;
  license: string | null;
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

    // Get curated apps that need syncing
    const { data: curatedApps, error: fetchError } = await supabase
      .from('curated_apps')
      .select('winget_id, latest_version')
      .eq('is_verified', true)
      .order('popularity_rank', { ascending: true })
      .limit(200); // Process top 200 apps per cron run

    if (fetchError) {
      throw fetchError;
    }

    if (!curatedApps || curatedApps.length === 0) {
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

            // Check if we already have this version
            const { data: existing } = await supabase
              .from('version_history')
              .select('version')
              .eq('winget_id', winget_id)
              .eq('version', latestVersion)
              .single();

            if (existing) {
              skipped++;
              return;
            }

            // Fetch installer manifest
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

            // Update curated_apps with latest version and metadata
            const appUpdate: CuratedAppUpdate = {
              winget_id,
              latest_version: latestVersion,
              description:
                (localeManifest?.ShortDescription as string) ||
                (localeManifest?.Description as string) ||
                null,
              homepage:
                (localeManifest?.PackageUrl as string) ||
                (localeManifest?.PublisherUrl as string) ||
                null,
              license: (localeManifest?.License as string) || null,
              updated_at: new Date().toISOString(),
            };

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

async function fetchVersions(wingetId: string): Promise<string[]> {
  const parts = wingetId.split('.');
  if (parts.length < 2) return [];

  const publisher = parts[0];
  const name = parts.slice(1).join('.');
  const firstLetter = publisher.charAt(0).toLowerCase();

  try {
    const response = await fetch(
      `${GITHUB_API_BASE}/${firstLetter}/${publisher}/${name}`,
      {
        headers: {
          'User-Agent': 'IntuneGet',
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!response.ok) return [];

    const dirs = await response.json();
    return dirs
      .filter((d: { type: string }) => d.type === 'dir')
      .map((d: { name: string }) => d.name)
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
  const parts = wingetId.split('.');
  if (parts.length < 2) return null;

  const publisher = parts[0];
  const name = parts.slice(1).join('.');
  const firstLetter = publisher.charAt(0).toLowerCase();

  const url = `${GITHUB_RAW_BASE}/${firstLetter}/${publisher}/${name}/${version}/${wingetId}.installer.yaml`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/plain',
        'User-Agent': 'IntuneGet',
      },
    });

    if (!response.ok) return null;

    const yamlContent = await response.text();
    return YAML.parse(yamlContent);
  } catch {
    return null;
  }
}

async function fetchLocaleManifest(
  wingetId: string,
  version: string
): Promise<Record<string, unknown> | null> {
  const parts = wingetId.split('.');
  if (parts.length < 2) return null;

  const publisher = parts[0];
  const name = parts.slice(1).join('.');
  const firstLetter = publisher.charAt(0).toLowerCase();

  const locales = ['locale.en-US', 'locale'];

  for (const locale of locales) {
    const url = `${GITHUB_RAW_BASE}/${firstLetter}/${publisher}/${name}/${version}/${wingetId}.${locale}.yaml`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/plain',
          'User-Agent': 'IntuneGet',
        },
      });

      if (response.ok) {
        const yamlContent = await response.text();
        return YAML.parse(yamlContent);
      }
    } catch {
      // Continue to next locale
    }
  }

  return null;
}

// Allow up to 5 minutes for the sync to complete
export const maxDuration = 300;
