#!/usr/bin/env node
/**
 * Writes icon extraction results back to curated_apps.
 *
 * Only apps whose files actually landed on main are marked as having an icon:
 * COMMITTED_APPS comes from the merged publication PR, so a failed or skipped
 * publish can never leave the database claiming an icon the site cannot serve.
 *
 * Failures increment icon_extraction_attempts, which is what eventually retires
 * an app from the selection queries. Apps a run never reached appear in neither
 * list and keep their state, so they are simply picked up by the next wave.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_KEY, COMMITTED_APPS (csv),
 * RESULTS_FILE (default icon-results.json), SYNC_ID (default extract-icons).
 */

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESULTS_FILE = process.env.RESULTS_FILE || 'icon-results.json';
const SYNC_ID = process.env.SYNC_ID || 'extract-icons';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

const committedApps = new Set(
  (process.env.COMMITTED_APPS || '').split(',').map(s => s.trim()).filter(Boolean)
);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const now = new Date().toISOString();

  const toUpdate = results.filter(r => r.status === 'success' && committedApps.has(r.winget_id));
  console.log(`Marking ${toUpdate.length} healed icons (of ${results.length} results)`);

  for (const result of toUpdate) {
    const { error } = await supabase
      .from('curated_apps')
      .update({
        icon_path: result.icon_path,
        has_icon: true,
        icon_source: result.icon_source || 'binary_exe',
        icon_extraction_attempts: 0,
        icon_failure_reason: null,
        icon_last_attempted_at: now,
        updated_at: now
      })
      .eq('winget_id', result.winget_id);

    if (error) {
      console.error(`Failed to update ${result.winget_id}: ${error.message}`);
    } else {
      console.log(`Healed ${result.winget_id} (${result.icon_source})`);
    }
  }

  const failed = results.filter(r => r.status === 'failed');
  console.log(`Recording ${failed.length} failed attempts`);

  for (const result of failed) {
    const { data: current } = await supabase
      .from('curated_apps')
      .select('icon_extraction_attempts')
      .eq('winget_id', result.winget_id)
      .single();

    await supabase
      .from('curated_apps')
      .update({
        icon_extraction_attempts: (current?.icon_extraction_attempts || 0) + 1,
        icon_failure_reason: result.failure_reason || 'unknown',
        icon_last_attempted_at: now,
        updated_at: now
      })
      .eq('winget_id', result.winget_id);
  }

  const failureBreakdown = failed.reduce((acc, r) => {
    const reason = r.failure_reason || 'unknown';
    acc[reason] = (acc[reason] || 0) + 1;
    return acc;
  }, {});

  await supabase.from('curated_sync_status').upsert({
    id: SYNC_ID,
    last_run_completed_at: now,
    last_run_status: 'success',
    items_processed: toUpdate.length,
    metadata: {
      total: results.length,
      successful: toUpdate.length,
      failed: failed.length,
      failure_breakdown: failureBreakdown
    },
    updated_at: now
  });

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    fs.appendFileSync(
      summary,
      [
        '## Icon Heal Results',
        '',
        `- **Healed:** ${toUpdate.length}`,
        `- **Failed:** ${failed.length}`,
        ...Object.entries(failureBreakdown).map(([k, v]) => `  - ${k}: ${v}`),
        ''
      ].join('\n')
    );
  }
}

main().catch(err => {
  console.error('Database update failed:', err);
  process.exit(1);
});
