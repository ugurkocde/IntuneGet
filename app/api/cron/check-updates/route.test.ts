import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  catalog: [] as Array<{ winget_id: string; latest_version: string }>,
  failDeployedFetch: false,
}));

// Minimal in-memory stand-in for the Supabase query builder calls the cron uses.
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let mode: 'select' | 'delete' = 'select';
  let single = false;
  let limit: number | null = null;
  const rows = () => (state.tables[table] ??= []);

  const run = () => {
    if (table === 'upload_history' && mode === 'select' && state.failDeployedFetch && filters.length > 0) {
      return { data: null, error: { message: 'temporary failure' } };
    }
    const matched = rows().filter((row) => filters.every((filter) => filter(row)));
    if (mode === 'delete') {
      state.tables[table] = rows().filter((row) => !matched.includes(row));
      return { data: null, error: null };
    }
    const limited = limit === null ? matched : matched.slice(0, limit);
    const copies = limited.map((row) => ({ ...row }));
    return { data: single ? copies[0] ?? null : copies, error: null };
  };

  const builder = {
    select: () => builder,
    delete: () => {
      mode = 'delete';
      return builder;
    },
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[column]));
      return builder;
    },
    lt: (column: string, value: string) => {
      filters.push((row) => String(row[column]) < value);
      return builder;
    },
    order: () => builder,
    limit: (count: number) => {
      limit = count;
      return builder;
    },
    maybeSingle: () => {
      single = true;
      return builder;
    },
    upsert: (values: Row[], options: { onConflict: string }) => {
      const keys = options.onConflict.split(',');
      for (const value of values) {
        const existing = rows().find((row) => keys.every((key) => row[key] === value[key]));
        if (existing) {
          Object.assign(existing, value);
        } else {
          rows().push({ id: `generated-${rows().length + 1}`, dismissed_at: null, ...value });
        }
      }
      return Promise.resolve({ error: null });
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
  };
  return builder;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => query(table) }),
}));
vi.mock('@/lib/db', () => ({ isSqliteMode: () => false, getDatabase: vi.fn() }));
vi.mock('@/lib/auto-update/sqlite', () => ({ runSqliteUpdateCheck: vi.fn() }));
vi.mock('@/lib/auto-update/trigger', () => ({
  AutoUpdateTrigger: class {},
  getLatestInstallerInfo: vi.fn(),
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSource: () => ({ getAllLatestVersions: async () => state.catalog }),
}));

import { GET } from './route';

const NOTIFIED_AT = '2026-10-01T04:00:00.000Z';
const recent = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

function deployment(id: string, wingetId: string, intuneAppId: string, version: string): Row {
  return {
    id,
    user_id: 'user-1',
    winget_id: wingetId,
    version,
    display_name: wingetId,
    intune_app_id: intuneAppId,
    intune_tenant_id: 'tenant-1',
  };
}

function updateRow(id: string, wingetId: string, intuneAppId: string, overrides: Row = {}): Row {
  return {
    id,
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    winget_id: wingetId,
    intune_app_id: intuneAppId,
    display_name: wingetId,
    current_version: '1.0.0',
    latest_version: '2.0.0',
    is_critical: true,
    is_managed: true,
    notified_at: NOTIFIED_AT,
    dismissed_at: null,
    detected_at: recent(),
    updated_at: recent(),
    ...overrides,
  };
}

async function runCron() {
  const response = await GET(
    new Request('http://localhost/api/cron/check-updates', {
      headers: { authorization: 'Bearer secret' },
    })
  );
  expect(response.status).toBe(200);
  return response.json();
}

const rowIds = () => (state.tables.update_check_results ?? []).map((row) => row.id).sort();
const rowById = (id: string) => state.tables.update_check_results.find((row) => row.id === id);

describe('check-updates cron stale cleanup (hosted)', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    state.failDeployedFetch = false;
    state.catalog = [
      { winget_id: 'Own.Outdated', latest_version: '2.0.0' },
      { winget_id: 'Own.Current', latest_version: '3.0.0' },
      { winget_id: 'Teammate.App', latest_version: '5.0.0' },
      { winget_id: 'Claimed.App', latest_version: '8.0.0' },
      { winget_id: 'Own.Ignored', latest_version: '4.0.0' },
    ];
    state.tables = {
      notification_preferences: [{ user_id: 'user-1', notify_critical_only: false, email_enabled: true }],
      webhook_configurations: [],
      app_update_policies: [],
      upload_history: [
        deployment('h1', 'Own.Outdated', 'intune-outdated', '1.0.0'),
        deployment('h2', 'Own.Current', 'intune-current-old', '2.0.0'),
        deployment('h3', 'Own.Current', 'intune-current', '3.0.0'),
      ],
      update_check_results: [],
    };
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('keeps refresh rows for apps the cron never scans, with their notified and dismissed state', async () => {
    const dismissedAt = '2026-10-02T09:00:00.000Z';
    state.tables.update_check_results = [
      // Written by the on-demand refresh: a teammate deployment and a claimed
      // app in the same tenant. Neither is in this user's upload_history.
      updateRow('teammate', 'Teammate.App', 'intune-teammate', { latest_version: '5.0.0', is_managed: true }),
      updateRow('claimed', 'Claimed.App', 'intune-claimed', {
        latest_version: '8.0.0',
        is_managed: true,
        dismissed_at: dismissedAt,
      }),
    ];

    await runCron();

    expect(rowIds()).toEqual(['claimed', 'generated-3', 'teammate']);
    expect(rowById('teammate')).toMatchObject({ notified_at: NOTIFIED_AT, latest_version: '5.0.0' });
    expect(rowById('claimed')).toMatchObject({ notified_at: NOTIFIED_AT, dismissed_at: dismissedAt });
    // The cron still records the update it found itself.
    expect(rowById('generated-3')).toMatchObject({
      winget_id: 'Own.Outdated',
      intune_app_id: 'intune-outdated',
      notified_at: null,
    });
  });

  it('still removes rows for evaluated apps that are up to date, including older Intune objects', async () => {
    state.tables.update_check_results = [
      updateRow('resolved', 'Own.Current', 'intune-current', { current_version: '2.0.0', latest_version: '3.0.0' }),
      updateRow('older-object', 'Own.Current', 'intune-current-old', { current_version: '2.0.0', latest_version: '3.0.0' }),
      updateRow('outdated', 'Own.Outdated', 'intune-outdated'),
      updateRow('teammate', 'Teammate.App', 'intune-teammate', { latest_version: '5.0.0' }),
    ];

    await runCron();

    expect(rowIds()).toEqual(['outdated', 'teammate']);
    // An unchanged pending update keeps its notified state.
    expect(rowById('outdated')).toMatchObject({ notified_at: NOTIFIED_AT, latest_version: '2.0.0' });
  });

  it('removes an older Intune object row while the newest deployment is still outdated', async () => {
    state.tables.upload_history.push(deployment('h5', 'Own.Outdated', 'intune-outdated-old', '0.9.0'));
    state.tables.update_check_results = [
      updateRow('older-object', 'Own.Outdated', 'intune-outdated-old', { current_version: '0.9.0' }),
    ];

    await runCron();

    expect(state.tables.update_check_results.map((row) => row.intune_app_id)).toEqual(['intune-outdated']);
  });

  it('keeps rows for apps it skipped because of an ignore policy', async () => {
    state.tables.upload_history.push(deployment('h4', 'Own.Ignored', 'intune-ignored', '1.0.0'));
    state.tables.app_update_policies = [
      { user_id: 'user-1', tenant_id: 'tenant-1', winget_id: 'Own.Ignored', policy_type: 'ignore', pinned_version: null },
    ];
    state.tables.update_check_results = [
      updateRow('ignored', 'Own.Ignored', 'intune-ignored', { latest_version: '4.0.0' }),
    ];

    await runCron();

    expect(rowIds()).toEqual(['generated-2', 'ignored']);
    expect(rowById('ignored')).toMatchObject({ notified_at: NOTIFIED_AT });
  });

  it('does not delete any rows when the deployment fetch fails', async () => {
    state.failDeployedFetch = true;
    state.tables.update_check_results = [
      updateRow('outdated', 'Own.Outdated', 'intune-outdated'),
      updateRow('teammate', 'Teammate.App', 'intune-teammate', { latest_version: '5.0.0' }),
    ];

    const body = await runCron();

    expect(body.success).toBe(false);
    expect(rowIds()).toEqual(['outdated', 'teammate']);
  });

  it('still drops rows nobody has re-detected for 30 days', async () => {
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    state.tables.update_check_results = [
      updateRow('abandoned', 'Teammate.App', 'intune-removed', { latest_version: '5.0.0', detected_at: old }),
      updateRow('teammate', 'Teammate.App', 'intune-teammate', { latest_version: '5.0.0' }),
    ];

    await runCron();

    expect(rowIds()).toContain('teammate');
    expect(rowIds()).not.toContain('abandoned');
  });
});
