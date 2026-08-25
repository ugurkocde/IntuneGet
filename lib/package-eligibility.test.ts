import { describe, expect, it, vi } from 'vitest';
import {
  getCatalogExclusion,
  getPackageEligibilityBlocks,
} from '@/lib/package-eligibility';

function query(result: { data: unknown; error: { message: string } | null }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & {
    then?: Promise<unknown>['then'];
  } = {
    select: vi.fn(),
    in: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.then = (onFulfilled, onRejected) =>
    Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

function singleRowQuery(result: { data: unknown; error: { message: string } | null }) {
  const builder = {
    select: vi.fn(),
    ilike: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  builder.select.mockReturnValue(builder);
  builder.ilike.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  return builder;
}

describe('getCatalogExclusion', () => {
  it('returns the canonical id and reason for a denylisted package', async () => {
    const builder = singleRowQuery({
      data: {
        winget_id: 'WinSCP.WinSCP',
        reason: 'SourceForge installers fail to download in CI',
      },
      error: null,
    });
    const client = { from: vi.fn(() => builder) };

    const result = await getCatalogExclusion(client as never, ' winscp.winscp ');

    expect(client.from).toHaveBeenCalledWith('curated_excluded_apps');
    expect(builder.ilike).toHaveBeenCalledWith('winget_id', 'winscp.winscp');
    expect(result).toEqual({
      wingetId: 'WinSCP.WinSCP',
      reason: 'SourceForge installers fail to download in CI',
    });
  });

  it('returns null for packages that are not excluded', async () => {
    const client = {
      from: vi.fn(() => singleRowQuery({ data: null, error: null })),
    };

    await expect(getCatalogExclusion(client as never, 'Example.App')).resolves.toBeNull();
  });

  it('does not query Supabase for a blank id', async () => {
    const client = { from: vi.fn() };

    await expect(getCatalogExclusion(client as never, '  ')).resolves.toBeNull();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('fails closed when the denylist cannot be read', async () => {
    const client = {
      from: vi.fn(() => singleRowQuery({ data: null, error: { message: 'database unavailable' } })),
    };

    await expect(getCatalogExclusion(client as never, 'Example.App')).rejects.toThrow(
      'Could not verify package availability: database unavailable'
    );
  });
});

describe('getPackageEligibilityBlocks', () => {
  it('deduplicates requested IDs and returns only application-level blocks', async () => {
    const builder = query({
      data: [{ winget_id: 'Autodesk.DesktopApp', block_code: 'vendor_retired' }],
      error: null,
    });
    const client = { from: vi.fn(() => builder) };

    const result = await getPackageEligibilityBlocks(client as never, [
      ' Autodesk.DesktopApp ',
      'Autodesk.DesktopApp',
      '',
    ]);

    expect(client.from).toHaveBeenCalledWith('package_eligibility_blocks');
    expect(builder.select).toHaveBeenCalledWith('winget_id, block_code');
    expect(builder.in).toHaveBeenCalledWith('winget_id', ['Autodesk.DesktopApp']);
    expect(result).toEqual([
      { wingetId: 'Autodesk.DesktopApp', code: 'vendor_retired' },
    ]);
  });

  it('does not query Supabase when no catalog IDs are present', async () => {
    const client = { from: vi.fn() };

    await expect(getPackageEligibilityBlocks(client as never, [])).resolves.toEqual([]);
    expect(client.from).not.toHaveBeenCalled();
  });

  it('fails closed when package availability cannot be verified', async () => {
    const client = {
      from: vi.fn(() => query({ data: null, error: { message: 'database unavailable' } })),
    };

    await expect(
      getPackageEligibilityBlocks(client as never, ['Example.App'])
    ).rejects.toThrow('Could not verify package availability: database unavailable');
  });
});
