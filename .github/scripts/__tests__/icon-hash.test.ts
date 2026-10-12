import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  averageHash,
  pixelKey,
  greyscaleStdDev,
  hamming,
  classifyIcon,
  loadGenericHashes,
} from '../icon-hash.mjs';

/**
 * These guard the two mistakes that already cost real icons.
 *
 * The generic-icon screen deletes files and flips database rows, and both of
 * its failure modes were silent: an average-hash collision looked exactly like
 * a genuine match, and an alpha-blind measurement made every black-on-
 * transparent logo look like an empty image. Fixtures are generated here
 * rather than committed so the test states the property being relied on.
 */

const tmp = path.join(os.tmpdir(), 'icon-hash-test');

async function writeIcon(name: string, svg: string): Promise<string> {
  const file = path.join(tmp, `${name}.png`);
  await sharp(Buffer.from(svg)).resize(256, 256).png().toFile(file);
  return file;
}

/** A monochrome glyph on a transparent canvas: the class that broke. */
const BLACK_ON_TRANSPARENT = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <rect x="20" y="20" width="90" height="90" rx="16" fill="#000"/>
  <rect x="146" y="20" width="90" height="90" rx="16" fill="#000"/>
  <rect x="20" y="146" width="90" height="90" rx="16" fill="#000"/>
  <rect x="146" y="146" width="90" height="90" rx="16" fill="#000"/>
</svg>`;

/** A different monochrome glyph on transparent: must not collide with the above. */
const OTHER_BLACK_ON_TRANSPARENT = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <circle cx="128" cy="128" r="96" fill="#000"/>
</svg>`;

/** The mirror case: a white glyph on transparent vanishes against white. */
const WHITE_ON_TRANSPARENT = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <circle cx="128" cy="128" r="96" fill="#fff"/>
</svg>`;

/** Genuinely featureless. */
const SOLID = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <rect width="256" height="256" fill="#1b1b2f"/>
</svg>`;

let glyph: string;
let otherGlyph: string;
let whiteGlyph: string;
let solid: string;

beforeAll(async () => {
  fs.mkdirSync(tmp, { recursive: true });
  glyph = await writeIcon('glyph', BLACK_ON_TRANSPARENT);
  otherGlyph = await writeIcon('other-glyph', OTHER_BLACK_ON_TRANSPARENT);
  whiteGlyph = await writeIcon('white-glyph', WHITE_ON_TRANSPARENT);
  solid = await writeIcon('solid', SOLID);
});

describe('alpha handling', () => {
  it('sees detail in a black glyph drawn on transparency', async () => {
    // Without flattening this measured 0 and the icon was deleted as blank.
    expect(await greyscaleStdDev(glyph)).toBeGreaterThan(20);
  });

  it('sees detail in a white glyph drawn on transparency', async () => {
    // The mirror of the above: flattening onto white alone would erase this.
    expect(await greyscaleStdDev(whiteGlyph)).toBeGreaterThan(20);
  });

  it('still reports a genuinely flat image as featureless', async () => {
    expect(await greyscaleStdDev(solid)).toBeLessThanOrEqual(4);
  });

  it('distinguishes two different glyphs on transparency', async () => {
    // Alpha-blind hashing collapsed 61 unrelated icons onto one digest.
    expect(await pixelKey(glyph)).not.toBe(await pixelKey(otherGlyph));
    expect(hamming(await averageHash(glyph), await averageHash(otherGlyph))).toBeGreaterThan(2);
  });
});

describe('classifyIcon', () => {
  const blocklist = loadGenericHashes();

  it('keeps a real black-on-transparent icon', async () => {
    expect(await classifyIcon(glyph, blocklist)).toBeNull();
  });

  it('keeps a real white-on-transparent icon', async () => {
    expect(await classifyIcon(whiteGlyph, blocklist)).toBeNull();
  });

  it('rejects an image with no detail', async () => {
    const match = await classifyIcon(solid, blocklist);
    expect(match?.label).toBe('blank_image');
  });

  it('never matches on the average hash alone', async () => {
    // An entry whose hash matches but whose pixel keys do not must not fire;
    // this is what stops a collision from deleting a real logo.
    const hash = await averageHash(glyph);
    const contrived = {
      maxDistance: 64, // matches anything
      blankMaxStdDev: 0, // blank rule off
      hashes: [{ hash, label: 'contrived', pixel_keys: ['0000000000000000'] }],
    };
    expect(await classifyIcon(glyph, contrived)).toBeNull();
  });

  it('matches when the hash and a pixel key agree', async () => {
    const contrived = {
      maxDistance: 64,
      blankMaxStdDev: 0,
      hashes: [
        { hash: await averageHash(glyph), label: 'contrived', pixel_keys: [await pixelKey(glyph)] },
      ],
    };
    expect((await classifyIcon(glyph, contrived))?.label).toBe('contrived');
  });

  it('treats an entry with no pixel keys as inert', async () => {
    const contrived = {
      maxDistance: 64,
      blankMaxStdDev: 0,
      hashes: [{ hash: await averageHash(glyph), label: 'half-filled' }],
    };
    expect(await classifyIcon(glyph, contrived)).toBeNull();
  });
});

describe('shipped blocklist', () => {
  it('gives every entry at least one pixel key', async () => {
    const { hashes } = loadGenericHashes();
    expect(hashes.length).toBeGreaterThan(0);
    for (const entry of hashes) {
      expect(entry.pixel_keys?.length, `${entry.label} has no pixel keys`).toBeGreaterThan(0);
    }
  });
});

describe('stability across image library versions', () => {
  /**
   * The recorded blocklist values are only meaningful if the same picture
   * hashes the same everywhere. It did not: sharp 0.34.5 and 0.35.3 disagreed
   * about flatten, and a purge run on CI's older version deleted 27
   * white-on-transparent logos that scored as detailed locally.
   *
   * Compositing is arithmetic now, so these are fixed points. If an upgrade
   * moves them, this fails and the blocklist gets recomputed deliberately
   * rather than a purge run quietly deleting a different set of files.
   */
  it('produces the documented fingerprints for a known raster', async () => {
    expect(await pixelKey(solid)).toBe('32c7fb6c11862c97');
    expect(await averageHash(solid)).toBe('0'.repeat(64));
  });

  it('scores a half-transparent field by its composited contrast', async () => {
    const file = path.join(tmp, 'half.png');
    // Half opaque black, half fully transparent: the two halves are identical
    // against black and maximally different against white.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
      <rect x="0" y="0" width="128" height="256" fill="#000"/>
    </svg>`;
    await sharp(Buffer.from(svg)).resize(256, 256).png().toFile(file);
    expect(await greyscaleStdDev(file)).toBeCloseTo(126.6, 0);
  });
});
