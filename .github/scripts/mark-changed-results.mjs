#!/usr/bin/env node
/**
 * Records, per extraction result, whether it actually changed any file.
 *
 * An extraction that reproduces the bytes already committed is a success that
 * leaves no diff. The collector builds its committed-apps list from the
 * publication PR, so such an app never appears there, the database never
 * learns it is binary-sourced, and it stays heal-eligible: every future wave
 * downloads the same installer, extracts the same icon, publishes nothing and
 * records nothing.
 *
 * That is not hypothetical. Wave 32657709971 extracted 373 icons successfully
 * and recorded 7. The other 366 were already correct on disk and had been
 * re-extracted on every previous wave for the same reason.
 *
 * Distinguishing "already correct" from "not published" needs the shard's own
 * view, because only the shard knows which paths it changed. The collector
 * cannot infer it: a missing diff and a lost artifact look identical there.
 *
 * Usage: mark-changed-results.mjs <changed-paths-file> <output-results-file>
 * Reads RESULTS_FILE (default icon-results.json).
 */

import fs from 'node:fs';

const CHANGED_FILE = process.argv[2];
const OUTPUT_FILE = process.argv[3];
const RESULTS_FILE = process.env.RESULTS_FILE || 'icon-results.json';

if (!CHANGED_FILE || !OUTPUT_FILE) {
  console.error('Usage: mark-changed-results.mjs <changed-paths-file> <output-results-file>');
  process.exit(1);
}

const results = fs.existsSync(RESULTS_FILE)
  ? JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'))
  : [];

// Paths look like public/icons/<winget_id>/icon-64.png, so the id is the third
// segment. Anything shorter is not a package file and is ignored.
const changed = new Set(
  (fs.existsSync(CHANGED_FILE) ? fs.readFileSync(CHANGED_FILE, 'utf8') : '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(p => p.split('/')[2])
    .filter(Boolean)
);

let unchanged = 0;
for (const result of results) {
  if (result.status !== 'success') continue;
  result.files_changed = changed.has(result.winget_id);
  if (!result.files_changed) unchanged++;
}

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));

const successes = results.filter(r => r.status === 'success').length;
console.log(
  `Annotated ${successes} successes: ${successes - unchanged} changed files, ` +
    `${unchanged} already matched what is committed`
);
