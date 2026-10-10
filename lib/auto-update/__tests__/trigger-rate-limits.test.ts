/**
 * Auto-update rate limits must hold for tenants and users with many policies
 * and must fail closed when a count cannot be read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SAFETY_CONFIG } from '@/types/update-policies';

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  failTable: null as string | null,
  // Fails only the cooldown read (a non-count read of the history).
  failCooldownRead: false,
  reads: {} as Record<string, number>,
}));

// Longest `in` filter value list the fake accepts, like a URL length limit.
const MAX_IN_FILTER_CHARS = 8000;
const MAX_ROWS = 1000;

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let head = false;
  let limit: number | null = null;
  let orderBy: string | null = null;
  let inFilterChars = 0;

  const run = () => {
    state.reads[table] = (state.reads[table] ?? 0) + 1;
    if (
      state.failTable === table ||
      inFilterChars > MAX_IN_FILTER_CHARS ||
      (state.failCooldownRead && table === 'auto_update_history' && !head)
    ) {
      return { data: null, count: null, error: { message: 'request failed' } };
    }
    const matched = (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    if (head) {
      return { data: null, count: matched.length, error: null };
    }
    if (orderBy) {
      const column = orderBy;
      matched.sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : 1));
    }
    return { data: matched.slice(0, Math.min(limit ?? MAX_ROWS, MAX_ROWS)), count: null, error: null };
  };

  const builder = {
    select: (_columns: string, options?: { head?: boolean }) => {
      head = Boolean(options?.head);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    },
    gt: (column: string, value: string) => {
      filters.push((row) => String(row[column]) > value);
      return builder;
    },
    gte: (column: string, value: string) => {
      filters.push((row) => String(row[column]) >= value);
      return builder;
    },
    in: (column: string, values: unknown[]) => {
      inFilterChars += values.map(String).join(',').length;
      filters.push((row) => values.includes(row[column]));
      return builder;
    },
    order: (column: string) => {
      orderBy = column;
      return builder;
    },
    limit: (count: number) => {
      limit = count;
      return builder;
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
  };
  return builder;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => query(table) }),
}));

import { AutoUpdateTrigger } from '../trigger';

interface RateLimitCheck {
  allowed: boolean;
  reason?: string;
  code?: string;
}

const uuid = (prefix: number, index: number) =>
  `0000000${prefix}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const recent = () => new Date(Date.now() - 10 * 60 * 1000).toISOString();

function policies(count: number, scope: { tenant_id?: string; user_id?: string }) {
  return Array.from({ length: count }, (_, index) => ({
    id: uuid(1, index),
    tenant_id: scope.tenant_id ?? 'tenant-other',
    user_id: scope.user_id ?? 'user-other',
  }));
}

function history(policyIds: string[], status = 'completed') {
  return policyIds.map((policyId, index) => ({
    id: uuid(2, index),
    policy_id: policyId,
    status,
    triggered_at: recent(),
  }));
}

function createTrigger() {
  return new AutoUpdateTrigger('https://stub.supabase.co', 'stub-key', {
    ...DEFAULT_SAFETY_CONFIG,
    rateLimits: { maxUpdatesPerHour: 5, maxUpdatesPerTenant: 3, cooldownMinutes: 5 },
  });
}

function checkRateLimits(
  userId: string,
  tenantId: string,
  policyId: string,
  trigger = createTrigger()
): Promise<RateLimitCheck> {
  return (
    trigger as unknown as {
      checkRateLimits: (userId: string, tenantId: string, policyId: string) => Promise<RateLimitCheck>;
    }
  ).checkRateLimits(userId, tenantId, policyId);
}

describe('auto-update rate limits', () => {
  beforeEach(() => {
    state.failTable = null;
    state.failCooldownRead = false;
    state.reads = {};
    state.tables = { app_update_policies: [], auto_update_history: [] };
  });

  it('enforces the tenant limit for a tenant with more than 200 policies', async () => {
    const tenantPolicies = policies(250, { tenant_id: 'tenant-1' });
    state.tables.app_update_policies = tenantPolicies;
    // The completed updates belong to policies past the first 200.
    state.tables.auto_update_history = history(tenantPolicies.slice(240, 243).map((p) => p.id));

    const result = await checkRateLimits('user-1', 'tenant-1', tenantPolicies[0].id);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('per tenant per hour');
  });

  it('enforces the hourly user limit for a user with more than 1000 policies', async () => {
    const userPolicies = policies(1200, { user_id: 'user-1' });
    state.tables.app_update_policies = userPolicies;
    // Pending updates count toward the user limit but not the tenant limit.
    state.tables.auto_update_history = history(
      userPolicies.slice(1100, 1105).map((p) => p.id),
      'pending'
    );

    const result = await checkRateLimits('user-1', 'tenant-1', userPolicies[0].id);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('5 updates per hour');
  });

  it('sums counts across id chunks', async () => {
    const tenantPolicies = policies(250, { tenant_id: 'tenant-1' });
    state.tables.app_update_policies = tenantPolicies;
    // One completed update in each of the three chunks of 100 ids.
    state.tables.auto_update_history = history([10, 150, 240].map((index) => tenantPolicies[index].id));

    const result = await checkRateLimits('user-1', 'tenant-1', tenantPolicies[0].id);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('3 updates per tenant per hour');
  });

  it('allows an update when many policies stay under every limit', async () => {
    const tenantPolicies = policies(250, { tenant_id: 'tenant-1', user_id: 'user-1' });
    state.tables.app_update_policies = tenantPolicies;
    state.tables.auto_update_history = history(tenantPolicies.slice(210, 212).map((p) => p.id));

    const result = await checkRateLimits('user-1', 'tenant-1', tenantPolicies[0].id);

    expect(result).toEqual({ allowed: true });
  });

  it('fails closed when the update count cannot be read', async () => {
    state.tables.app_update_policies = policies(3, { tenant_id: 'tenant-1', user_id: 'user-1' });
    state.failTable = 'auto_update_history';

    const result = await checkRateLimits('user-1', 'tenant-1', uuid(1, 0));

    expect(result).toMatchObject({ allowed: false, code: 'RATE_LIMIT_UNVERIFIED' });
    expect(result.reason).toContain('update count failed: request failed');
  });

  it('fails closed when the cooldown read fails', async () => {
    state.tables.app_update_policies = policies(3, { tenant_id: 'tenant-1', user_id: 'user-1' });
    state.failCooldownRead = true;

    const result = await checkRateLimits('user-1', 'tenant-1', uuid(1, 0));

    expect(result).toMatchObject({ allowed: false, code: 'RATE_LIMIT_UNVERIFIED' });
    expect(result.reason).toContain('cooldown read failed');
  });

  it('fails closed when the policy list cannot be read', async () => {
    state.failTable = 'app_update_policies';

    const result = await checkRateLimits('user-1', 'tenant-1', uuid(1, 0));

    expect(result).toMatchObject({ allowed: false, code: 'RATE_LIMIT_UNVERIFIED' });
    expect(result.reason).toContain('policy read failed: request failed');
  });

  it('reads each policy list once per run and stops checking a scope at its limit', async () => {
    const userPolicies = policies(250, { tenant_id: 'tenant-1', user_id: 'user-1' });
    state.tables.app_update_policies = userPolicies;
    const trigger = createTrigger();

    expect(await checkRateLimits('user-1', 'tenant-1', userPolicies[0].id, trigger)).toEqual({ allowed: true });
    const policyReads = state.reads.app_update_policies;

    // Five pending updates reach the user limit of five per hour.
    state.tables.auto_update_history = history(
      userPolicies.slice(100, 105).map((p) => p.id),
      'pending'
    );
    const limited = await checkRateLimits('user-1', 'tenant-1', userPolicies[1].id, trigger);
    expect(limited).toMatchObject({ allowed: false });
    expect(limited.reason).toContain('5 updates per hour');
    expect(state.reads.app_update_policies).toBe(policyReads);

    const historyReads = state.reads.auto_update_history;
    const again = await checkRateLimits('user-1', 'tenant-1', userPolicies[2].id, trigger);
    expect(again).toEqual(limited);
    expect(state.reads.auto_update_history).toBe(historyReads);
  });
});
