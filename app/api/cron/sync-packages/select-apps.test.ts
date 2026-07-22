import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { selectAppsToSync } from '@/app/api/cron/sync-packages/select-apps';

interface AppRow {
  winget_id: string;
  latest_version: string | null;
}

function createSupabaseMock(options: {
  rankedRows?: AppRow[];
  unsyncedRows?: AppRow[];
  rankedError?: { message: string };
  unsyncedError?: { message: string };
}) {
  const from = vi.fn(() => {
    let isUnsyncedQuery = false;
    const filters: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    });
    chain.is = vi.fn(() => {
      // .is('latest_version', null) only appears on the never-synced query
      isUnsyncedQuery = true;
      return chain;
    });
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(async () =>
      ({
        ...(isUnsyncedQuery
          ? { data: options.unsyncedRows || [], error: options.unsyncedError || null }
          : { data: options.rankedRows || [], error: options.rankedError || null }),
        filters,
      })
    );
    return chain;
  });

  return { from } as unknown as SupabaseClient;
}

describe('selectAppsToSync', () => {
  it('merges ranked apps with never-synced apps', async () => {
    const supabase = createSupabaseMock({
      rankedRows: [
        { winget_id: 'Microsoft.Edge', latest_version: '120.0.0' },
        { winget_id: 'VideoLAN.VLC', latest_version: '3.0.20' },
      ],
      unsyncedRows: [{ winget_id: 'Anthropic.Claude', latest_version: null }],
    });

    const apps = await selectAppsToSync(supabase);

    expect(apps.map((a) => a.winget_id)).toEqual([
      'Microsoft.Edge',
      'VideoLAN.VLC',
      'Anthropic.Claude',
    ]);
  });

  it('deduplicates apps that appear in both queries', async () => {
    const supabase = createSupabaseMock({
      rankedRows: [
        { winget_id: 'Microsoft.Edge', latest_version: '120.0.0' },
        { winget_id: 'New.App', latest_version: null },
      ],
      unsyncedRows: [
        { winget_id: 'New.App', latest_version: null },
        { winget_id: 'Another.App', latest_version: null },
      ],
    });

    const apps = await selectAppsToSync(supabase);

    expect(apps).toHaveLength(3);
    expect(apps.filter((a) => a.winget_id === 'New.App')).toHaveLength(1);
  });

  it('returns empty array when no apps match', async () => {
    const supabase = createSupabaseMock({});

    const apps = await selectAppsToSync(supabase);

    expect(apps).toEqual([]);
  });

  it('restricts both selections to verified Win32 WinGet packages', async () => {
    const supabase = createSupabaseMock({});

    await selectAppsToSync(supabase);

    const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;
    const queryChains = fromMock.mock.results
      .map((result: { value: unknown }) => result.value as { eq: ReturnType<typeof vi.fn> });
    expect(queryChains).toHaveLength(2);
    for (const chain of queryChains) {
      expect(chain.eq).toHaveBeenCalledWith('is_verified', true);
      expect(chain.eq).toHaveBeenCalledWith('is_winget_verified', true);
      expect(chain.eq).toHaveBeenCalledWith('app_source', 'win32');
    }
  });

  it('throws when a query fails', async () => {
    const supabase = createSupabaseMock({
      rankedError: { message: 'connection refused' },
    });

    await expect(selectAppsToSync(supabase)).rejects.toEqual({
      message: 'connection refused',
    });
  });
});
