import { describe, expect, it, vi } from 'vitest';
import { processPendingBatches } from './batch-orchestrator';
const { createServerClient, getDatabase, triggerPackagingWorkflow } = vi.hoisted(() => ({
  createServerClient: vi.fn(), getDatabase: vi.fn(), triggerPackagingWorkflow: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ createServerClient }));
vi.mock('@/lib/db', () => ({ getDatabase }));
vi.mock('@/lib/github-actions', () => ({ isGitHubActionsConfigured: () => true, triggerPackagingWorkflow }));
vi.mock('@/lib/config', () => ({ getAppConfig: () => ({ app: { url: 'https://example.com' } }) }));
vi.mock('@/lib/qa/gate', () => ({ enforceQaGate: async () => undefined, isQaGateError: () => false, describeQaGateError: () => '' }));
vi.mock('@/lib/catalog', () => ({ getCatalogSource: () => ({
  getAppDescription: async () => 'App',
  getLatestVersionInstallerInfo: async () => ({ installers: [{ Architecture: 'x64', InstallerUrl: 'https://example.com/test.exe',
    InstallerSha256: 'A'.repeat(64), InstallerType: 'exe', Scope: 'machine', InstallerSwitches: { Silent: '/S' } }] }),
}) }));
vi.mock('@/lib/msp/consent-verification', () => ({ verifyTenantConsent: async () => ({ verified: true }) }));

describe('MSP approval checkpoints', () => {
  it('skips only the affected managed tenant and continues the next tenant without duplicating a job', async () => {
    const batch = { id: 'batch', winget_id: 'Vendor.App', version: '2', display_name: 'App', architecture: 'x64', concurrency_limit: 2,
      created_by_user_id: 'msp-user', created_by_email: null };
    const items = [{ id: 'blocked', tenant_id: 'customer-a' }, { id: 'healthy', tenant_id: 'customer-b' }];
    const changes: Array<{ id?: string; value: Record<string, unknown> }> = [];
    createServerClient.mockReturnValue({ from: (table: string) => {
      let current: { id?: string; value: Record<string, unknown> } | undefined;
      const result = { data: table === 'msp_batch_deployments' ? [batch] : items, error: null, count: 0 };
      const builder = {
        select: () => builder, order: () => builder, limit: () => builder,
        eq: (key: string, value: string) => { if (key === 'id' && current) current.id = value; return builder; },
        update: (value: Record<string, unknown>) => { current = { value }; if (table === 'msp_batch_deployment_items') changes.push(current); return builder; },
        single: async () => ({ data: batch, error: null }),
        then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve),
      };
      return builder;
    } });
    const getApprovalFailures = vi.fn(async (tenantId: string) => tenantId === 'customer-a'
      ? [{ tenant_id: tenantId, winget_id: 'Vendor.App', status: 'failed', error_category: 'approval', error_details: null }] : []);
    const create = vi.fn(async value => value);
    const update = vi.fn();
    getDatabase.mockReturnValue({ jobs: { getApprovalFailures, create, update } });
    triggerPackagingWorkflow.mockResolvedValue({ success: true });
    const result = await processPendingBatches();
    expect(result).toMatchObject({ itemsStarted: 1, errors: [] });
    expect(getApprovalFailures).toHaveBeenCalledWith('customer-a', 'Vendor.App', undefined);
    expect(getApprovalFailures).toHaveBeenCalledWith('customer-b', 'Vendor.App', undefined);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 'customer-b' }));
    expect(triggerPackagingWorkflow).toHaveBeenCalledTimes(1);
    expect(changes).toContainEqual({ id: 'blocked', value: expect.objectContaining({ status: 'skipped' }) });
  });
});
