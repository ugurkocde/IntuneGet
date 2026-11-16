import { afterEach, expect, it, vi } from 'vitest';
import envelope from '@/catalog/curated/catalog.json';
import keys from '@/catalog/curated/trusted-keys.json';
import { CURATED_APPS } from './definitions';
import { catalogEntries, verifyCatalogReleases } from './core.mjs';
import { getCuratedCatalog } from './server';

afterEach(() => vi.unstubAllEnvs());

it('preserves approved releases from the committed signed catalog', () => {
  vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', '{}');
  const { payload } = verifyCatalogReleases(envelope, CURATED_APPS, keys);
  const approved = catalogEntries(CURATED_APPS, payload)
    .filter(entry => entry.status === 'approved' && entry.release)
    .map(entry => entry.app.id).sort();
  expect(approved.length).toBeGreaterThan(0);
  const served = getCuratedCatalog().entries
    .filter(entry => entry.status === 'approved' && entry.release)
    .map(entry => entry.app.id).sort();
  expect(served).toEqual(approved);
});
