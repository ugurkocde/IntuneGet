import { describe, expect, it, vi } from 'vitest';
import type { CatalogSource } from '@/lib/catalog/types';
import { withCuratedUpdates } from './catalog-source';

const approved = [{ winget_id: 'IntuneGet.Curated.Chrome', latest_version: '140.0' }];
const ordinary = [{ winget_id: 'Google.Chrome', latest_version: '141.0' }];
describe('independent curated update lookups', () => {
  it('never reads Winget for a curated-only request', async () => {
    const lookup = vi.fn(() => { throw new Error('Winget must not be touched'); });
    const catalog = withCuratedUpdates({ getAppsByWingetIds: lookup } as unknown as CatalogSource, async () => approved);
    expect(await catalog.getAppsByWingetIds(['IntuneGet.Curated.Chrome'])).toEqual(approved);
    expect(lookup).not.toHaveBeenCalled();
  });
  it('preserves approved curated updates during a Winget outage', async () => {
    const catalog = withCuratedUpdates({ getAllLatestVersions: vi.fn(async () => { throw new Error('offline'); }) } as unknown as CatalogSource, async () => approved);
    expect(await catalog.getAllLatestVersions()).toEqual(approved);
  });
  it('preserves Winget updates during a curated approval outage', async () => {
    const catalog = withCuratedUpdates({ getAllLatestVersions: vi.fn(async () => ordinary) } as unknown as CatalogSource, async () => { throw new Error('expired'); });
    expect(await catalog.getAllLatestVersions()).toEqual(ordinary);
  });
  it('filters each source and binds requested identifiers case-insensitively', async () => {
    const lookup = vi.fn(async () => [...ordinary, ...approved]);
    const catalog = withCuratedUpdates({ getAppsByWingetIds: lookup } as unknown as CatalogSource, async () => approved);
    expect(await catalog.getAppsByWingetIds(['Google.Chrome', 'intuneget.curated.chrome'])).toEqual([...ordinary, ...approved]);
    expect(lookup).toHaveBeenCalledWith(['Google.Chrome']);
  });
});
