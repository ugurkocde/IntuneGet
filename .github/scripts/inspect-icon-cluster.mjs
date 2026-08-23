#!/usr/bin/env node
/**
 * Inspects an average-hash cluster before it is trusted as a blocklist entry.
 *
 * audit-duplicate-icons.mjs reports clusters of icons that share an 8x8
 * average hash. That is enough to say "these look alike at 64 bits", which is
 * not enough to say "these are the same picture". ArtisteerLimited.Nicepage
 * and Arihant25.Chargle share a hash and are entirely different logos.
 *
 * This resolves a cluster into distinct pictures by pixel digest, so you can
 * see whether it is one generic image repeated (safe to blocklist) or a pile
 * of unrelated real icons that merely collide (never blocklist). It prints the
 * pixel_keys array ready to paste, and a sample package per picture so each
 * can be eyeballed first.
 *
 *   node .github/scripts/inspect-icon-cluster.mjs <64-bit-average-hash> [radius]
 */

import fs from 'node:fs';
import path from 'node:path';
import { averageHash, pixelKey, hamming, bestIconPath, greyscaleStdDev } from './icon-hash.mjs';

const ICONS_DIR = process.env.ICONS_DIR || 'public/icons';
const target = process.argv[2];
const radius = parseInt(process.argv[3] || '2', 10);

if (!target || !/^[01]{64}$/.test(target)) {
  console.error('Usage: inspect-icon-cluster.mjs <64-bit average hash> [radius]');
  process.exit(1);
}

const dirs = fs
  .readdirSync(ICONS_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

const pictures = new Map();
let members = 0;

for (const id of dirs) {
  const file = bestIconPath(path.join(ICONS_DIR, id));
  if (!file) continue;
  let hash;
  try {
    hash = await averageHash(file);
  } catch {
    continue;
  }
  if (hamming(hash, target) > radius) continue;
  members++;

  let key;
  try {
    key = await pixelKey(file);
  } catch {
    continue;
  }
  if (!pictures.has(key)) pictures.set(key, { count: 0, sample: id, file });
  pictures.get(key).count++;
}

const ranked = [...pictures.entries()].sort((a, b) => b[1].count - a[1].count);

console.log(`Average hash ${target} (radius ${radius})`);
console.log(`Members: ${members}   Distinct pictures: ${ranked.length}\n`);

for (const [key, info] of ranked) {
  const share = Math.round((100 * info.count) / members);
  const sd = await greyscaleStdDev(info.file).catch(() => NaN);
  console.log(
    `  ${key}  ${String(info.count).padStart(4)} (${String(share).padStart(3)}%)  sd=${sd.toFixed(1).padStart(6)}  e.g. ${info.sample}`
  );
}

// A cluster that is one image repeated resolves to very few pictures. One that
// resolves to dozens is the average hash colliding on unrelated logos, and
// blocklisting its hash would delete real icons.
console.log('');
if (ranked.length > 5) {
  console.log(
    `VERDICT: ${ranked.length} distinct pictures share this hash. That is a collision, not a shared placeholder. Do NOT blocklist it.`
  );
} else {
  console.log(
    `VERDICT: resolves to ${ranked.length} picture(s). Inspect each sample above; if every one is toolkit artwork, these pixel_keys are safe to add:`
  );
  console.log(JSON.stringify(ranked.map(([k]) => k), null, 2));
}
