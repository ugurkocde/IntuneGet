/**
 * Shared icon fingerprinting.
 *
 * Two different questions get asked of an icon here, and they need two
 * different tools:
 *
 *   - "which icons look roughly alike?" -- an 8x8 average hash, used by
 *     audit-duplicate-icons.mjs to cluster the catalog.
 *   - "is this exactly the picture we decided to reject?" -- a 32x32 greyscale
 *     raster digest, used to confirm a blocklist hit.
 *
 * The average hash alone is not enough to decide the second question. It
 * collapses an icon to 64 bits, so any two flat logos with a centred glyph
 * land in the same bucket: ArtisteerLimited.Nicepage (a real product logo)
 * shares an average hash with Arihant25.Chargle. Deleting on that basis would
 * destroy real icons. So the average hash is only ever a cheap prefilter, and
 * a pixel digest has to agree before anything is rejected.
 *
 * Every measurement flattens onto white first. Greyscale conversion discards
 * the alpha channel, so a monochrome glyph drawn on a transparent background
 * reads as a uniform field: AltDrag's black cursor, AlgoKit's black logo and
 * fifty-nine other perfectly good icons all produced an identical all-zero
 * hash and an identical pixel digest. Compositing over an opaque background
 * first is what makes the shape visible to the maths.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const HASH_SIZE = 8;
export const PIXEL_KEY_SIZE = 32;
export const ICON_SIZE_PREFERENCE = [256, 128, 64];

/** Composite over white so transparency cannot masquerade as flat colour. */
function opaque(filePath) {
  return sharp(filePath).flatten({ background: { r: 255, g: 255, b: 255 } });
}

/** 64-bit average hash of an image, as a string of '0'/'1'. */
export async function averageHash(filePath) {
  const { data } = await opaque(filePath)
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  let bits = '';
  for (const byte of data) bits += byte > avg ? '1' : '0';
  return bits;
}

/**
 * Digest of the decoded pixels rather than the file. Two PNGs of the same
 * picture routinely differ byte for byte (different encoder, different resize
 * path), so hashing the file would report them as unrelated.
 */
export async function pixelKey(filePath) {
  const { data } = await opaque(filePath)
    .resize(PIXEL_KEY_SIZE, PIXEL_KEY_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/** Greyscale standard deviation. Near zero means the image carries no detail. */
export async function greyscaleStdDev(filePath) {
  const { data } = await opaque(filePath)
    .resize(PIXEL_KEY_SIZE, PIXEL_KEY_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  return Math.sqrt(data.reduce((a, b) => a + (b - mean) ** 2, 0) / data.length);
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
    blankMaxStdDev: parsed.blank_max_std_dev ?? 0,
    hashes: parsed.hashes ?? []
  };
}

/**
 * Decides whether an icon is one of the known non-product images.
 *
 * Returns the matching entry, or null. A hit requires the average hash to be
 * within the configured radius AND the pixel digest to be one this entry was
 * recorded with, so an average-hash collision with a real logo cannot reject
 * it. Entries carrying no pixel keys never match, which makes a half-filled
 * blocklist entry inert rather than dangerous.
 *
 * The separate blank rule is a property, not a picture: any image whose
 * greyscale standard deviation is near zero has no detail to show, whatever
 * its colour.
 */
export async function classifyIcon(filePath, blocklist) {
  if (blocklist.blankMaxStdDev > 0) {
    const sd = await greyscaleStdDev(filePath);
    if (sd <= blocklist.blankMaxStdDev) {
      return { label: 'blank_image', note: `no detail (greyscale sd ${sd.toFixed(2)})` };
    }
  }

  const hash = await averageHash(filePath);
  const near = blocklist.hashes.filter(e => hamming(hash, e.hash) <= blocklist.maxDistance);
  if (near.length === 0) return null;

  const key = await pixelKey(filePath);
  for (const entry of near) {
    if ((entry.pixel_keys ?? []).includes(key)) return entry;
  }
  return null;
}
