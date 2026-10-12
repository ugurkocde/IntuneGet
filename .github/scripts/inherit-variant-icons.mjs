#!/usr/bin/env node
/**
 * Copies a healed product icon down onto its locale and edition variants.
 *
 * Mozilla.Firefox.de is the same product as Mozilla.Firefox and should wear
 * the same icon. The heal planner knows this and deliberately does not queue
 * variants, leaving them to family inheritance so one installer download
 * serves the whole family.
 *
 * Nothing was picking them up. Inheritance lives in fetch-web-icons.mjs, which
 * only considers apps with no icon at all:
 *
 *     query.or('has_icon.is.null,has_icon.eq.false')
 *     if (fs.existsSync(path.join(outputDir, 'icon-64.png'))) continue;
 *
 * A variant holding a publisher avatar has an icon, so inheritance skipped it,
 * while the planner had already excused itself on the grounds that inheritance
 * would handle it. 610 variants sat in that gap with a binary-sourced ancestor
 * available, each one a file copy away from being correct.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_KEY, ICONS_DIR, MAX_APPS.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ICONS_DIR = process.env.ICONS_DIR || 'public/icons';
const MAX_APPS = parseInt(process.env.MAX_APPS || '5000', 10);
const RESULTS_FILE = process.env.RESULTS_FILE || 'icon-results.json';
const SIZES = [32, 64, 128, 256];

// A variant carrying one of these is showing a placeholder, so an ancestor's
// real product icon is an improvement. Binary-sourced variants are left alone:
// they were extracted from their own installer and may legitimately differ.
const REPLACEABLE = new Set(['github_avatar', 'favicon', 'homepage_image']);

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchAll() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id, has_icon, icon_source')
      .order('winget_id', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Failed to read curated_apps:', error.message);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

function main2(rows) {
  const bySource = new Map(rows.map(r => [r.winget_id, r.icon_source]));

  /**
   * Most specific ancestor first: Mozilla.Firefox.ESR.de should follow
   * Mozilla.Firefox.ESR rather than Mozilla.Firefox when both are healed.
   */
  const findBinaryAncestor = wingetId => {
    const parts = wingetId.split('.');
    for (let take = parts.length - 1; take >= 2; take--) {
      const ancestorId = parts.slice(0, take).join('.');
      const source = bySource.get(ancestorId);
      if (!source || !source.startsWith('binary_')) continue;
      const dir = path.join(ICONS_DIR, ancestorId);
      if (SIZES.some(s => fs.existsSync(path.join(dir, `icon-${s}.png`)))) {
        return { ancestorId, dir };
      }
    }
    return null;
  };

  const candidates = rows.filter(
    r => r.has_icon === true && (r.icon_source === null || REPLACEABLE.has(r.icon_source))
  );

  const results = [];
  let unchanged = 0;

  for (const app of candidates) {
    if (results.length >= MAX_APPS) break;
    const ancestor = findBinaryAncestor(app.winget_id);
    if (!ancestor) continue;

    const targetDir = path.join(ICONS_DIR, app.winget_id);
    fs.mkdirSync(targetDir, { recursive: true });

    let wrote = 0;
    let identical = true;
    for (const size of SIZES) {
      const src = path.join(ancestor.dir, `icon-${size}.png`);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(targetDir, `icon-${size}.png`);
      const buf = fs.readFileSync(src);
      if (fs.existsSync(dst) && fs.readFileSync(dst).equals(buf)) continue;
      fs.writeFileSync(dst, buf);
      identical = false;
      wrote++;
    }

    if (identical) unchanged++;
    results.push({
      winget_id: app.winget_id,
      status: 'success',
      icon_path: `/icons/${app.winget_id}/`,
      icon_source: 'family_inherited',
      // The collector marks an app healed when it lands in the publication PR,
      // or when the shard reports the bytes were already right. Same contract.
      files_changed: !identical
    });

    if (wrote > 0) console.log(`${app.winget_id} <- ${ancestor.ancestorId} (${wrote} sizes)`);
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  console.log(`\n=== Variant Inheritance ===`);
  console.log(`Candidates with a binary-sourced ancestor: ${results.length}`);
  console.log(`  copied:            ${results.length - unchanged}`);
  console.log(`  already identical: ${unchanged}`);

  const out = process.env.GITHUB_OUTPUT;
  if (out) fs.appendFileSync(out, `inherited=${results.length}\n`);

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(
      summary,
      [
        '## Variant Icon Inheritance',
        '',
        `- **Variants following a binary-sourced ancestor:** ${results.length}`,
        `- **Files copied:** ${results.length - unchanged}`,
        `- **Already identical:** ${unchanged}`,
        ''
      ].join('\n')
    );
  }
}

const rows = await fetchAll();
main2(rows);
