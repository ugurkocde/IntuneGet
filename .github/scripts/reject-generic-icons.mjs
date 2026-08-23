#!/usr/bin/env node
/**
 * Rejects extracted icons that are installer-toolkit defaults rather than
 * product icons.
 *
 * Binary extraction is authoritative when the installer embeds a real app
 * icon. When it does not, extraction still succeeds and returns whatever
 * artwork the wrapper carries: the Windows generic-application glyph, the
 * Windows Installer disc, an install arrow. Recorded as an app's icon, that is
 * worse than recording nothing, because every app packaged with the same
 * toolkit ends up visually identical. A scan of the catalog found 769 packages
 * sharing one such image and roughly 1,900 in total.
 *
 * Runs after extract-icons-batch.ps1 and before the shard is packaged. For
 * each successful result whose icon matches the blocklist it:
 *   - restores the icon files to their committed state, so the shard's diff
 *     carries no generic artwork into the publication PR, and
 *   - rewrites the result as failed with reason `generic_installer_icon`,
 *     so the database records an attempt instead of a false success.
 *
 * Environment: RESULTS_FILE (default icon-results.json), ICONS_DIR (default
 * public/icons).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { averageHash, bestIconPath, loadGenericHashes, matchGeneric } from './icon-hash.mjs';

const RESULTS_FILE = process.env.RESULTS_FILE || 'icon-results.json';
const ICONS_DIR = process.env.ICONS_DIR || 'public/icons';

/**
 * Undo this run's writes for one package. `git checkout` restores a directory
 * that was already tracked; a directory that is new to this run has nothing to
 * restore and is removed outright.
 */
function restoreIconDir(dir) {
  try {
    execFileSync('git', ['checkout', '--', dir], { stdio: 'pipe' });
    return 'restored';
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    return 'removed';
  }
}

async function main() {
  if (!fs.existsSync(RESULTS_FILE)) {
    console.log(`${RESULTS_FILE} not found - nothing to screen`);
    return;
  }

  const blocklist = loadGenericHashes();
  console.log(`Screening against ${blocklist.hashes.length} known non-product images`);

  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
  const counts = {};
  let rejected = 0;

  for (const result of results) {
    if (result.status !== 'success') continue;
    // Family-inherited icons are a copy of an ancestor that was itself
    // screened when it was extracted, so re-checking them would only reject
    // the same image twice and strand the variant.
    if (result.icon_source === 'family_inherited') continue;

    const dir = path.join(ICONS_DIR, result.winget_id);
    const iconPath = bestIconPath(dir);
    if (!iconPath) continue;

    let hash;
    try {
      hash = await averageHash(iconPath);
    } catch (err) {
      console.warn(`Could not hash ${result.winget_id}: ${err.message}`);
      continue;
    }

    const match = matchGeneric(hash, blocklist);
    if (!match) continue;

    const disposition = restoreIconDir(dir);
    result.status = 'failed';
    result.failure_reason = 'generic_installer_icon';
    result.error = `Extracted image is a known non-product icon (${match.label})`;
    delete result.icon_path;
    delete result.icon_source;

    counts[match.label] = (counts[match.label] || 0) + 1;
    rejected++;
    console.log(`Rejected ${result.winget_id}: ${match.label} (${disposition})`);
  }

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

  console.log(`\n=== Generic Icon Screen ===`);
  console.log(`Rejected: ${rejected}`);
  for (const [label, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${label}: ${n}`);
  }

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary && rejected > 0) {
    fs.appendFileSync(
      summary,
      [
        '## Generic Icon Screen',
        '',
        `Rejected **${rejected}** extracted icons that matched a known installer-toolkit default.`,
        '',
        ...Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([label, n]) => `- \`${label}\`: ${n}`),
        ''
      ].join('\n')
    );
  }
}

main().catch(err => {
  console.error(`Generic icon screen failed: ${err.message}`);
  process.exit(1);
});
