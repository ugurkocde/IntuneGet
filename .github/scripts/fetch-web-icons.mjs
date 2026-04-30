/**
 * fetch-web-icons.mjs
 *
 * Multi-tier web icon fetcher for apps without icons.
 * Tier 2: GitHub publisher avatar (https://github.com/{publisher}.png?size=460)
 * Tier 3: Google S2 favicon (https://www.google.com/s2/favicons?domain={domain}&sz=256)
 *
 * Runs on Ubuntu -- no Windows APIs needed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MAX_APPS = parseInt(process.env.MAX_APPS || '500', 10);
const ICONS_DIR = process.env.ICONS_DIR || 'public/icons';
const ICON_SIZES = [32, 64, 128, 256];
// When true, target apps that already have an icon and only generate sizes
// that are missing on disk. Re-uses each app's original icon_source so the
// new size stays visually consistent with the existing ones.
const MISSING_SIZES_ONLY = process.env.MISSING_SIZES_ONLY === 'true';

// Domains that should be skipped for favicon extraction (they host projects, not publishers)
const GENERIC_DOMAINS = new Set([
  'github.com',
  'gitlab.com',
  'sourceforge.net',
  'codeplex.com',
  'bitbucket.org',
  'launchpad.net',
  'npmjs.com',
  'pypi.org',
  'crates.io',
  'nuget.org',
  'microsoft.com',
  'google.com',
  'apple.com',
]);

// Minimum response sizes to filter out default/placeholder images
const MIN_GITHUB_AVATAR_BYTES = 1000;
const MIN_FAVICON_BYTES = 600;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Fetch with timeout support.
 */
async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'IntuneGet-IconFetcher/1.0' },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resize a source image buffer to the standard icon sizes and save to disk.
 * Returns true if at least the 64px icon was written.
 */
async function resizeAndSave(sourceBuffer, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  let sourceDim = 0;
  try {
    const meta = await sharp(sourceBuffer).metadata();
    sourceDim = Math.min(meta.width || 0, meta.height || 0);
  } catch {
    // metadata read failed — fall through and let resize attempts log their own errors
  }

  let success = false;
  let written = 0;
  for (const size of ICON_SIZES) {
    if (sourceDim && size > sourceDim) {
      // Skip upscaling — keeps the largest produced size honest
      continue;
    }
    const targetPath = path.join(outputDir, `icon-${size}.png`);
    if (MISSING_SIZES_ONLY && fs.existsSync(targetPath)) {
      // Don't overwrite sizes that were produced previously
      continue;
    }
    try {
      await sharp(sourceBuffer)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toFile(targetPath);
      success = true;
      written++;
    } catch (err) {
      console.warn(`  Failed to resize to ${size}px: ${err.message}`);
    }
  }
  return MISSING_SIZES_ONLY ? written > 0 : success;
}

/**
 * Tier 2: Try to fetch the publisher's GitHub avatar.
 * Returns the image buffer on success, null on failure.
 */
async function tryGitHubAvatar(publisher) {
  const url = `https://github.com/${encodeURIComponent(publisher)}.png?size=460`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < MIN_GITHUB_AVATAR_BYTES) {
      // Too small -- likely the default gravatar
      return null;
    }
    return buffer;
  } catch {
    return null;
  }
}

/**
 * Tier 3: Try to fetch a favicon via Google S2 for the app's homepage domain.
 * Returns the image buffer on success, null on failure.
 */
async function tryFavicon(homepage) {
  if (!homepage) return null;

  let domain;
  try {
    domain = new URL(homepage).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }

  if (GENERIC_DOMAINS.has(domain)) return null;

  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=256`;
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < MIN_FAVICON_BYTES) {
      // Too small -- Google returns a ~500-byte default globe for unknown domains
      return null;
    }
    return buffer;
  } catch {
    return null;
  }
}

/**
 * Fetch apps that need icons with pagination (Supabase caps at 1000 per query).
 */
async function fetchAppsNeedingIcons(limit) {
  const PAGE_SIZE = 1000;
  const apps = [];
  let offset = 0;

  while (apps.length < limit) {
    const batchSize = Math.min(PAGE_SIZE, limit - apps.length);
    let query = supabase
      .from('curated_apps')
      .select('winget_id, name, publisher, homepage, icon_source')
      .range(offset, offset + batchSize - 1);

    if (MISSING_SIZES_ONLY) {
      // Top-up mode: only apps that already have an icon from a web source.
      // Binary-extracted icons are handled by extract-icon.ps1.
      query = query
        .eq('has_icon', true)
        .in('icon_source', ['github_avatar', 'favicon']);
    } else {
      query = query.or('has_icon.is.null,has_icon.eq.false');
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to query apps:', error.message);
      process.exit(1);
    }

    if (data.length === 0) break;
    apps.push(...data);
    offset += data.length;

    // If we got fewer than requested, there are no more rows
    if (data.length < batchSize) break;
  }

  return apps;
}

/**
 * Main: query apps that need icons, try each tier, save results.
 */
async function main() {
  const apps = await fetchAppsNeedingIcons(MAX_APPS);

  if (MISSING_SIZES_ONLY) {
    console.log(`Found ${apps.length} web-iconed apps to top up with missing sizes`);
  } else {
    console.log(`Found ${apps.length} apps without icons`);
  }

  const results = [];
  let githubHits = 0;
  let faviconHits = 0;
  let misses = 0;

  for (const app of apps) {
    const wingetId = app.winget_id;
    const publisher = wingetId.split('.')[0];
    const outputDir = path.join(ICONS_DIR, wingetId);

    if (MISSING_SIZES_ONLY) {
      // Skip if every target size already exists on disk
      const allPresent = ICON_SIZES.every(s =>
        fs.existsSync(path.join(outputDir, `icon-${s}.png`))
      );
      if (allPresent) continue;
    } else {
      // Skip if icon files already exist on disk
      if (fs.existsSync(path.join(outputDir, 'icon-64.png'))) {
        continue;
      }
    }

    let source = null;
    let buffer = null;

    if (MISSING_SIZES_ONLY) {
      // Re-use the source that originally produced this app's icon so the
      // newly added size matches the existing ones visually.
      if (app.icon_source === 'github_avatar') {
        buffer = await tryGitHubAvatar(publisher);
        if (buffer) source = 'github_avatar';
      } else if (app.icon_source === 'favicon') {
        buffer = await tryFavicon(app.homepage);
        if (buffer) source = 'favicon';
      }
    } else {
      // Tier 2: GitHub avatar
      buffer = await tryGitHubAvatar(publisher);
      if (buffer) {
        source = 'github_avatar';
      }

      // Tier 3: Favicon (only if Tier 2 failed and homepage exists)
      if (!buffer && app.homepage) {
        buffer = await tryFavicon(app.homepage);
        if (buffer) {
          source = 'favicon';
        }
      }
    }

    if (buffer && source) {
      const saved = await resizeAndSave(buffer, outputDir);
      if (saved) {
        console.log(`  [${source}] ${wingetId}${MISSING_SIZES_ONLY ? ' (topped up)' : ''}`);
        results.push({
          winget_id: wingetId,
          status: 'success',
          icon_source: source,
          icon_path: `/icons/${wingetId}/`,
        });
        if (source === 'github_avatar') githubHits++;
        else faviconHits++;
        continue;
      }
    }

    misses++;
    results.push({
      winget_id: wingetId,
      status: 'skipped',
      reason: MISSING_SIZES_ONLY ? 'source_unavailable_for_topup' : 'no_web_icon_available',
    });
  }

  console.log('\n=== Web Icon Fetch Summary ===');
  console.log(`GitHub avatars: ${githubHits}`);
  console.log(`Favicons: ${faviconHits}`);
  console.log(`No icon found: ${misses}`);
  console.log(`Total processed: ${apps.length}`);

  fs.writeFileSync('web-icon-results.json', JSON.stringify(results, null, 2));

  // Write counts for GitHub Actions output
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `github_hits=${githubHits}\n`);
    fs.appendFileSync(outputFile, `favicon_hits=${faviconHits}\n`);
    fs.appendFileSync(outputFile, `total_hits=${githubHits + faviconHits}\n`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
