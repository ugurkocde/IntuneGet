import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomAppDefinition } from '@/lib/custom-app-definitions';

let db: typeof import('../sqlite').sqliteDb;
let close: typeof import('../sqlite').closeSqliteDb;
const input: CustomAppDefinition = { displayName: 'Fixture App', publisher: 'Fixture', installerType: 'msi', architecture: 'x64', installScope: 'machine' };
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('DATABASE_PATH', ':memory:');
  ({ sqliteDb: db, closeSqliteDb: close } = await import('../sqlite'));
});
afterEach(() => { close?.(); vi.unstubAllEnvs(); });

describe('saved custom app definitions', () => {
  it('persists a definition and replaces its version without changing its identity', async () => {
    const first = await db.customAppDefinitions.save('owner', 'tenant', input);
    expect(first.definition).toEqual(input);
    const updated = await db.customAppDefinitions.save('owner', 'tenant', { ...input, description: 'New details' }, first!.id);
    expect(updated?.id).toBe(first!.id);
    expect(updated?.definition.description).toBe('New details');
    expect(await db.customAppDefinitions.list('owner', 'tenant', 51, 0)).toHaveLength(1);
  });
  it('isolates reads, updates and deletes by both user and tenant', async () => {
    const first = await db.customAppDefinitions.save('owner', 'tenant', input);
    for (const [user, tenant] of [['other', 'tenant'], ['owner', 'other']]) {
      expect(await db.customAppDefinitions.list(user, tenant, 51, 0)).toEqual([]);
      expect(await db.customAppDefinitions.save(user, tenant, input, first!.id)).toBeNull();
      expect(await db.customAppDefinitions.delete(user, tenant, first!.id)).toBe(false);
    }
    expect(await db.customAppDefinitions.list('owner', 'tenant', 51, 0)).toHaveLength(1);
  });
  it('stores quotes as data and deletes only the selected definition', async () => {
    const first = await db.customAppDefinitions.save('owner', 'tenant', { ...input, displayName: "O'Brien; DELETE FROM custom_app_definitions" });
    const second = await db.customAppDefinitions.save('owner', 'tenant', input);
    expect(await db.customAppDefinitions.delete('owner', 'tenant', first!.id)).toBe(true);
    expect(await db.customAppDefinitions.delete('owner', 'tenant', first!.id)).toBe(false);
    expect((await db.customAppDefinitions.list('owner', 'tenant', 51, 0)).map(row => row.id)).toEqual([second!.id]);
  });
  it('supports bounded pagination without leaking another owner', async () => {
    await db.customAppDefinitions.save('other', 'tenant', input);
    for (let n = 0; n < 3; n++) await db.customAppDefinitions.save('owner', 'tenant', { ...input, description: String(n) });
    const page = await db.customAppDefinitions.list('owner', 'tenant', 2, 0);
    const tail = await db.customAppDefinitions.list('owner', 'tenant', 2, 2);
    expect(page).toHaveLength(2);
    expect(tail).toHaveLength(1);
    expect(new Set([...page, ...tail].map(row => row.id)).size).toBe(3);
  });
});
