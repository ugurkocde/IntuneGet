#!/usr/bin/env node
/**
 * Removes already-published icons that are installer-toolkit defaults.
 *
 * reject-generic-icons.mjs stops new ones being written. This clears the ones
 * already in the catalog: a scan of public/icons matches ~1,900 packages
 * spread over ~1,200 publishers against the blocklist, which is what tells us
 * they are generic artwork rather than any publisher's logo.
 *
 * Deleting an icon rather than leaving it looks like a regression, but the
 * frontend renders a lettered glyph when a package has no icon, and a glyph is
 * a more honest answer than the same grey installer window shown on nine
 * hundred unrelated apps. The database reset puts each package back in the
 * queue so the web tiers can supply something product-specific.
 *
 * MODE=scan    delete matching icon directories, write purged-apps.json
 * MODE=commit  apply the database reset for the packages in that file
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { bestIconPath, loadGenericHashes, classifyIcon } from './icon-hash.mjs';

const MODE = process.env.MODE || 'scan';
const ICONS_DIR = process.env.ICONS_DIR || 'public/icons';
const PURGED_FILE = process.env.PURGED_FILE || 'purged-apps.json';
const MAX_PURGE = parseInt(process.env.MAX_PURGE || '0', 10);

async function scan() {
  const blocklist = loadGenericHashes();
  const dirs = fs
    .readdirSync(ICONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const purged = [];
  const counts = {};
  let scanned = 0;

  for (const id of dirs) {
    if (MAX_PURGE > 0 && purged.length >= MAX_PURGE) break;
    const dir = path.join(ICONS_DIR, id);
    const iconPath = bestIconPath(dir);
    if (!iconPath) continue;
    scanned++;

    let match;
    try {
      match = await classifyIcon(iconPath, blocklist);
    } catch (err) {
      console.warn(`Could not screen ${id}: ${err.message}`);
      continue;
    }
    if (!match) continue;

    fs.rmSync(dir, { recursive: true, force: true });
    purged.push({ winget_id: id, label: match.label });
    counts[match.label] = (counts[match.label] || 0) + 1;
  }

  fs.writeFileSync(PURGED_FILE, JSON.stringify(purged, null, 2));

  console.log(`Scanned ${scanned} packages, purged ${purged.length}`);
  for (const [label, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label}: ${n}`);
  }

  const out = process.env.GITHUB_OUTPUT;
  if (out) fs.appendFileSync(out, `purged=${purged.length}\n`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(
      summary,
      [
        '## Generic Icon Purge',
        '',
        `Removed **${purged.length}** icons that matched a known installer-toolkit default.`,
        '',
        ...Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([label, n]) => `- \`${label}\`: ${n}`),
        '',
        'Each package is queued for re-resolution through the web tiers.',
        ''
      ].join('\n')
    );
  }
}

async function commit() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
    process.exit(1);
  }
  if (!fs.existsSync(PURGED_FILE)) {
    console.log('No purge list - nothing to update');
    return;
  }

  const supabase = createClient(url, key);
  const purged = JSON.parse(fs.readFileSync(PURGED_FILE, 'utf8'));
  const now = new Date().toISOString();
  console.log(`Resetting ${purged.length} packages so the web tiers can refill them`);

  let updated = 0;
  for (const entry of purged) {
    // Attempts reset to zero deliberately. Binary extraction will produce the
    // same generic image and reject-generic-icons.mjs will refuse it again, so
    // these packages retire on their own after the usual three attempts, while
    // the web tiers get a clean chance at a product-specific image first.
    const { error } = await supabase
      .from('curated_apps')
      .update({
        has_icon: false,
        icon_path: null,
        icon_source: null,
        icon_extraction_attempts: 0,
        icon_failure_reason: 'generic_installer_icon',
        icon_last_attempted_at: now,
        updated_at: now
      })
      .eq('winget_id', entry.winget_id);

    if (error) console.error(`Failed to reset ${entry.winget_id}: ${error.message}`);
    else updated++;
  }

  console.log(`Reset ${updated} of ${purged.length}`);
}

const run = MODE === 'commit' ? commit : scan;
run().catch(err => {
  console.error(`Purge (${MODE}) failed: ${err.message}`);
  process.exit(1);
});
