import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  // PostgREST max-rows: the most rows any single request returns.
  maxRows: 1000,
  requests: {} as Record<string, number>,
  failTable: null as string | null,
  emailConfigured: true,
  notified: new Map<string, string[]>(),
  // Simulated milliseconds each notifyUserOfPendingUpdates call takes.
  msPerUser: 0,
  clock: 0,
}));

// In-memory stand-in for the Supabase reads the cron makes. Like PostgREST,
// it never returns more than maxRows rows per request, whatever limit or
// range the query asks for.
function query(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  const orders: Array<{ column: string; ascending: boolean }> = [];
  let from = 0;
  let to = Number.POSITIVE_INFINITY;

  const run = () => {
    state.requests[table] = (state.requests[table] ?? 0) + 1;
    if (state.failTable === table) {
      return { data: null, error: { message: `temporary failure reading ${table}` } };
    }
    const matched = (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    matched.sort((a, b) => {
      for (const { column, ascending } of orders) {
        const cmp = String(a[column]).localeCompare(String(b[column]));
        if (cmp !== 0) return ascending ? cmp : -cmp;
      }
      return 0;
    });
    const end = Math.min(to + 1, from + state.maxRows);
    return { data: matched.slice(from, end).map((row) => ({ ...row })), error: null };
  };

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    },
    is: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[column]));
      return builder;
    },
    gt: (column: string, value: string) => {
      filters.push((row) => String(row[column]) > value);
      return builder;
    },
    order: (column: string, options?: { ascending?: boolean }) => {
      orders.push({ column, ascending: options?.ascending ?? true });
      return builder;
    },
    limit: (count: number) => {
      to = from + count - 1;
      return builder;
    },
    range: (start: number, end: number) => {
      from = start;
      to = end;
      return builder;
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve().then(run).then(resolve, reject),
  };
  return builder;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => query(table) }),
}));

vi.mock('@/lib/email/service', () => ({
  isEmailConfigured: () => state.emailConfigured,
}));

vi.mock('@/lib/notifications/notify-user', () => ({
  notifyUserOfPendingUpdates: vi.fn(
    async (_supabase: unknown, userId: string, options: { pendingUpdates: Row[] }) => {
      state.clock += state.msPerUser;
      const ids = options.pendingUpdates.map((row) => String(row.id));
      state.notified.set(userId, [...(state.notified.get(userId) ?? []), ...ids]);
      return { emailsSent: 1, webhooksSent: 0, notifiedUpdateIds: ids, errors: [] };
    }
  ),
}));

import { GET } from './route';

const BASE = Date.parse('2026-10-01T00:00:00.000Z');
const pad = (n: number) => String(n).padStart(5, '0');
const userId = (n: number) => `user-${pad(n)}`;

// Row n is detected n minutes after BASE, so a higher n is newer.
function pendingRow(n: number, owner: string, overrides: Row = {}): Row {
  return {
    id: `row-${pad(n)}`,
    user_id: owner,
    tenant_id: 'tenant-1',
    winget_id: `App.${n}`,
    intune_app_id: `intune-${n}`,
    display_name: `App ${n}`,
    current_version: '1.0.0',
    latest_version: '2.0.0',
    is_critical: false,
    notified_at: null,
    dismissed_at: null,
    detected_at: new Date(BASE + n * 60_000).toISOString(),
    updated_at: new Date(BASE + n * 60_000).toISOString(),
    ...overrides,
  };
}

const emailPrefs = (owner: string, enabled = true): Row => ({
  id: `prefs-${owner}`,
  user_id: owner,
  email_enabled: enabled,
});

const webhook = (id: string, owner: string, enabled = true): Row => ({
  id,
  user_id: owner,
  is_enabled: enabled,
});

async function runCron() {
  const response = await GET(
    new Request('http://localhost/api/cron/send-notifications', {
      headers: { authorization: 'Bearer secret' },
    })
  );
  return { status: response.status, body: await response.json() };
}

const allNotifiedIds = () => Array.from(state.notified.values()).flat().sort();
const idsOf = (rows: Row[]) => rows.map((row) => String(row.id)).sort();

describe('send-notifications cron pending update paging', () => {
  let dateNow: { mockRestore: () => void };

  beforeEach(() => {
    process.env.CRON_SECRET = 'secret';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role';
    state.tables = { notification_preferences: [], webhook_configurations: [], update_check_results: [] };
    state.maxRows = 1000;
    state.requests = {};
    state.failTable = null;
    state.emailConfigured = true;
    state.notified = new Map();
    state.msPerUser = 0;
    state.clock = 0;
    dateNow = vi.spyOn(Date, 'now').mockImplementation(() => state.clock);
  });

  afterEach(() => {
    dateNow.mockRestore();
    delete process.env.CRON_SECRET;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('notifies every channel user when channel-less users hold most of the pending rows', async () => {
    // 1,700 users, 9,000 pending rows. Only 175 users have a channel and they
    // own the newest rows, so the oldest rows (and any single capped read
    // ordered by id or age) belong to users nobody can deliver to.
    const channelUsers = Array.from({ length: 175 }, (_, n) => userId(n));
    const channelLess = Array.from({ length: 1525 }, (_, n) => userId(175 + n));
    const channelLessRows = Array.from({ length: 7700 }, (_, n) => pendingRow(n, channelLess[n % channelLess.length]));
    const channelRows = Array.from({ length: 1300 }, (_, n) =>
      pendingRow(7700 + n, channelUsers[n % channelUsers.length])
    );
    state.tables.update_check_results = [
      ...channelLessRows,
      ...channelRows,
      pendingRow(9001, channelUsers[0], { notified_at: '2026-10-02T04:00:00.000Z' }),
      pendingRow(9002, channelUsers[1], { dismissed_at: '2026-10-02T09:00:00.000Z' }),
    ];
    state.tables.notification_preferences = [
      ...channelUsers.slice(0, 100).map((owner) => emailPrefs(owner)),
      ...channelLess.map((owner) => emailPrefs(owner, false)),
    ];
    state.tables.webhook_configurations = [
      ...channelUsers.slice(80).map((owner, n) => webhook(`hook-${pad(n)}`, owner)),
      webhook('hook-disabled', channelLess[0], false),
    ];

    const { status, body } = await runCron();

    expect(status).toBe(200);
    expect(allNotifiedIds()).toEqual(idsOf(channelRows));
    expect(Array.from(state.notified.keys()).sort()).toEqual(channelUsers);
    expect(body).toMatchObject({
      success: true,
      channelUsers: 175,
      pendingUpdates: 1300,
      updatesProcessed: 1300,
      usersProcessed: 175,
      usersRemaining: 0,
    });
    // Each row goes to its own user, newest first within the user.
    for (const [owner, ids] of state.notified) {
      const rows = ids.map((id) => state.tables.update_check_results.find((row) => row.id === id)!);
      expect(rows.every((row) => row.user_id === owner)).toBe(true);
      const detected = rows.map((row) => String(row.detected_at));
      expect(detected).toEqual([...detected].sort().reverse());
    }
  });

  it('reads more than 1000 pending rows of a single user chunk', async () => {
    const owners = Array.from({ length: 10 }, (_, n) => userId(n));
    const rows = Array.from({ length: 2500 }, (_, n) => pendingRow(n, owners[n % owners.length]));
    state.tables.update_check_results = rows;
    state.tables.webhook_configurations = owners.map((owner, n) => webhook(`hook-${pad(n)}`, owner));

    const { body } = await runCron();

    expect(allNotifiedIds()).toEqual(idsOf(rows));
    expect(body).toMatchObject({ success: true, pendingUpdates: 2500, usersRemaining: 0 });
  });

  it('keeps paging every read when the server returns fewer rows than requested', async () => {
    state.maxRows = 300;
    const owners = Array.from({ length: 700 }, (_, n) => userId(n));
    const rows = Array.from({ length: 1001 }, (_, n) => pendingRow(n, owners[n % owners.length]));
    state.tables.update_check_results = rows;
    state.tables.notification_preferences = owners.slice(0, 400).map((owner) => emailPrefs(owner));
    state.tables.webhook_configurations = owners.slice(400).map((owner, n) => webhook(`hook-${pad(n)}`, owner));

    const { body } = await runCron();

    expect(allNotifiedIds()).toEqual(idsOf(rows));
    expect(state.notified.size).toBe(700);
    expect(body).toMatchObject({ success: true, channelUsers: 700, pendingUpdates: 1001, usersRemaining: 0 });
    // Two pages of 300 plus a short page, then the empty page that ends the read.
    expect(state.requests.notification_preferences).toBe(3);
    expect(state.requests.webhook_configurations).toBe(2);
  });

  it('ignores email preferences when email is not configured for the deployment', async () => {
    state.emailConfigured = false;
    state.tables.notification_preferences = [emailPrefs(userId(1)), emailPrefs(userId(2))];
    state.tables.webhook_configurations = [webhook('hook-1', userId(2))];
    state.tables.update_check_results = [pendingRow(1, userId(1)), pendingRow(2, userId(2))];

    const { body } = await runCron();

    expect(Array.from(state.notified.keys())).toEqual([userId(2)]);
    expect(state.requests.notification_preferences).toBeUndefined();
    expect(body).toMatchObject({ success: true, channelUsers: 1, pendingUpdates: 1 });
  });

  it('stops at the time budget and reports the users left for the next run', async () => {
    // Every user takes 13 s, so one batch of 20 users uses up the 240 s budget.
    state.msPerUser = 13_000;
    const owners = Array.from({ length: 50 }, (_, n) => userId(n));
    state.tables.update_check_results = Array.from({ length: 1500 }, (_, n) => pendingRow(n, owners[n % 50]));
    state.tables.webhook_configurations = owners.map((owner, n) => webhook(`hook-${pad(n)}`, owner));

    const { status, body } = await runCron();

    expect(status).toBe(200);
    expect(body).toMatchObject({ success: false, usersProcessed: 20, usersRemaining: 30 });
    expect(state.notified.size).toBe(20);
  });

  it('reaches different users on consecutive days when the budget cuts every run short', async () => {
    state.msPerUser = 13_000;
    const owners = Array.from({ length: 50 }, (_, n) => userId(n));
    state.tables.update_check_results = Array.from({ length: 1500 }, (_, n) => pendingRow(n, owners[n % 50]));
    state.tables.webhook_configurations = owners.map((owner, n) => webhook(`hook-${pad(n)}`, owner));

    // Like the 03:30 update check, which rewrites detected_at on every upsert,
    // so pending age says nothing about how long a user has waited. Nothing
    // gets marked notified here, as if every delivery had failed.
    const runOnDay = async (day: number) => {
      const runAt = Date.parse('2026-10-11T04:00:00.000Z') + day * 24 * 60 * 60 * 1000;
      state.tables.update_check_results.forEach((row) => {
        row.detected_at = new Date(runAt - 30 * 60 * 1000).toISOString();
      });
      state.clock = runAt;
      state.notified = new Map();
      const { body } = await runCron();
      expect(body).toMatchObject({ usersProcessed: 20, usersRemaining: 30 });
      return new Set(state.notified.keys());
    };

    const firstDay = await runOnDay(0);
    const secondDay = await runOnDay(1);
    const skippedOnFirstDay = owners.filter((owner) => !firstDay.has(owner));
    expect(skippedOnFirstDay.filter((owner) => secondDay.has(owner)).length).toBeGreaterThan(0);

    // Over a month of cut short runs, nobody is left out every night.
    const reached = new Set([...firstDay, ...secondDay]);
    for (let day = 2; day < 30; day++) {
      (await runOnDay(day)).forEach((owner) => reached.add(owner));
    }
    expect(Array.from(reached).sort()).toEqual(owners);
  });

  it('reports the channel user count when nothing is pending', async () => {
    state.tables.webhook_configurations = [webhook('hook-1', userId(1))];
    state.tables.update_check_results = [pendingRow(1, userId(2))];

    const { body } = await runCron();

    expect(body).toMatchObject({ success: true, channelUsers: 1, pendingUpdates: 0, emailsSent: 0 });
    expect(state.notified.size).toBe(0);
  });

  it.each(['webhook_configurations', 'notification_preferences', 'update_check_results'])(
    'notifies nobody and fails the run when %s cannot be read',
    async (table) => {
      state.failTable = table;
      state.tables.notification_preferences = [emailPrefs(userId(1))];
      state.tables.webhook_configurations = [webhook('hook-1', userId(1))];
      state.tables.update_check_results = [pendingRow(1, userId(1))];

      const { status, body } = await runCron();

      expect(status).toBe(500);
      expect(body.error).toBe(`temporary failure reading ${table}`);
      expect(state.notified.size).toBe(0);
    }
  );
});
