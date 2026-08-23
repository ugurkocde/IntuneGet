/**
 * Shared icon fingerprinting.
 *
 * An 8x8 average hash is enough to answer the only question asked of it here:
 * are two icons the same picture? It is cheap, stable across the resamples the
 * pipeline performs, and comparable with a Hamming distance.
 *
 * Used by audit-duplicate-icons.mjs to cluster identical icons, and by
 * reject-generic-icons.mjs to recognise the installer-toolkit defaults listed
 * in .github/data/generic-icon-hashes.json.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const HASH_SIZE = 8;
export const ICON_SIZE_PREFERENCE = [256, 128, 64];

/** 64-bit average hash of an image, as a string of '0'/'1'. */
export async function averageHash(filePath) {
  const { data } = await sharp(filePath)
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  let bits = '';
  for (const byte of data) bits += byte > avg ? '1' : '0';
  return bits;
}

export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** Largest icon a package directory ships, or null if it has none. */
export function bestIconPath(dir) {
  for (const size of ICON_SIZE_PREFERENCE) {
    const p = path.join(dir, `icon-${size}.png`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function loadGenericHashes(
  file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'data',
    'generic-icon-hashes.json'
  )
) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    maxDistance: parsed.max_hamming_distance ?? 2,
    hashes: parsed.hashes ?? []
  };
}

/**
 * Returns the matching blocklist entry, or null when the icon is not one of
 * the known non-product images.
 */
export function matchGeneric(hash, { maxDistance, hashes }) {
  for (const entry of hashes) {
    if (hamming(hash, entry.hash) <= maxDistance) return entry;
  }
  return null;
}
