import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  catalog: [] as Array<{ winget_id: string; latest_version: string }>,
  failDeployedFetch: false,
  failPriorFetch: false,
}));

// PostgREST returns at most this many rows per response by default.
const MAX_ROWS = 1000;

// Minimal in-memory stand-in for the Supabase query builder calls the cron uses.
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let mode: 'select' | 'delete' = 'select';
  let single = false;
  let limit: number | null = null;
  let orderBy: string | null = null;
  let range: [number, number] | null = null;
  const rows = () => (state.tables[table] ??= []);

  const run = () => {
    if (table === 'upload_history' && mode === 'select' && state.failDeployedFetch && filters.length > 0) {
      return { data: null, error: { message: 'temporary failure' } };
    }
    if (table === 'update_check_results' && mode === 'select' && state.failPriorFetch) {
      return { data: null, error: { message: 'temporary failure' } };
    }
    const matched = rows().filter((row) => filters.every((filter) => filter(row)));
    if (mode === 'delete') {
      state.tables[table] = rows().filter((row) => !matched.includes(row));
      return { data: null, error: null };
    }
    if (orderBy) {
      const column = orderBy;
      matched.sort((a, b) => String(a[column]).localeCompare(String(b[column])));
    }
    const ranged = range ? matched.slice(range[0], range[1] + 1) : matched;
    const limited = ranged.slice(0, Math.min(limit ?? MAX_ROWS, MAX_ROWS));
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
    order: (column: string) => {
      orderBy = column;
      return builder;
    },
    range: (from: number, to: number) => {
      range = [from, to];
      return builder;
    },
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

function deployment(
  id: string,
  wingetId: string,
  intuneAppId: string,
  version: string,
  deployedAt = '2026-09-01T00:00:00.000Z'
): Row {
  return {
    deployed_at: deployedAt,
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
    state.failPriorFetch = false;
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

  it('skips the batch when existing update rows cannot be loaded', async () => {
    state.failPriorFetch = true;
    state.tables.update_check_results = [
      updateRow('outdated', 'Own.Outdated', 'intune-outdated'),
      updateRow('resolved', 'Own.Current', 'intune-current', { current_version: '2.0.0', latest_version: '3.0.0' }),
    ];

    const body = await runCron();

    expect(body.success).toBe(false);
    expect(body.updatesFound).toBe(0);
    // Nothing is rewritten with notified_at reset and nothing is deleted.
    expect(rowIds()).toEqual(['outdated', 'resolved']);
    expect(rowById('outdated')).toMatchObject({ notified_at: NOTIFIED_AT });
  });

  it('reads every existing row past the PostgREST row cap', async () => {
    state.catalog.push({ winget_id: 'Bulk.App', latest_version: '9.0.0' });
    for (let index = 0; index < 1100; index += 1) {
      const suffix = String(index).padStart(4, '0');
      state.tables.update_check_results.push(
        updateRow(`bulk-${suffix}`, 'Bulk.App', `intune-bulk-${suffix}`, { latest_version: '9.0.0' })
      );
    }
    // Sorts after the 1100 rows above, so a single capped read would miss it.
    state.tables.update_check_results.push(updateRow('zz-outdated', 'Own.Outdated', 'intune-outdated'));

    await runCron();

    expect(rowById('zz-outdated')).toMatchObject({ notified_at: NOTIFIED_AT, latest_version: '2.0.0' });
    expect(state.tables.update_check_results.filter((row) => row.winget_id === 'Own.Outdated')).toHaveLength(1);
  });

  it('reads every deployment past the PostgREST row cap', async () => {
    for (let index = 0; index < 1100; index += 1) {
      const suffix = String(index).padStart(4, '0');
      state.tables.upload_history.push(
        deployment(`g-${suffix}`, `Unlisted.App${suffix}`, `intune-unlisted-${suffix}`, '1.0.0')
      );
    }
    state.tables.upload_history.push(deployment('zz-current', 'Late.Current', 'intune-late', '6.0.0'));
    state.catalog.push({ winget_id: 'Late.Current', latest_version: '6.0.0' });
    state.tables.update_check_results = [
      updateRow('late-resolved', 'Late.Current', 'intune-late', { current_version: '5.0.0', latest_version: '6.0.0' }),
    ];

    await runCron();

    expect(rowIds()).not.toContain('late-resolved');
  });

  it('updates the refresh row for a newer teammate copy instead of adding a second row', async () => {
    // The user deployed Own.Outdated 1.0.0; a teammate deployed a newer 1.5.0
    // copy of the same app, and the refresh stored that object as its row.
    state.tables.update_check_results = [
      updateRow('teammate-copy', 'Own.Outdated', 'intune-teammate-copy', {
        current_version: '1.5.0',
        display_name: 'Own Outdated (teammate)',
      }),
    ];

    await runCron();

    expect(rowIds()).toEqual(['teammate-copy']);
    expect(rowById('teammate-copy')).toMatchObject({
      current_version: '1.5.0',
      display_name: 'Own Outdated (teammate)',
      latest_version: '2.0.0',
      notified_at: NOTIFIED_AT,
    });
  });

  it('moves the teammate copy row to a new catalog version and notifies it once', async () => {
    state.tables.update_check_results = [
      updateRow('teammate-copy', 'Own.Outdated', 'intune-teammate-copy', {
        current_version: '1.5.0',
        latest_version: '1.8.0',
        is_critical: false,
      }),
      // A row the cron wrote earlier for the user's own object.
      updateRow('own', 'Own.Outdated', 'intune-outdated', { latest_version: '1.8.0' }),
    ];

    await runCron();

    expect(rowIds()).toEqual(['teammate-copy']);
    expect(rowById('teammate-copy')).toMatchObject({
      current_version: '1.5.0',
      latest_version: '2.0.0',
      is_critical: true,
      notified_at: null,
    });
  });

  it('keeps its own row when the teammate copy is already current', async () => {
    state.tables.update_check_results = [
      updateRow('teammate-copy', 'Own.Outdated', 'intune-teammate-copy', {
        current_version: '2.0.0',
        latest_version: '2.0.0',
      }),
      updateRow('own', 'Own.Outdated', 'intune-outdated'),
    ];

    await runCron();

    expect(rowIds()).toEqual(['own', 'teammate-copy']);
    expect(rowById('own')).toMatchObject({ notified_at: NOTIFIED_AT });
  });

  it('keeps rows for apps pinned to another version and evaluates apps pinned to the latest', async () => {
    state.tables.upload_history.push(deployment('h6', 'Own.Pinned', 'intune-pinned', '1.0.0'));
    state.catalog.push({ winget_id: 'Own.Pinned', latest_version: '3.0.0' });
    state.tables.app_update_policies = [
      { user_id: 'user-1', tenant_id: 'tenant-1', winget_id: 'Own.Pinned', policy_type: 'pin_version', pinned_version: '2.0.0' },
      { user_id: 'user-1', tenant_id: 'tenant-1', winget_id: 'Own.Current', policy_type: 'pin_version', pinned_version: '3.0.0' },
    ];
    state.tables.update_check_results = [
      updateRow('pinned', 'Own.Pinned', 'intune-pinned', { latest_version: '3.0.0' }),
      updateRow('pinned-latest', 'Own.Current', 'intune-current', { current_version: '2.0.0', latest_version: '3.0.0' }),
    ];

    await runCron();

    // Skipped by the pin: kept as is. Pinned to the latest version: evaluated,
    // up to date, so removed.
    expect(rowById('pinned')).toMatchObject({ notified_at: NOTIFIED_AT, latest_version: '3.0.0' });
    expect(rowIds()).not.toContain('pinned-latest');
  });

  it('breaks a version tie by the most recent deployment', async () => {
    state.tables.upload_history = [
      deployment('t1', 'Own.Outdated', 'intune-earlier', '1.0.0', '2026-08-01T00:00:00.000Z'),
      deployment('t2', 'Own.Outdated', 'intune-later', '1.0.0', '2026-09-15T00:00:00.000Z'),
      deployment('t3', 'Own.Outdated', 'intune-middle', '1.0.0', '2026-09-01T00:00:00.000Z'),
    ];
    state.tables.update_check_results = [updateRow('later', 'Own.Outdated', 'intune-later')];

    await runCron();

    expect(rowIds()).toEqual(['later']);
    expect(rowById('later')).toMatchObject({ notified_at: NOTIFIED_AT });
  });
});
