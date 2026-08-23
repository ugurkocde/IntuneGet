/**
 * audit-duplicate-icons.mjs
 *
 * Wrong-icon detector: computes an 8x8 average hash for every package's
 * largest icon and reports clusters of packages that ship pixel-identical
 * icons. Large clusters are almost always a publisher-level image (an org
 * avatar or favicon shared by every product of that publisher, e.g. the
 * Mozilla gift box appearing on all Firefox/Thunderbird variants) or a
 * generic placeholder -- both mean the real product icon is missing.
 *
 * Read-only: writes icon-audit.json and prints a step summary. Never fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { averageHash, hamming, bestIconPath } from './icon-hash.mjs';

const ICONS_DIR = process.env.ICONS_DIR || 'public/icons';

async function main() {
  if (!fs.existsSync(ICONS_DIR)) {
    console.log('No icons directory - nothing to audit');
    return;
  }

  const packages = fs.readdirSync(ICONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  const entries = [];
  for (const pkg of packages) {
    const p = bestIconPath(path.join(ICONS_DIR, pkg));
    if (!p) continue;
    try {
      entries.push({ winget_id: pkg, publisher: pkg.split('.')[0], file: p, hash: await averageHash(p) });
    } catch (err) {
      console.warn(`Failed to hash ${pkg}: ${err.message}`);
    }
  }

  // Exact-match clusters.
  const byHash = new Map();
  for (const e of entries) {
    if (!byHash.has(e.hash)) byHash.set(e.hash, []);
    byHash.get(e.hash).push(e);
  }

  // Merge near-duplicates (hamming <= 2) into the same cluster so resampled
  // variants of the same source image land together.
  const clusters = [];
  for (const [hash, members] of [...byHash.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const existing = clusters.find(c => hamming(c.hash, hash) <= 2);
    if (existing) existing.members.push(...members);
    else clusters.push({ hash, members });
  }

  const suspicious = clusters
    .filter(c => c.members.length >= 3)
    .map(c => {
      const publishers = {};
      for (const m of c.members) publishers[m.publisher] = (publishers[m.publisher] || 0) + 1;
      const topPublisher = Object.entries(publishers).sort((a, b) => b[1] - a[1])[0];
      const dominantShare = topPublisher[1] / c.members.length;
      return {
        // Reported so a cluster confirmed to be non-product artwork can be
        // copied straight into .github/data/generic-icon-hashes.json.
        hash: c.hash,
        cluster_size: c.members.length,
        dominant_publisher: topPublisher[0],
        dominant_publisher_share: Number(dominantShare.toFixed(2)),
        classification: topPublisher[1] >= 5 && dominantShare >= 0.5
          ? 'likely_publisher_level_icon'
          : 'possibly_generic_placeholder',
        sample_packages: c.members.slice(0, 25).map(m => m.winget_id),
      };
    })
    .sort((a, b) => b.cluster_size - a.cluster_size);

  const flaggedPackages = new Set();
  for (const c of suspicious) for (const id of c.sample_packages) flaggedPackages.add(id);

  fs.writeFileSync('icon-audit.json', JSON.stringify({
    generated_at: new Date().toISOString(),
    total_icons_audited: entries.length,
    suspicious_clusters: suspicious.length,
    flagged_sample_packages: [...flaggedPackages],
    clusters: suspicious.slice(0, 100),
  }, null, 2));

  console.log(`\n=== Icon Audit ===`);
  console.log(`Icons audited: ${entries.length}`);
  console.log(`Suspicious duplicate clusters (>=3 identical icons): ${suspicious.length}`);

  if (process.env.GITHUB_STEP_SUMMARY && suspicious.length > 0) {
    const lines = [
      '## Duplicate Icon Audit',
      '',
      `Audited **${entries.length}** icons. Found **${suspicious.length}** clusters where 3+ packages share a near-identical icon.`,
      '',
      '| Cluster | Dominant publisher | Share | Classification |',
      '|---|---|---|---|',
    ];
    for (const c of suspicious.slice(0, 20)) {
      lines.push(`| ${c.cluster_size} | ${c.dominant_publisher} | ${Math.round(c.dominant_publisher_share * 100)}% | \`${c.classification}\` |`);
    }
    lines.push('', 'Full report: `icon-audit.json` artifact.');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  }
}

main().catch(err => {
  console.error(`Icon audit failed (non-blocking): ${err.message}`);
});
