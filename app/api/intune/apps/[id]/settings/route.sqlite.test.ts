import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';

const state = vi.hoisted(() => {
  vi.stubEnv('DATABASE_PATH', ':memory:');
  vi.stubEnv('DATABASE_MODE', 'sqlite');
  return { authenticated: true, assign: vi.fn(), categories: vi.fn(), graphFails: false };
});
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: async () => state.authenticated
  ? { userId: 'fixture-owner', tenantId: 'fixture-tenant' } : null }));
vi.mock('@/lib/supabase', () => ({ getServerClientOrNull: () => null }));
vi.mock('@/lib/intune/graph-client', () => ({ getServicePrincipalToken: async () => 'fixture-token' }));
vi.mock('@/lib/intune-api', () => ({
  getApp: async () => ({ displayName: 'Fixture app', rules: [] }),
  convertToGraphAssignments: (assignments: unknown) => assignments,
  assignToGroups: async (...args: unknown[]) => {
    await state.assign(...args);
    if (state.graphFails) throw new Error('Fixture Graph failure');
  },
  syncAppCategories: state.categories, setAppRules: vi.fn(),
}));
vi.mock('@/lib/requirement-rules', () => ({ buildCartItemRequirementRules: () => undefined }));
vi.mock('@/lib/db', async () => {
  const { sqliteDb } = await vi.importActual<typeof import('@/lib/db/sqlite')>('@/lib/db/sqlite');
  return { getDatabase: () => sqliteDb, isSqliteMode: () => true };
});

import { sqliteDb, closeSqliteDb, sqliteDeployedConfig } from '@/lib/db/sqlite';
import { PATCH } from './route';
import { GET } from '../../deployed/config/route';

const assignments = [{ type: 'allUsers', intent: 'available' }];
const original = { assignments: [{ type: 'allUsers', intent: 'required' }], categories: [{ id: 'old-category' }], description: 'Keep this' };
const call = (body: Record<string, unknown> = { wingetId: 'Fixture.App', assignments }, appId = 'fixture-app') => PATCH(
  new NextRequest('http://localhost/api/intune/apps/fixture-app/settings', {
    method: 'PATCH', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: appId }) });
const create = async (overrides: Record<string, unknown> = {}) => {
  const job = await sqliteDb.jobs.create({ id: randomUUID(), user_id: 'fixture-owner', tenant_id: 'fixture-tenant',
    winget_id: 'Fixture.App', version: '1.0', display_name: 'Fixture app', installer_type: 'exe',
    installer_url: 'https://fixture.invalid/app.exe', status: 'deployed', package_config: original, ...overrides });
  await sqliteDb.jobs.update(job.id, { completed_at: '2026-01-01T00:00:00Z', intune_app_id: 'fixture-app', ...overrides });
  return job;
};

describe('deployed settings persistence with SQLite', () => {
  beforeEach(() => { closeSqliteDb(); vi.clearAllMocks(); state.authenticated = true; state.graphFails = false; });
  afterAll(() => { closeSqliteDb(); vi.unstubAllEnvs(); });

  it('persists the edited assignment intent and preserves other configuration', async () => {
    const job = await create();
    expect((await call()).status).toBe(200);
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual({ ...original, assignments });
    expect(state.assign).toHaveBeenCalledWith('fixture-token', 'fixture-app', assignments);
    const reopened = await GET(new NextRequest('http://localhost/api/intune/apps/deployed/config?wingetId=Fixture.App', {
      headers: { Authorization: 'Bearer fixture' },
    }));
    expect(await reopened.json()).toMatchObject({ config: { ...original, assignments }, intuneAppId: 'fixture-app' });
  });

  it('keeps concurrent assignment and category edits after both Graph calls complete', async () => {
    const job = await create();
    const categories = [{ id: 'new-category' }];
    let releaseAssign!: () => void;
    let enteredAssign!: () => void;
    const entered = new Promise<void>(resolve => { enteredAssign = resolve; });
    state.assign.mockImplementationOnce(() => {
      enteredAssign();
      return new Promise<void>(resolve => { releaseAssign = resolve; });
    });
    const first = call();
    await entered;
    expect((await call({ wingetId: 'Fixture.App', categories })).status).toBe(200);
    releaseAssign();
    expect((await first).status).toBe(200);
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual({ ...original, assignments, categories });
  });

  it('refuses a save if local configuration becomes invalid during Graph work', async () => {
    const job = await create();
    state.assign.mockImplementationOnce(() => { void sqliteDb.jobs.update(job.id, { package_config: [] }); });
    expect((await call()).status).toBe(409);
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual([]);
  });

  it('reads the requested older app and never falls back for an unknown app ID', async () => {
    await create({ intune_app_id: 'older-app', created_at: '2026-01-01T00:00:00Z' });
    await create({ intune_app_id: 'newer-app', created_at: '2026-02-01T00:00:00Z' });
    await call(undefined, 'older-app');
    const get = (id: string) => GET(new NextRequest(`http://localhost/api/intune/apps/deployed/config?wingetId=Fixture.App&intuneAppId=${id}`, {
      headers: { Authorization: 'Bearer fixture' },
    }));
    expect(await (await get('older-app')).json()).toMatchObject({ intuneAppId: 'older-app', config: { ...original, assignments } });
    expect(await (await get('unknown-app')).json()).toEqual({ intuneAppId: null, config: null, deployedAt: null });
  });

  it('does not save fields that were null and therefore not sent to Graph', async () => {
    const job = await create();
    expect((await call({ wingetId: 'Fixture.App', assignments: null, categories: null })).status).toBe(200);
    expect(state.assign).not.toHaveBeenCalled();
    expect(state.categories).not.toHaveBeenCalled();
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual(original);
  });

  it('persists categories and explicit empty assignments', async () => {
    const job = await create(); const categories = [{ id: 'new-category' }];
    expect((await call({ wingetId: 'Fixture.App', assignments: [], categories })).status).toBe(200);
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual({ ...original, assignments: [], categories });
  });

  it('does not persist when Graph rejects the edit', async () => {
    const job = await create(); state.graphFails = true;
    expect((await call()).status).toBe(500);
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual(original);
  });

  it('requires authentication before Graph or database mutation', async () => {
    const job = await create(); state.authenticated = false;
    expect((await call()).status).toBe(401);
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual(original);
    expect(state.assign).not.toHaveBeenCalled();
  });

  it('updates the most recently completed deployment that the config reader selects', async () => {
    const older = await create({ created_at: '2026-01-01T00:00:00Z', completed_at: '2026-03-01T00:00:00Z' });
    const newer = await create({ created_at: '2026-02-01T00:00:00Z', completed_at: '2026-02-01T00:00:00Z' });
    expect((await call()).status).toBe(200);
    expect((await sqliteDb.jobs.getById(older.id))?.package_config).toEqual({ ...original, assignments });
    expect((await sqliteDb.jobs.getById(newer.id))?.package_config).toEqual(original);
  });

  it('leaves another user, other applications, nondeployed and archived jobs unchanged', async () => {
    const target = await create({ created_at: '2026-01-01T00:00:00Z' });
    const others = await Promise.all([
      create({ user_id: 'other-owner' }), create({ winget_id: 'Other.App' }),
      create({ status: 'failed' }), create({ archived_at: '2026-01-02T00:00:00Z' }),
    ]);
    expect((await call()).status).toBe(200);
    expect((await sqliteDb.jobs.getById(target.id))?.package_config).toEqual({ ...original, assignments });
    for (const job of others) expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual(original);
  });

  it('refuses to persist a selected deployment from another tenant', async () => {
    const job = await create({ tenant_id: 'other-tenant' });
    expect((await call()).status).toBe(409);
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual(original);
    expect(state.assign).not.toHaveBeenCalled();
  });

  it('preserves assignments when only categories change', async () => {
    const job = await create(); const categories = [{ id: 'new-category' }];
    expect((await call({ wingetId: 'Fixture.App', categories })).status).toBe(200);
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual({ ...original, categories });
  });

  it('leaves local configuration unchanged without a package identity', async () => {
    const job = await create();
    expect((await call({ assignments })).status).toBe(200);
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual(original);
  });

  it('returns an error if the local write fails after the Graph operation', async () => {
    const job = await create();
    const update = vi.spyOn(sqliteDeployedConfig, 'mergeFields').mockImplementationOnce(() => { throw new Error('Fixture storage failure'); });
    try { expect((await call()).status).toBe(500); }
    finally { update.mockRestore(); }
    expect(state.assign).toHaveBeenCalledOnce();
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual(original);
  });

  it('finds the matching tenant despite a newer deployment in another tenant', async () => {
    const target = await create({ created_at: '2026-01-01T00:00:00Z' });
    const other = await create({ tenant_id: 'other-tenant', created_at: '2026-02-01T00:00:00Z' });
    expect((await call()).status).toBe(200);
    expect((await sqliteDb.jobs.getById(target.id))?.package_config).toEqual({ ...original, assignments });
    expect((await sqliteDb.jobs.getById(other.id))?.package_config).toEqual(original);
    const reopened = await GET(new NextRequest('http://localhost/api/intune/apps/deployed/config?wingetId=Fixture.App', {
      headers: { Authorization: 'Bearer fixture' },
    }));
    expect(await reopened.json()).toMatchObject({ config: { ...original, assignments } });
  });

  it('finds the deployed app beyond the recent fifty user jobs', async () => {
    const target = await create({ created_at: '2020-01-01T00:00:00Z' });
    for (let index = 0; index < 51; index++) await create({ winget_id: `Other.App${index}` });
    expect((await call()).status).toBe(200);
    expect((await sqliteDb.jobs.getById(target.id))?.package_config).toEqual({ ...original, assignments });
    const reopened = await GET(new NextRequest('http://localhost/api/intune/apps/deployed/config?wingetId=Fixture.App', {
      headers: { Authorization: 'Bearer fixture' },
    }));
    expect(await reopened.json()).toMatchObject({ config: { ...original, assignments } });
  });

  it('saves the requested Intune app without overwriting the latest deployment of the same package', async () => {
    const older = await create({ intune_app_id: 'older-app', created_at: '2026-01-01T00:00:00Z' });
    const newer = await create({ intune_app_id: 'newer-app', created_at: '2026-02-01T00:00:00Z' });
    expect((await call(undefined, 'older-app')).status).toBe(200);
    expect((await sqliteDb.jobs.getById(older.id))?.package_config).toEqual({ ...original, assignments });
    expect((await sqliteDb.jobs.getById(newer.id))?.package_config).toEqual(original);
    const reopened = await GET(new NextRequest('http://localhost/api/intune/apps/deployed/config?wingetId=Fixture.App', {
      headers: { Authorization: 'Bearer fixture' },
    }));
    expect(await reopened.json()).toMatchObject({ config: original, intuneAppId: 'newer-app' });
  });

  it('reports missing local app identity without writing another app configuration', async () => {
    const job = await create();
    const response = await call(undefined, 'untracked-app');
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('No matching local deployment');
    expect(state.assign).not.toHaveBeenCalled();
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual(original);
  });

  it('reports when a guarded update no longer matches the deployed job', async () => {
    const job = await create();
    const update = vi.spyOn(sqliteDeployedConfig, 'mergeFields').mockReturnValueOnce(null);
    try {
      const response = await call();
      expect(response.status).toBe(409);
      expect((await response.json()).error).toContain('Intune settings were updated');
    }
    finally { update.mockRestore(); }
    expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual(original);
  });

  for (const change of [{ status: 'cancelled' }, { archived_at: '2026-04-01T00:00:00Z' }, { intune_app_id: 'replacement-app' }]) {
    it(`refuses a local save after the deployment changes ${Object.keys(change)[0]}`, async () => {
      const job = await create();
      state.assign.mockImplementationOnce(() => { void sqliteDb.jobs.update(job.id, change); });
      expect((await call()).status).toBe(409);
      expect((await sqliteDb.jobs.getById(job.id))?.package_config).toEqual(original);
    });
  }
});
