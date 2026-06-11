/**
 * One-off backfill: populate curated_apps.description for rows where it is
 * NULL, using the same locale resolution as the fixed sync paths (en-US
 * preferred; DefaultLocale from <id>.yaml when en-US is absent or carries
 * no description; singleton manifests handled by the same lookup).
 *
 * Only the description column is written, and only for rows that are still
 * missing one at update time. Rows with an existing description are never
 * selected or touched.
 *
 * Usage (from the IntuneGet repo root):
 *   node --env-file=.env.local scripts/backfill-descriptions.mjs [--dry-run]
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from '@supabase/supabase-js';
import YAML from 'yaml';

const GITHUB_RAW_BASE =
  'https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests';
const CONCURRENCY = 8;
const BATCH_DELAY_MS = 500;

const dryRun = process.argv.includes('--dry-run');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: node --env-file=.env.local scripts/backfill-descriptions.mjs'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function manifestBasePath(wingetId) {
  const parts = wingetId.split('.');
  if (parts.length < 2) return null;
  const firstLetter = parts[0].charAt(0).toLowerCase();
  return `${firstLetter}/${parts.join('/')}`;
}

function localeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function extractDescription(manifest) {
  if (!manifest) return '';
  return localeText(manifest.ShortDescription) || localeText(manifest.Description);
}

// One retry on transient failures; 404 means the file does not exist and
// is not retried.
async function fetchManifestYaml(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'text/plain', 'User-Agent': 'IntuneGet-Backfill' },
      });
      if (response.status === 404) return null;
      if (response.ok) return YAML.parse(await response.text());
    } catch {
      // Network or parse error: fall through to the retry
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function resolveDescription(wingetId, version) {
  const basePath = manifestBasePath(wingetId);
  if (!basePath) return '';

  const versionDir = `${GITHUB_RAW_BASE}/${basePath}/${version}`;

  const enUS = await fetchManifestYaml(`${versionDir}/${wingetId}.locale.en-US.yaml`);
  const enUSDescription = extractDescription(enUS);
  if (enUSDescription) return enUSDescription;

  const versionManifest = await fetchManifestYaml(`${versionDir}/${wingetId}.yaml`);
  const singletonDescription = extractDescription(versionManifest);
  if (singletonDescription) return singletonDescription;

  const defaultLocale = localeText(versionManifest?.DefaultLocale);
  if (defaultLocale && defaultLocale.toLowerCase() !== 'en-us') {
    const defaultManifest = await fetchManifestYaml(
      `${versionDir}/${wingetId}.locale.${defaultLocale}.yaml`
    );
    const defaultDescription = extractDescription(defaultManifest);
    if (defaultDescription) return defaultDescription;
  }

  return '';
}

async function loadTargets() {
  const targets = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id, latest_version')
      .is('description', null)
      .order('winget_id')
      .range(from, from + pageSize - 1);

    if (error) {
      console.error(`Failed to load targets: ${error.message}`);
      process.exit(1);
    }

    targets.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }

  return targets;
}

async function knownVersions(wingetId, excludeVersion) {
  const { data } = await supabase
    .from('version_history')
    .select('version')
    .eq('winget_id', wingetId)
    .order('created_at', { ascending: false })
    .limit(3);

  return (data || [])
    .map((row) => row.version)
    .filter((version) => version && version !== excludeVersion);
}

async function processApp(app, stats, misses) {
  const versions = app.latest_version ? [app.latest_version] : [];

  let description = '';
  for (const version of versions) {
    description = await resolveDescription(app.winget_id, version);
    if (description) break;
  }

  if (!description) {
    // The recorded latest_version directory may be stale; try other
    // versions we have already synced before giving up.
    for (const version of await knownVersions(app.winget_id, app.latest_version)) {
      description = await resolveDescription(app.winget_id, version);
      if (description) break;
    }
  }

  if (!description) {
    stats.noDescription++;
    misses.push(app.winget_id);
    return;
  }

  if (dryRun) {
    stats.updated++;
    console.log(`  [dry-run] ${app.winget_id}: ${description.slice(0, 80)}`);
    return;
  }

  const { error } = await supabase
    .from('curated_apps')
    .update({ description, updated_at: new Date().toISOString() })
    .eq('winget_id', app.winget_id)
    .is('description', null);

  if (error) {
    stats.updateFailed++;
    console.error(`  [FAIL] ${app.winget_id}: ${error.message}`);
    return;
  }

  stats.updated++;
}

async function main() {
  const targets = await loadTargets();
  console.log(
    `Found ${targets.length} apps without a description${dryRun ? ' (dry run)' : ''}`
  );

  const stats = { updated: 0, noDescription: 0, updateFailed: 0 };
  const misses = [];

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((app) => processApp(app, stats, misses)));

    const processed = Math.min(i + CONCURRENCY, targets.length);
    if ((i / CONCURRENCY) % 10 === 0 || processed >= targets.length) {
      console.log(
        `[${processed}/${targets.length}] updated: ${stats.updated} | no description found: ${stats.noDescription} | update failed: ${stats.updateFailed}`
      );
    }

    if (processed < targets.length) {
      await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  console.log('\nDone.');
  console.log(`  Updated:               ${stats.updated}`);
  console.log(`  No description found:  ${stats.noDescription}`);
  console.log(`  Update failed:         ${stats.updateFailed}`);

  if (misses.length > 0) {
    console.log('\nApps with no description in any reachable manifest:');
    for (const id of misses) console.log(`  - ${id}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
