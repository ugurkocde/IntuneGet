import { describe, expect, it, vi } from 'vitest';
import { getPackageEligibilityBlocks } from '@/lib/package-eligibility';

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
