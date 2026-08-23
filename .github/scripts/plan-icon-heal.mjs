#!/usr/bin/env node
/**
 * Plans a sharded icon-healing campaign.
 *
 * Web tiers are placeholders of last resort. The GitHub-avatar tier in
 * particular resolves `github.com/<publisher>.png`, which is org branding, not
 * a product icon. For a publisher shipping one package that is usually fine.
 * For a publisher shipping many, every one of its packages ends up wearing the
 * same logo -- the Firefox bug, repeated across the catalog.
 *
 * So impact scales with how many packages a publisher ships. This planner
 * selects heal-eligible apps whose publisher ships at least MIN_PUBLISHER_APPS
 * of them, orders publishers by that count, and packs whole publishers into
 * shards. Keeping a publisher intact means its packages land on one runner,
 * where the icon cache and any later family inheritance can be reused.
 *
 * Output: plan/shard-<n>.json files in the apps-to-process.json shape that
 * extract-icons-batch.ps1 consumes, plus plan/matrix.json for the workflow.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MIN_PUBLISHER_APPS = parseInt(process.env.MIN_PUBLISHER_APPS || '10', 10);
const SHARDS = parseInt(process.env.SHARDS || '20', 10);
const MAX_APPS_PER_SHARD = parseInt(process.env.MAX_APPS_PER_SHARD || '40', 10);
const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || '3', 10);
const PLAN_DIR = process.env.PLAN_DIR || 'plan';

// Icons produced by these tiers are placeholders that binary extraction should
// overwrite. Binary-sourced icons are already authoritative and never queued.
const WEB_SOURCES = ['github_avatar', 'favicon', 'homepage_image'];

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/** Every catalog id, used to detect variant packages that can inherit. */
async function fetchAllWingetIds() {
  const pageSize = 1000;
  const ids = new Set();
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id')
      .order('winget_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Failed to fetch catalog ids:', error.message);
      process.exit(1);
    }
    for (const row of data) ids.add(row.winget_id);
    if (data.length < pageSize) break;
  }
  return ids;
}

/** Supabase caps a single response at 1000 rows, so walk the range window. */
async function fetchAllEligible() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id, name, publisher, latest_version, icon_source, icon_extraction_attempts')
      .in('icon_source', WEB_SOURCES)
      .or(`icon_extraction_attempts.is.null,icon_extraction_attempts.lt.${MAX_ATTEMPTS}`)
      .order('winget_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Failed to fetch heal candidates:', error.message);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

/**
 * Resolve a trusted installer URL + SHA256 per app from version_history.
 * Without a trusted hash the extractor refuses to parse the binary, so apps
 * that miss here fall back to the winget manifest inside the extractor.
 */
async function fetchInstallerMap(wingetIds) {
  const map = {};
  const chunkSize = 200;
  for (let i = 0; i < wingetIds.length; i += chunkSize) {
    const chunk = wingetIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('version_history')
      .select('winget_id, installer_url, installer_sha256')
      .in('winget_id', chunk)
      .not('installer_url', 'is', null)
      .order('detected_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch version_history:', error.message);
      process.exit(1);
    }
    for (const row of data) {
      if (!map[row.winget_id] && row.installer_url && row.installer_sha256) {
        map[row.winget_id] = { url: row.installer_url, sha256: row.installer_sha256 };
      }
    }
  }
  return map;
}

async function main() {
  const [eligible, catalogIds] = await Promise.all([fetchAllEligible(), fetchAllWingetIds()]);
  console.log(`Heal-eligible apps (web-sourced, under ${MAX_ATTEMPTS} attempts): ${eligible.length}`);

  // Mozilla.Firefox.de is a locale build of Mozilla.Firefox: same product, same
  // icon. Downloading its installer would spend ~2 minutes reproducing a file
  // the family-inheritance pass in fetch-web-icons.mjs copies in ~0.1s once the
  // base package is healed. Leave variants to that pass and spend the runners
  // on packages that genuinely have their own binary.
  const hasCatalogAncestor = wingetId => {
    const parts = wingetId.split('.');
    for (let take = parts.length - 1; take >= 2; take--) {
      if (catalogIds.has(parts.slice(0, take).join('.'))) return true;
    }
    return false;
  };

  const variants = eligible.filter(app => hasCatalogAncestor(app.winget_id));
  const candidates = eligible.filter(app => !hasCatalogAncestor(app.winget_id));
  console.log(
    `Deferring ${variants.length} variant packages to family inheritance; ` +
      `${candidates.length} need their own binary`
  );

  // Group by the winget_id publisher segment rather than the `publisher`
  // column: the avatar tier keys off the ID segment, so that is what decides
  // which apps ended up sharing an image.
  const byPublisher = new Map();
  for (const app of candidates) {
    const key = app.winget_id.split('.')[0];
    if (!byPublisher.has(key)) byPublisher.set(key, []);
    byPublisher.get(key).push(app);
  }

  const targeted = [...byPublisher.entries()]
    .filter(([, apps]) => apps.length >= MIN_PUBLISHER_APPS)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const targetedTotal = targeted.reduce((n, [, apps]) => n + apps.length, 0);
  console.log(
    `Publishers shipping >= ${MIN_PUBLISHER_APPS} heal-eligible apps: ${targeted.length} ` +
      `(${targetedTotal} apps)`
  );

  // Greedy least-loaded packing keeps every publisher on a single runner while
  // still balancing the shards. Publishers are visited largest-first, which is
  // what makes greedy packing behave well here.
  const shards = Array.from({ length: SHARDS }, () => []);
  const capacity = SHARDS * MAX_APPS_PER_SHARD;
  let queued = 0;
  let deferredPublishers = 0;

  for (const [publisherKey, apps] of targeted) {
    if (queued >= capacity) {
      deferredPublishers++;
      continue;
    }
    const target = shards.reduce((min, s, i) => (s.length < shards[min].length ? i : min), 0);
    if (shards[target].length + apps.length > MAX_APPS_PER_SHARD) {
      // A publisher larger than one shard is split across the emptiest shards
      // instead of being skipped, otherwise Microsoft (200+ apps) would never
      // be healed at any reasonable shard size.
      let remaining = [...apps];
      while (remaining.length > 0) {
        const next = shards.reduce((min, s, i) => (s.length < shards[min].length ? i : min), 0);
        const room = MAX_APPS_PER_SHARD - shards[next].length;
        if (room <= 0) break;
        shards[next].push(...remaining.splice(0, room));
      }
      queued = shards.reduce((n, s) => n + s.length, 0);
      if (remaining.length > 0) deferredPublishers++;
      console.log(`  ${publisherKey}: ${apps.length} apps (split across shards)`);
      continue;
    }
    shards[target].push(...apps);
    queued += apps.length;
    console.log(`  ${publisherKey}: ${apps.length} apps -> shard ${target}`);
  }

  const queuedApps = shards.flat();
  const installerMap = await fetchInstallerMap(queuedApps.map(a => a.winget_id));
  console.log(`Trusted installer hashes from version_history: ${Object.keys(installerMap).length}`);

  fs.mkdirSync(PLAN_DIR, { recursive: true });
  const matrix = [];
  for (const [index, apps] of shards.entries()) {
    if (apps.length === 0) continue;
    const payload = apps.map(app => ({
      winget_id: app.winget_id,
      name: app.name,
      publisher: app.publisher,
      latest_version: app.latest_version,
      icon_source: app.icon_source,
      icon_extraction_attempts: app.icon_extraction_attempts,
      cached_installer_url: installerMap[app.winget_id]?.url || null,
      cached_installer_sha256: installerMap[app.winget_id]?.sha256 || null
    }));
    fs.writeFileSync(path.join(PLAN_DIR, `shard-${index}.json`), JSON.stringify(payload, null, 2));
    matrix.push({ shard: index, count: apps.length });
  }

  fs.writeFileSync(path.join(PLAN_DIR, 'matrix.json'), JSON.stringify(matrix));

  // Remaining is the campaign's own backlog: heal-eligible apps under a
  // targeted publisher that did not fit in this wave. Reported so the operator
  // can see how many more waves are left rather than guessing.
  const remaining = targetedTotal - queuedApps.length;
  console.log(
    `\nQueued ${queuedApps.length} apps across ${matrix.length} shards; ` +
      `${remaining} targeted apps remain for later waves ` +
      `(${deferredPublishers} publishers did not fit)`
  );

  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    fs.appendFileSync(out, `matrix=${JSON.stringify(matrix)}\n`);
    fs.appendFileSync(out, `shard_count=${matrix.length}\n`);
    fs.appendFileSync(out, `queued=${queuedApps.length}\n`);
    fs.appendFileSync(out, `remaining=${remaining}\n`);
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(
      summary,
      [
        '## Icon Heal Plan',
        '',
        `- **Heal-eligible catalog-wide:** ${eligible.length}`,
        `- **Deferred to family inheritance (variant packages):** ${variants.length}`,
        `- **Targeted (publisher ships >= ${MIN_PUBLISHER_APPS}):** ${targetedTotal}`,
        `- **Queued this wave:** ${queuedApps.length} across ${matrix.length} shards`,
        `- **Targeted apps remaining after this wave:** ${remaining}`,
        ''
      ].join('\n')
    );
  }
}

main().catch(err => {
  console.error('Planning failed:', err);
  process.exit(1);
});
