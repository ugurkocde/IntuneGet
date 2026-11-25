import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { triggerPackagingWorkflow, type WorkflowInputs } from './github-actions';

const { getById, getLatestDeployed, acquireGraphToken } = vi.hoisted(() => ({
  getById: vi.fn(), getLatestDeployed: vi.fn(), acquireGraphToken: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { getById, getLatestDeployed } }) }));
vi.mock('@/lib/graph-token', () => ({ acquireGraphToken }));
vi.mock('@/lib/catalog-installer-reconciliation', () => ({ reconcileCatalogInstaller: vi.fn(async (item) => ({ item, trustedInstallers: [] })) }));
vi.mock('@/lib/installer-preflight', () => ({ enforceInstallerPreflight: vi.fn(), InstallerPreflightError: class extends Error {} }));
vi.mock('@/lib/qa/gate', () => ({ enforceQaGate: vi.fn() }));
vi.mock('@/lib/winget-dependencies', () => ({ resolveWingetPackageDependencies: vi.fn(async () => []) }));
const target = '11111111-1111-4111-8111-111111111111';
const inputs = { jobId: 'fixture-job', tenantId: 'fixture-tenant', wingetId: 'Contoso.App', version: '2', displayName: 'Contoso App', publisher: 'Contoso', installerUrl: 'https://example.test/setup.exe', installerSha256: 'A'.repeat(64), installerType: 'exe', silentSwitches: '/S', uninstallCommand: 'uninstall.exe /S', callbackUrl: 'https://example.test/callback',
  updateMode: 'sameApp', targetIntuneAppId: target } as WorkflowInputs;
const config = { token: 'fixture-token', owner: 'fixture', repo: 'fixture', workflowsRepo: 'fixture' };
let job: Record<string, unknown>;
let history: Record<string, unknown>;
let graph: ReturnType<typeof vi.fn>;
beforeEach(() => {
  job = { id: inputs.jobId, tenant_id: inputs.tenantId, user_id: 'fixture-user', winget_id: inputs.wingetId,
    version: inputs.version, status: 'awaiting_qa', archived_at: null, cancelled_at: null,
    package_config: { updateMode: 'sameApp', targetIntuneAppId: target, wingetId: inputs.wingetId } };
  history = { user_id: 'fixture-user', tenant_id: inputs.tenantId, winget_id: inputs.wingetId,
    status: 'deployed', archived_at: null, intune_app_id: target };
  getById.mockImplementation(async () => job);
  getLatestDeployed.mockImplementation(async () => history);
  acquireGraphToken.mockResolvedValue({ accessToken: 'fixture-graph-token' });
  graph = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: target,
    '@odata.type': '#microsoft.graph.win32LobApp' }), { status: 200 }));
  vi.stubGlobal('fetch', graph);
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('deferred same-app dispatch reauthorization', () => {
  it.each(['id', 'tenant_id', 'winget_id', 'version', 'status'])('rejects changed persisted %s before Graph', async field => {
    job[field] = 'changed';
    await expect(triggerPackagingWorkflow(inputs, config)).rejects.toThrow(/stored.*binding/i);
    expect(graph).not.toHaveBeenCalled();
  });
  it('rejects an altered persisted target before Graph', async () => {
    job.package_config = { updateMode: 'sameApp', targetIntuneAppId: '22222222-2222-4222-8222-222222222222' };
    await expect(triggerPackagingWorkflow(inputs, config)).rejects.toThrow(/stored.*binding/i);
    expect(graph).not.toHaveBeenCalled();
  });
  it.each(['archived_at', 'cancelled_at'])('rejects a retired deferred job: %s', async field => {
    job[field] = '2026-01-01T00:00:00Z';
    await expect(triggerPackagingWorkflow(inputs, config)).rejects.toThrow(/stored.*binding/i);
    expect(graph).not.toHaveBeenCalled();
  });
  it('rejects history that no longer belongs to the persisted owner', async () => {
    history.user_id = 'other-user';
    await expect(triggerPackagingWorkflow(inputs, config)).rejects.toThrow(/active deployment/i);
    expect(getLatestDeployed).toHaveBeenCalledWith('fixture-user', inputs.tenantId, inputs.wingetId, target);
    expect(graph).not.toHaveBeenCalled();
  });
  it('rejects a deleted Graph target instead of dispatching', async () => {
    graph.mockResolvedValue(new Response('{}', { status: 404 }));
    await expect(triggerPackagingWorkflow(inputs, config)).rejects.toThrow(/target.*unavailable/i);
    expect(graph).toHaveBeenCalledTimes(1);
  });
  it('dispatches the exact same app while preserving relationships and settings', async () => {
    graph.mockImplementation(async (url: string) => url.startsWith('https://api.github.com/') ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ id: target, '@odata.type': '#microsoft.graph.win32LobApp' })));
    await expect(triggerPackagingWorkflow({ ...inputs, categories: '[{"id":"category"}]', relationships: '[]', assignments: '[]', espProfiles: '[]', autoSupersede: true, sourceIntuneAppId: target }, config, { skipRunCapture: true })).resolves.toEqual({ success: true });
    const call = graph.mock.calls.find(([url]) => String(url).startsWith('https://api.github.com/'))!;
    const payload = JSON.parse(call[1].body).client_payload.config;
    expect(payload).toMatchObject({ updateMode: 'sameApp', targetIntuneAppId: target, forceCreate: 'false', assignments: '[]', categories: '[]', espProfiles: '[]', sourceIntuneAppId: '', autoSupersede: 'false', carryOverAssignments: 'false', removeAssignmentsFromPreviousApp: 'false' });
    expect(payload).not.toHaveProperty('relationships');
  });
  it('does not dispatch a job cancelled while dispatch is being prepared', async () => {
    await expect(triggerPackagingWorkflow(inputs, config, { skipRunCapture: true, beforeDispatch: async () => { job.cancelled_at = '2026-01-01T00:00:00Z'; } })).rejects.toThrow(/binding/i);
    expect(graph.mock.calls.some(([url]) => String(url).startsWith('https://api.github.com/'))).toBe(false);
  });
  it('rejects a force-create fallback before any reads', async () => {
    await expect(triggerPackagingWorkflow({ ...inputs, forceCreate: true }, config)).rejects.toThrow(/force.*create/i);
    expect(getById).not.toHaveBeenCalled();
    expect(graph).not.toHaveBeenCalled();
  });
});
