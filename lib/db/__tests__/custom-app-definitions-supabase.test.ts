import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ calls: [] as unknown[][], data: null as unknown, error: null as unknown }));
vi.mock('@/lib/supabase', () => ({ createServerClient: () => ({ from: (table: string) => {
  state.calls.push(['from', table]);
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'range', 'insert', 'update', 'delete', 'maybeSingle', 'single']) query[method] = (...args: unknown[]) => { state.calls.push([method, ...args]); return query; };
  query.then = (resolve: (value: unknown) => unknown) => resolve({ data: state.data, error: state.error });
  return query;
} }) }));
import { supabaseDb } from '../supabase-adapter';
const definition = { displayName: 'Fixture', publisher: 'Fixture', installerType: 'msi' as const, architecture: 'x64' as const, installScope: 'machine' as const };
beforeEach(() => { state.calls = []; state.data = []; state.error = null; });
describe('hosted saved definitions', () => {
  it('scopes paginated reads to both owner and tenant', async () => {
    await supabaseDb.customAppDefinitions.list('owner', 'tenant', 51, 50);
    expect(state.calls).toContainEqual(['eq', 'user_id', 'owner']); expect(state.calls).toContainEqual(['eq', 'tenant_id', 'tenant']); expect(state.calls).toContainEqual(['range', 50, 100]);
  });
  it('updates with three identity filters and never upserts a supplied ID', async () => {
    state.data = null;
    expect(await supabaseDb.customAppDefinitions.save('owner', 'tenant', definition, 'fixture-id')).toBeNull();
    for (const pair of [['id', 'fixture-id'], ['user_id', 'owner'], ['tenant_id', 'tenant']]) expect(state.calls).toContainEqual(['eq', ...pair]);
    expect(state.calls.some(c => c[0] === 'insert')).toBe(false);
  });
  it('lets the database generate new IDs and scopes deletes', async () => {
    await supabaseDb.customAppDefinitions.save('owner', 'tenant', definition);
    expect(state.calls).toContainEqual(['insert', { user_id: 'owner', tenant_id: 'tenant', definition }]);
    state.calls = []; state.data = [{ id: 'fixture-id' }];
    expect(await supabaseDb.customAppDefinitions.delete('owner', 'tenant', 'fixture-id')).toBe(true);
    for (const pair of [['id', 'fixture-id'], ['user_id', 'owner'], ['tenant_id', 'tenant']]) expect(state.calls).toContainEqual(['eq', ...pair]);
  });
});
