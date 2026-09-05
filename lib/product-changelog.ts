import config from '@/.ugurlabs/changelog.json';

export const CHANGELOG_FEED_URL = `${config.apiUrl}/${config.productId}?limit=20`;
export const CHANGELOG_ARCHIVE_URL = `https://changelog.ugurlabs.com/?product=${config.productId}`;
export const CHANGELOG_SEEN_KEY = `ugurlabs:changelog:last-seen:${config.productId}`;
export const CHANGELOG_SEEN_EVENT = 'intuneget:changelog-seen';
const CACHE_TTL_MS = 5 * 60_000;

export interface ProductChangelogEntry {
  id: string;
  title: string;
  summary: string;
  publishedOn: string;
}

export interface ProductChangelogFeed {
  product: { id: string; name: string; websiteUrl: string };
  entries: ProductChangelogEntry[];
}

let cachedFeed: { value: ProductChangelogFeed; expiresAt: number } | undefined;
let pendingRequest: Promise<ProductChangelogFeed> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseProductChangelog(value: unknown): ProductChangelogFeed {
  if (!isRecord(value) || !isRecord(value.product) ||
      value.product.id !== config.productId || typeof value.product.name !== 'string' ||
      typeof value.product.websiteUrl !== 'string' || !Array.isArray(value.entries) || value.entries.length > 100) {
    throw new Error('Invalid product updates response');
  }
  const ids = new Set<string>();
  const entries = value.entries.map((entry): ProductChangelogEntry => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id ||
        typeof entry.title !== 'string' || !entry.title.trim() || entry.title.length > 160 ||
        typeof entry.summary !== 'string' || entry.summary.length > 2000 ||
        typeof entry.publishedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.publishedOn)) {
      throw new Error('Invalid product update');
    }
    const date = new Date(`${entry.publishedOn}T00:00:00Z`);
    if (!Number.isFinite(date.valueOf()) || date.toISOString().slice(0, 10) !== entry.publishedOn || ids.has(entry.id)) {
      throw new Error('Invalid product update date or ID');
    }
    ids.add(entry.id);
    return { id: entry.id, title: entry.title, summary: entry.summary, publishedOn: entry.publishedOn };
  });
  return {
    product: { id: value.product.id, name: value.product.name, websiteUrl: value.product.websiteUrl },
    entries,
  };
}

// Public, credential-free reads are shared across navigation instances. A
// request belongs to this cache, so closing one panel does not abort another.
export function fetchProductChangelog(): Promise<ProductChangelogFeed> {
  if (cachedFeed && cachedFeed.expiresAt > Date.now()) return Promise.resolve(cachedFeed.value);
  if (pendingRequest) return pendingRequest;
  pendingRequest = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(CHANGELOG_FEED_URL, {
        headers: { Accept: 'application/json' }, credentials: 'omit', signal: controller.signal,
      });
      if (!response.ok) throw new Error('Product updates are temporarily unavailable');
      const value = parseProductChangelog(await response.json());
      cachedFeed = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    } finally {
      clearTimeout(timeout);
    }
  })().finally(() => { pendingRequest = undefined; });
  return pendingRequest;
}

export function readChangelogSeen(): string | null {
  try { return window.localStorage.getItem(CHANGELOG_SEEN_KEY); } catch { return null; }
}

export function markChangelogSeen(id: string): void {
  try { window.localStorage.setItem(CHANGELOG_SEEN_KEY, id); } catch { /* Keep the panel usable without storage. */ }
  window.dispatchEvent(new CustomEvent(CHANGELOG_SEEN_EVENT, { detail: id }));
}

export function changelogEntryUrl(id: string): string {
  return `${CHANGELOG_ARCHIVE_URL}#change-${encodeURIComponent(id.toLowerCase())}`;
}
