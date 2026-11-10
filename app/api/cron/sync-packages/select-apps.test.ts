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
  blockRows?: Array<{ winget_id: string }>;
  blockedAppRows?: AppRow[];
  rankedError?: { message: string };
  unsyncedError?: { message: string };
  blocksError?: { message: string };
}) {
  const from = vi.fn((table: string) => {
    let isUnsyncedQuery = false;
    let isBlockedAppsQuery = false;
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.is = vi.fn(() => {
      // .is('latest_version', null) only appears on the never-synced query
      isUnsyncedQuery = true;
      return chain;
    });
    chain.in = vi.fn(() => {
      // .in('winget_id', ids) only appears on the blocked-app lookup
      isBlockedAppsQuery = true;
      return chain;
    });
    chain.order = vi.fn(() => chain);
    chain.limit = vi.fn(async () => {
      if (table === 'package_eligibility_blocks') {
        return { data: options.blockRows || [], error: options.blocksError || null };
      }
      if (isBlockedAppsQuery) return { data: options.blockedAppRows || [], error: null };
      if (isUnsyncedQuery) {
        return { data: options.unsyncedRows || [], error: options.unsyncedError || null };
      }
      return { data: options.rankedRows || [], error: options.rankedError || null };
    });
    return chain;
  });

  return { from } as unknown as SupabaseClient;
}

type MockChain = { eq: ReturnType<typeof vi.fn>; in: ReturnType<typeof vi.fn> };

function chainsFor(supabase: SupabaseClient, table: string): MockChain[] {
  const fromMock = supabase.from as unknown as ReturnType<typeof vi.fn>;
  return fromMock.mock.calls
    .map((call: unknown[], index: number) => ({ table: call[0], chain: fromMock.mock.results[index].value }))
    .filter((entry: { table: unknown }) => entry.table === table)
    .map((entry: { chain: unknown }) => entry.chain as MockChain);
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

  it('restricts the ranked and never-synced selections to verified Win32 WinGet packages', async () => {
    const supabase = createSupabaseMock({});

    await selectAppsToSync(supabase);

    const queryChains = chainsFor(supabase, 'curated_apps');
    expect(queryChains).toHaveLength(2);
    for (const chain of queryChains) {
      expect(chain.eq).toHaveBeenCalledWith('is_verified', true);
      expect(chain.eq).toHaveBeenCalledWith('is_winget_verified', true);
      expect(chain.eq).toHaveBeenCalledWith('app_source', 'win32');
    }
  });

  it('re-checks apps blocked as upstream_removed even though they are unverified', async () => {
    const supabase = createSupabaseMock({
      rankedRows: [{ winget_id: 'Microsoft.Edge', latest_version: '120.0.0' }],
      blockRows: [{ winget_id: 'Google.Chrome' }],
      blockedAppRows: [{ winget_id: 'Google.Chrome', latest_version: '157.0.8103.39' }],
    });

    const apps = await selectAppsToSync(supabase);

    expect(apps.map((a) => [a.winget_id, Boolean(a.upstream_removed_block)])).toEqual([
      ['Google.Chrome', true],
      ['Microsoft.Edge', false],
    ]);
    const [blockQuery] = chainsFor(supabase, 'package_eligibility_blocks');
    expect(blockQuery.eq).toHaveBeenCalledWith('block_code', 'upstream_removed');
    const blockedLookup = chainsFor(supabase, 'curated_apps')[2];
    expect(blockedLookup.in).toHaveBeenCalledWith('winget_id', ['Google.Chrome']);
    expect(blockedLookup.eq).not.toHaveBeenCalledWith('is_verified', true);
    expect(blockedLookup.eq).toHaveBeenCalledWith('app_source', 'win32');
  });

  it('throws when a query fails', async () => {
    const supabase = createSupabaseMock({
      rankedError: { message: 'connection refused' },
    });

    await expect(selectAppsToSync(supabase)).rejects.toEqual({
      message: 'connection refused',
    });
  });

  it('throws when the block lookup fails', async () => {
    const supabase = createSupabaseMock({ blocksError: { message: 'blocks unavailable' } });

    await expect(selectAppsToSync(supabase)).rejects.toEqual({ message: 'blocks unavailable' });
  });
});
