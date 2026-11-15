import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  convert: vi.fn(), auth: vi.fn(), resolve: vi.fn(), token: vi.fn(), app: vi.fn(), assign: vi.fn(), categories: vi.fn(), rules: vi.fn(), requirements: vi.fn(), single: vi.fn(), job: vi.fn(),
}));
vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: mocks.auth }));
vi.mock('@/lib/msp/tenant-resolution', () => ({ resolveTargetTenantId: mocks.resolve }));
vi.mock('@/lib/intune/graph-client', () => ({ getServicePrincipalToken: mocks.token }));
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn() }));
vi.mock('@/lib/intune-api', () => ({ getApp: mocks.app, assignToGroups: mocks.assign, syncAppCategories: mocks.categories, setAppRules: mocks.rules, convertToGraphAssignments: mocks.convert }));
vi.mock('@/lib/requirement-rules', () => ({ buildCartItemRequirementRules: mocks.requirements }));
vi.mock('@/lib/supabase', () => ({ getServerClientOrNull: () => {
  const query: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'order', 'limit', 'update']) query[name] = () => query;
  query.single = mocks.single;
  query.maybeSingle = mocks.job;
  return { from: () => query };
} }));
import { PATCH } from './route';
const body = { assignments: [{ type: 'allUsers', intent: 'available' }], categories: [{ id: 'fixture-category' }], wingetId: 'Fixture.App' };
const call = (text = JSON.stringify(body)) => PATCH(new NextRequest('http://localhost/api/intune/apps/fixture-app/settings', {
  method: 'PATCH', headers: { Authorization: 'Bearer private-fixture-token', 'Content-Type': 'application/json' }, body: text,
}), { params: Promise.resolve({ id: 'private-fixture-app' }) });

describe('settings failure phase diagnostics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.convert.mockImplementation((x: unknown) => x);
    mocks.auth.mockResolvedValue({ userId: 'private-fixture-user', tenantId: 'private-fixture-tenant' });
    mocks.resolve.mockResolvedValue({ tenantId: 'private-fixture-tenant', errorResponse: null });
    mocks.single.mockResolvedValue({ data: true, error: null });
    mocks.token.mockResolvedValue('private-fixture-graph-token');
    mocks.app.mockResolvedValue({ displayName: 'private-fixture-name', rules: [] });
    mocks.requirements.mockReturnValue([{ ruleType: 'requirement' }]);
    mocks.job.mockResolvedValue({ data: { id: 'private-fixture-job', package_config: {} }, error: null });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  for (const [phase, method] of [
    ['authentication', 'auth'], ['tenant-resolution', 'resolve'], ['consent', 'single'], ['graph-token', 'token'],
    ['app-lookup', 'app'], ['set-rules', 'rules'], ['requirement-rules', 'requirements'], ['convert-assignments', 'convert'], ['assignments', 'assign'], ['categories', 'categories'], ['config-read', 'job'],
  ] as const) {
    it(`logs only a fixed phase when ${phase} throws`, async () => {
      mocks[method].mockImplementationOnce(() => { throw new Error('private-fixture-secret user@example.invalid https://fixture.invalid/?token=private'); });
      const response = await call();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: 'Failed to update app settings' });
      expect(console.error).toHaveBeenCalledExactlyOnceWith('[intune-app-settings] Update failed', { phase, errorKind: 'Error' });
      expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private');
    });
  }
  for (const value of ['private-fixture-secret', { message: 'private-fixture-secret' }]) it('keeps a non Error exception private', async () => {
    mocks.assign.mockRejectedValueOnce(value);
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to update app settings' });
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[intune-app-settings] Update failed', { phase: 'assignments', errorKind: 'other' });
  });
  it('identifies a missing Graph token without attempting an app update', async () => {
    mocks.token.mockResolvedValueOnce(null);
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to get Graph API token' });
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[intune-app-settings] Update failed', { phase: 'graph-token' });
    expect(mocks.app).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
  });
  it('identifies malformed body without making Graph writes', async () => {
    const response = await call('{');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to update app settings' });
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[intune-app-settings] Update failed', { phase: 'request-body', errorKind: 'SyntaxError' });
    expect(mocks.assign).not.toHaveBeenCalled();
  });
  it('distinguishes a config write exception after assignments succeeded', async () => {
    mocks.job.mockResolvedValueOnce({ data: { id: 'fixture', package_config: {} }, error: null }).mockRejectedValueOnce(new Error('private-save-error'));
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to update app settings' });
    expect(console.error).toHaveBeenCalledExactlyOnceWith('[intune-app-settings] Update failed', { phase: 'config-save', errorKind: 'Error' });
    expect(mocks.assign).toHaveBeenCalledOnce();
  });

  for (const name of ['TypeError', 'SyntaxError', 'AbortError', 'private-error-name']) {
    it(`allowlists error kind ${name}`, async () => {
      const error = new Error('private-fixture-secret'); error.name = name;
      mocks.assign.mockRejectedValueOnce(error);
      const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to update app settings' });
      expect(console.error).toHaveBeenCalledExactlyOnceWith('[intune-app-settings] Update failed', { phase: 'assignments', errorKind: name === 'private-error-name' ? 'other' : name });
      const output = JSON.stringify(vi.mocked(console.error).mock.calls);
      expect(output).not.toContain('private');
    });
  }
  it('keeps success quiet and preserves existing behavior', async () => {
    expect((await call()).status).toBe(200);
    expect(mocks.assign).toHaveBeenCalledOnce();
    expect(mocks.categories).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
  });
  it('keeps expected authentication, consent, app and persistence responses quiet', async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(401);
    mocks.single.mockResolvedValueOnce({ data: null, error: null });
    expect((await call()).status).toBe(403);
    mocks.app.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    mocks.job.mockResolvedValueOnce({ data: null, error: null });
    expect((await call()).status).toBe(409);
    expect(console.error).not.toHaveBeenCalled();
  });
});
