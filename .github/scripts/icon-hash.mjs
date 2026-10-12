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
 * Nothing is measured on raw pixels. Greyscale conversion discards the alpha
 * channel, so a monochrome glyph drawn on a transparent background reads as a
 * uniform field: AltDrag's black cursor, AlgoKit's black logo and fifty-nine
 * other perfectly good icons all produced an identical all-zero hash and an
 * identical pixel digest, and were deleted as empty images. Compositing over
 * an opaque background is what makes the shape visible to the maths.
 *
 * The fingerprints composite over white, which keeps them comparable with the
 * recorded blocklist values. The blank test cannot afford a fixed background
 * in either direction, since a white glyph vanishes against white just as a
 * black one vanishes against black, so it measures both and keeps the larger.
 *
 * Compositing is done arithmetically here rather than through sharp, because
 * these values gate deletions and must not shift under a library upgrade.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const HASH_SIZE = 8;
export const PIXEL_KEY_SIZE = 32;
export const ICON_SIZE_PREFERENCE = [256, 128, 64];

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

/**
 * Composite over an opaque background and reduce to greyscale, doing both by
 * hand rather than through sharp's flatten/greyscale operators.
 *
 * These numbers decide whether files get deleted, so they must not move when
 * the image library is upgraded. They did: sharp 0.34.5 and 0.35.3 disagree
 * about flatten, and a purge run on 0.34.5 removed 27 white-on-transparent
 * logos that 0.35.3 scored as having plenty of detail. Explicit alpha
 * compositing and an explicit luma weighting give the same answer on any
 * version.
 */
async function greyscaleRaster(filePath, size, background) {
  const { data } = await sharp(filePath)
    .resize(size, size, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(size * size);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    const alpha = data[i + 3] / 255;
    const r = data[i] * alpha + background.r * (1 - alpha);
    const g = data[i + 1] * alpha + background.g * (1 - alpha);
    const b = data[i + 2] * alpha + background.b * (1 - alpha);
    out[p] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return out;
}

function stdDev(data) {
  const mean = data.reduce((a, b) => a + b, 0) / data.length;
  return Math.sqrt(data.reduce((a, b) => a + (b - mean) ** 2, 0) / data.length);
}

/** 64-bit average hash of an image, as a string of '0'/'1'. */
export async function averageHash(filePath) {
  const data = await greyscaleRaster(filePath, HASH_SIZE, WHITE);

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
  const data = await greyscaleRaster(filePath, PIXEL_KEY_SIZE, WHITE);
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

/**
 * How much detail an image carries, measured independently of the background
 * it is composited onto.
 *
 * A single background is not safe in either direction: a black glyph on
 * transparency vanishes against black, and a white glyph vanishes against
 * white. Either would be scored as empty and deleted. An image is only
 * genuinely featureless when it is flat against both, so take the larger of
 * the two. AltDrag's cursor scores 102.9 on white and 0.0 on black; a truly
 * empty icon scores 0.0 on both.
 */
export async function greyscaleStdDev(filePath) {
  const [onWhite, onBlack] = await Promise.all([
    greyscaleRaster(filePath, PIXEL_KEY_SIZE, WHITE),
    greyscaleRaster(filePath, PIXEL_KEY_SIZE, BLACK)
  ]);
  return Math.max(stdDev(onWhite), stdDev(onBlack));
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
