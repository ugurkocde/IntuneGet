#!/usr/bin/env node
/**
 * Reconciles curated_apps.has_icon with what is actually committed under
 * public/icons.
 *
 * The two can drift apart, and neither direction self-heals:
 *
 *   - A row marked as having no icon while the files are present is stuck.
 *     fetch-web-icons.mjs skips any package whose icon-64.png exists, so it
 *     never refills it, and the site never shows it. The generic-icon purge
 *     produced 352 of these when icons it had removed were restored.
 *   - A row marked as having an icon whose files are gone points the site at
 *     a 404.
 *
 * Read-only by default: MODE=apply is required to write.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_KEY, ICONS_DIR, MODE.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ICONS_DIR = process.env.ICONS_DIR || 'public/icons';
const APPLY = process.env.MODE === 'apply';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/** The frontend builds its URLs from icon-64 upward, so that is the marker. */
function hasIconOnDisk(wingetId) {
  return fs.existsSync(path.join(ICONS_DIR, wingetId, 'icon-64.png'));
}

async function fetchAll() {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('curated_apps')
      .select('winget_id, has_icon, icon_path, icon_source, icon_failure_reason')
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

async function main() {
  const rows = await fetchAll();
  const missingFlag = []; // files present, row says no icon
  const staleFlag = []; // row says icon, files gone

  for (const row of rows) {
    const onDisk = hasIconOnDisk(row.winget_id);
    if (onDisk && row.has_icon !== true) missingFlag.push(row);
    else if (!onDisk && row.has_icon === true) staleFlag.push(row);
  }

  console.log(`Rows: ${rows.length}`);
  console.log(`Files present but row says no icon: ${missingFlag.length}`);
  console.log(`Row says icon but files are gone:   ${staleFlag.length}`);

  if (!APPLY) {
    console.log('\nMODE is not "apply" - no changes written.');
    for (const r of missingFlag.slice(0, 15)) console.log(`  would set has_icon: ${r.winget_id}`);
    for (const r of staleFlag.slice(0, 15)) console.log(`  would clear has_icon: ${r.winget_id}`);
  } else {
    const now = new Date().toISOString();

    for (const row of missingFlag) {
      // icon_source is deliberately left as-is. Where the files were restored
      // after a bad purge their provenance is genuinely unknown, and null is
      // the honest answer: the heal campaign can revisit them via
      // include_untracked rather than the row claiming a source it never had.
      const { error } = await supabase
        .from('curated_apps')
        .update({
          has_icon: true,
          icon_path: `/icons/${row.winget_id}/`,
          icon_failure_reason: null,
          updated_at: now
        })
        .eq('winget_id', row.winget_id);
      if (error) console.error(`Failed to set ${row.winget_id}: ${error.message}`);
    }

    for (const row of staleFlag) {
      const { error } = await supabase
        .from('curated_apps')
        .update({ has_icon: false, icon_path: null, updated_at: now })
        .eq('winget_id', row.winget_id);
      if (error) console.error(`Failed to clear ${row.winget_id}: ${error.message}`);
    }

    console.log(`\nApplied ${missingFlag.length + staleFlag.length} corrections.`);
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(
      summary,
      [
        '## Icon State Reconciliation',
        '',
        `- **Rows checked:** ${rows.length}`,
        `- **Files present, row said no icon:** ${missingFlag.length}`,
        `- **Row said icon, files gone:** ${staleFlag.length}`,
        `- **Mode:** ${APPLY ? 'apply' : 'report only'}`,
        ''
      ].join('\n')
    );
  }
}

main().catch(err => {
  console.error(`Reconciliation failed: ${err.message}`);
  process.exit(1);
});
