import { describe, expect, it, vi } from 'vitest';
import { buildStoredJobWorkflowInputs } from './stored-job-workflow-inputs';
import type { Win32CartItem } from '@/types/upload';
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { getById: vi.fn().mockResolvedValue(null) } }) }));

const target = '11111111-1111-4111-8111-111111111111';
const options = { callbackUrl: 'https://example.test/callback', qaOverride: false, sanitizeAssignments: true };
const item = { appSource: 'win32', wingetId: 'Contoso.App', sourceType: 'winget', installerType: 'exe', updateMode: 'sameApp', targetIntuneAppId: target,
  categories: [{ id: 'category', displayName: 'Category' }], espProfiles: [], relationships: [], forceCreate: true, assignments: [{ target: 'allDevices', intent: 'required' }],
  assignmentMigration: { carryOverAssignments: true, removeAssignmentsFromPreviousApp: true } } as unknown as Win32CartItem;
const job = (config: Win32CartItem) => ({ id: 'fixture-job', tenant_id: 'fixture-tenant', winget_id: 'Contoso.App', version: '2', package_config: config,
  is_auto_update: true }) as unknown as Parameters<typeof buildStoredJobWorkflowInputs>[0];

describe('same app stored dispatch binding', () => {
  it('does not send a same app request to a workflow that still creates new apps', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { triggerPackagingWorkflow } = await import('@/lib/github-actions');
      await expect(triggerPackagingWorkflow({ ...item, forceCreate: false, jobId: 'fixture-job', tenantId: 'fixture-tenant', callbackUrl: options.callbackUrl } as unknown as Parameters<typeof triggerPackagingWorkflow>[0], {
        token: 'fixture-token', owner: 'fixture', repo: 'fixture', workflowsRepo: 'fixture-workflows',
      })).rejects.toThrow(/same app.*stored.*binding/i);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it('keeps the persisted target and prevents creation or assignment mutation on retry', () => {
    expect(buildStoredJobWorkflowInputs(job(item), item, options)).toMatchObject({ updateMode: 'sameApp', targetIntuneAppId: target,
      forceCreate: false, carryOverAssignments: false, removeAssignmentsFromPreviousApp: false, autoSupersede: false,
      sourceIntuneAppId: undefined, assignments: undefined, categories: undefined, espProfiles: undefined, relationships: undefined });
  });
  it.each([undefined, '', 'not-an-app-id'])('rejects a stored same app job without a valid binding: %s', targetIntuneAppId => {
    const config = { ...item, targetIntuneAppId } as Win32CartItem;
    expect(() => buildStoredJobWorkflowInputs(job(config), config, options)).toThrow(/target/i);
  });
  it('refuses a supplied item that changes the stored target', () => {
    const supplied = { ...item, targetIntuneAppId: '22222222-2222-4222-8222-222222222222' };
    expect(() => buildStoredJobWorkflowInputs(job(item), supplied, options)).toThrow(/binding/i);
  });
  it('preserves create new defaults for existing queued jobs', () => {
    const config = { ...item, updateMode: undefined, targetIntuneAppId: undefined };
    expect(buildStoredJobWorkflowInputs(job(config), config, options)).toMatchObject({ forceCreate: true });
    expect(buildStoredJobWorkflowInputs(job(config), config, options).updateMode).toBeUndefined();
  });
});
