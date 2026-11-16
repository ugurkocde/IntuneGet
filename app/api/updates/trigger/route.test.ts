import { WorkflowDispatchUnconfirmedError, WorkflowDispatchRateLimitError } from '@/lib/workflow-dispatch-rate-limit';
import { NextRequest } from 'next/server';
import type { AppUpdatePolicy, DeploymentConfig } from '@/types/update-policies';
import { canAutoUpdate } from '@/types/update-policies';

const {
  parseAccessTokenMock,
  createServerClientMock,
  getLatestInstallerInfoMock,
  triggerAutoUpdateMock,
  isGitHubActionsConfiguredMock,
  triggerPackagingWorkflowMock,
  getAppConfigMock,
  getFeatureFlagsMock,
} = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  createServerClientMock: vi.fn(),
  getLatestInstallerInfoMock: vi.fn(),
  triggerAutoUpdateMock: vi.fn(),
  isGitHubActionsConfiguredMock: vi.fn(),
  triggerPackagingWorkflowMock: vi.fn(),
  getAppConfigMock: vi.fn(),
  getFeatureFlagsMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
  isSupabaseConfigured: () => true,
  isSupabaseServerConfigured: () => true,
}));

vi.mock('@/lib/auto-update/trigger', () => ({
  AutoUpdateTrigger: class {
    triggerAutoUpdate = triggerAutoUpdateMock;
  },
  getLatestInstallerInfo: getLatestInstallerInfoMock,
}));

vi.mock('@/lib/github-actions', () => ({
  isGitHubActionsConfigured: isGitHubActionsConfiguredMock,
  triggerPackagingWorkflow: triggerPackagingWorkflowMock,
}));

vi.mock('@/lib/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('@/lib/features', () => ({
  getFeatureFlags: getFeatureFlagsMock,
}));

// Tenant authorization has its own tests in lib/msp/tenant-resolution.test.ts.
// Here it allows the requested tenant unless a test says otherwise.
const { resolveTargetTenantIdMock } = vi.hoisted(() => ({ resolveTargetTenantIdMock: vi.fn() }));
vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: resolveTargetTenantIdMock,
}));
const allowRequestedTenant = async ({ requestedTenantId }: { requestedTenantId: string }) => ({
  tenantId: requestedTenantId,
  errorResponse: null,
});

import { NextResponse } from 'next/server';
import { POST } from '@/app/api/updates/trigger/route';

interface TriggerSupabaseMocks {
  supabase: {
    from: (table: string) => {
      select?: (...args: unknown[]) => {
        eq: (...args: unknown[]) => unknown;
      };
      update?: (payload: Record<string, unknown>) => {
        eq: (column: string, value: string) => Promise<{ data: null; error: null }>;
      };
    };
  };
  policyUpdatePayloads: Array<Record<string, unknown>>;
}

function createTriggerSupabaseMocks(
  policy: AppUpdatePolicy,
  options?: {
    latestUploadIntuneAppId?: string;
    userSettings?: Record<string, unknown>;
    storedJob?: Record<string, unknown>;
    readError?: boolean;
  }
): TriggerSupabaseMocks {
  const policyUpdatePayloads: Array<Record<string, unknown>> = [];

  const createSingleResultChain = <T,>(data: T) => {
    const chain: {
      eq: ReturnType<typeof vi.fn>;
      single: ReturnType<typeof vi.fn>;
    } = {
      eq: vi.fn(),
      single: vi.fn(),
    };
    chain.eq.mockImplementation((key: string, value: unknown) => {
      if (key === 'tenant_id' && data && typeof data === 'object' && 'tenant_id' in data) Object.assign(data, { tenant_id: value });
      return chain;
    });
    chain.single.mockResolvedValue({ data, error: null });
    return chain;
  };

  const supabase = {
    from: (table: string) => {
      if (table === 'update_check_results') {
        return {
          select: vi.fn(() =>
            createSingleResultChain({
              id: 'update-1',
              current_version: '1.0.0',
            })
          ),
        };
      }

      if (table === 'app_update_policies') {
        return {
          select: vi.fn(() => createSingleResultChain({ ...policy })),
          update: vi.fn((payload: Record<string, unknown>) => {
            policyUpdatePayloads.push(payload);
            return {
              eq: vi.fn(async () => ({ data: null, error: null })),
            };
          }),
        };
      }

      if (table === 'upload_history') {
        const uploadChain: Record<string, ReturnType<typeof vi.fn>> = {
          select: vi.fn(),
          eq: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: options?.latestUploadIntuneAppId
              ? { intune_app_id: options.latestUploadIntuneAppId }
              : null,
            error: null,
          }),
        };
        for (const key of Object.keys(uploadChain)) {
          if (key !== 'maybeSingle') {
            uploadChain[key].mockReturnValue(uploadChain);
          }
        }
        return { select: uploadChain.select };
      }

      if (table === 'packaging_jobs') {
        return { select: () => {
          const filters: Array<(row: Record<string, unknown>) => boolean> = [];
          const query = {
            eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
            is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return query; },
            in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
            maybeSingle: async () => {
              const info = (await getLatestInstallerInfoMock.mock.results.at(-1)?.value)?.info ?? {};
              const config = policy.deployment_config ?? {};
              const id = (await triggerAutoUpdateMock.mock.results.at(-1)?.value)?.packagingJobId;
              const row = { id, user_id: policy.user_id, tenant_id: triggerAutoUpdateMock.mock.calls.at(-1)?.[0]?.tenant_id ?? policy.tenant_id,
                auto_update_policy_id: policy.id, is_auto_update: true, status: 'queued',
                winget_id: policy.winget_id, version: info.latestVersion,
                display_name: config.displayName || info.displayName, publisher: config.publisher,
                architecture: config.architecture, installer_type: info.installerType || config.installerType,
                installer_url: info.installerUrl, installer_sha256: info.installerSha256,
                install_command: info.installCommand || config.installCommand, uninstall_command: config.uninstallCommand,
                install_scope: info.installScope || config.installScope, detection_rules: config.detectionRules,
                package_config: { ...config, sourceType: info.sourceType || config.sourceType,
                  installerSuccessCodes: info.installerSuccessCodes, nestedInstallerType: info.nestedInstallerType,
                  nestedInstallerPath: info.nestedInstallerPath, forceCreate: config.forceCreateNewApp !== false,
                  sourceIntuneAppId: options?.latestUploadIntuneAppId,
                  autoSupersede: Boolean(options?.userSettings?.supersedePreviousApp && options?.latestUploadIntuneAppId),
                  supersedenceType: options?.userSettings?.supersedePreviousApp && options?.latestUploadIntuneAppId ? 'update' : undefined,
                  assignmentMigration: { carryOverAssignments: options?.userSettings?.carryOverAssignments ?? false },
                  // The production snapshot keeps the refreshed command on the row.
                  installCommand: undefined,
                }, ...options?.storedJob };
              return { data: !options?.readError && filters.every(f => f(row)) ? row : null,
                error: options?.readError ? { message: 'synthetic private read error' } : null };
            },
          };
          return query;
        } };
      }

      if (table === 'user_settings') {
        const settingsChain: Record<string, ReturnType<typeof vi.fn>> = {
          select: vi.fn(),
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: options?.userSettings ? { settings: options.userSettings } : null,
            error: null,
          }),
        };
        for (const key of Object.keys(settingsChain)) {
          if (key !== 'maybeSingle') {
            settingsChain[key].mockReturnValue(settingsChain);
          }
        }
        return { select: settingsChain.select };
      }

      throw new Error(`Unexpected table used in test: ${table}`);
    },
  };

  return {
    supabase,
    policyUpdatePayloads,
  };
}

describe('POST /api/updates/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'home-tenant',
      userName: 'User',
    });
    resolveTargetTenantIdMock.mockImplementation(allowRequestedTenant);
  });

  it('refuses the whole request when one of the named tenants is not the caller\'s to deploy to', async () => {
    const from = vi.fn(() => {
      throw new Error('no table may be touched before authorization');
    });
    createServerClientMock.mockReturnValue({ from });
    resolveTargetTenantIdMock.mockImplementation(async ({ requestedTenantId }: { requestedTenantId: string }) =>
      requestedTenantId === 'someone-elses-tenant'
        ? { tenantId: 'home-tenant', errorResponse: NextResponse.json({ error: 'Not authorized to access other tenants' }, { status: 403 }) }
        : { tenantId: requestedTenantId, errorResponse: null }
    );

    const response = await POST(
      new NextRequest('http://localhost:3000/api/updates/trigger', {
        method: 'POST',
        headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: [
            { winget_id: 'Vendor.One', tenant_id: 'tenant-1' },
            { winget_id: 'Vendor.Two', tenant_id: 'someone-elses-tenant' },
          ],
        }),
      })
    );

    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
    expect(triggerAutoUpdateMock).not.toHaveBeenCalled();
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
    expect(resolveTargetTenantIdMock).toHaveBeenCalledWith(
      expect.objectContaining({ requestedTenantId: 'tenant-1', requiredPermission: 'deploy_apps', tokenTenantId: 'home-tenant' })
    );
  });

  it('leaves stored policy fields untouched when installer lookup fails', async () => {
    const policy: AppUpdatePolicy = {
      id: 'policy-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      winget_id: 'Microsoft.Edge',
      policy_type: 'notify',
      pinned_version: null,
      deployment_config: null,
      original_upload_history_id: null,
      last_auto_update_at: null,
      last_auto_update_version: null,
      is_enabled: false,
      consecutive_failures: 0,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    };

    const { supabase, policyUpdatePayloads } = createTriggerSupabaseMocks(policy);
    createServerClientMock.mockReturnValue(supabase);
    const failureMessage = 'The catalog has not synced the installer manifest for Microsoft.Edge 2.0.0 yet. Try again after the next catalog sync.';
    getLatestInstallerInfoMock.mockResolvedValue({
      ok: false,
      failure: {
        reason: 'version_record_missing',
        message: failureMessage,
      },
    });

    const request = new NextRequest('http://localhost:3000/api/updates/trigger', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        winget_id: 'Microsoft.Edge',
        tenant_id: 'tenant-1',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.failed).toBe(1);
    expect(body.results[0].error).toBe(failureMessage);
    expect(policyUpdatePayloads).toEqual([]);
  });

  it('leaves stored policy fields untouched when trigger throws', async () => {
    const policy: AppUpdatePolicy = {
      id: 'policy-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      winget_id: 'Microsoft.Edge',
      policy_type: 'notify',
      pinned_version: null,
      deployment_config: null,
      original_upload_history_id: null,
      last_auto_update_at: null,
      last_auto_update_version: null,
      is_enabled: false,
      consecutive_failures: 0,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    };

    const { supabase, policyUpdatePayloads } = createTriggerSupabaseMocks(policy);
    createServerClientMock.mockReturnValue(supabase);
    getLatestInstallerInfoMock.mockResolvedValue({
      ok: true,
      info: { currentVersion: '' },
    });
    triggerAutoUpdateMock.mockRejectedValue(new Error('trigger crashed'));

    const request = new NextRequest('http://localhost:3000/api/updates/trigger', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        winget_id: 'Microsoft.Edge',
        tenant_id: 'tenant-1',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.failed).toBe(1);
    expect(body.results[0].error).toContain('trigger crashed');
    expect(policyUpdatePayloads).toEqual([]);
  });

  it('preserves stored manual policy settings and never dispatches when fixed rules hold the update', async () => {
    const policy = {id:'policy-1',user_id:'user-1',tenant_id:'tenant-1',winget_id:'Microsoft.Edge',policy_type:'notify',is_enabled:false,consecutive_failures:0,deployment_config:{architecture:'x64',psadtConfig:{customDetection:true}},original_upload_history_id:null} as AppUpdatePolicy;
    const {supabase,policyUpdatePayloads}=createTriggerSupabaseMocks(policy);
    createServerClientMock.mockReturnValue(supabase);
    getLatestInstallerInfoMock.mockResolvedValue({ok:true,info:{wingetId:'Microsoft.Edge',currentVersion:'',latestVersion:'2.0.0'}});
    triggerAutoUpdateMock.mockResolvedValue({success:false,skipped:true,skipReason:'Custom detection rules are fixed. Deploy 2.0.0 from the catalog with updated rules.'});
    const response=await POST(new NextRequest('http://localhost:3000/api/updates/trigger',{method:'POST',headers:{Authorization:'Bearer test-token','Content-Type':'application/json'},body:JSON.stringify({winget_id:'Microsoft.Edge',tenant_id:'tenant-1'})}));
    expect((await response.json()).results[0]).toMatchObject({success:false,skipped:true});
    expect(policyUpdatePayloads).toEqual([]);
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('runs a paused automatic policy once without enabling stored state, trigger failure: %s', async fails => {
    const policy = { id: 'policy-1', user_id: 'user-1', tenant_id: 'tenant-1',
      winget_id: 'Microsoft.Edge', policy_type: 'auto_update', is_enabled: false,
      consecutive_failures: 3, deployment_config: { architecture: 'x64' },
      original_upload_history_id: null } as AppUpdatePolicy;
    const { supabase, policyUpdatePayloads } = createTriggerSupabaseMocks(policy);
    createServerClientMock.mockReturnValue(supabase);
    getLatestInstallerInfoMock.mockResolvedValue({ ok: true, info: {
      wingetId: 'Microsoft.Edge', currentVersion: '', latestVersion: '2.0.0' } });
    triggerAutoUpdateMock.mockImplementation(async (attempt: AppUpdatePolicy) => {
      expect(canAutoUpdate(attempt)).toBe(true);
      expect(attempt.consecutive_failures).toBe(0);
      if (fails) throw new Error('synthetic trigger failure');
      return { success: true, packagingJobId: 'manual-job' };
    });
    getFeatureFlagsMock.mockReturnValue({ localPackager: true });
    const response = await POST(new NextRequest('http://localhost:3000/api/updates/trigger', {
      method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ winget_id: 'Microsoft.Edge', tenant_id: 'tenant-1' }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).triggered).toBe(fails ? 0 : 1);
    expect(triggerAutoUpdateMock).toHaveBeenCalledOnce();
    expect(policyUpdatePayloads).toEqual([]);
    expect(policy).toMatchObject({ policy_type: 'auto_update', is_enabled: false, consecutive_failures: 3 });
  });

  it('returns an explicit skipped result when auto-update is blocked by current QA', async () => {
    const policy: AppUpdatePolicy = {
      id: 'policy-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      winget_id: 'Microsoft.Edge',
      policy_type: 'auto_update',
      pinned_version: null,
      deployment_config: { architecture: 'x64' } as DeploymentConfig,
      original_upload_history_id: null,
      last_auto_update_at: null,
      last_auto_update_version: null,
      is_enabled: true,
      consecutive_failures: 0,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    };

    const { supabase } = createTriggerSupabaseMocks(policy);
    createServerClientMock.mockReturnValue(supabase);
    getLatestInstallerInfoMock.mockResolvedValue({
      ok: true,
      info: {
        wingetId: 'Microsoft.Edge',
        currentVersion: '',
        latestVersion: '2.0.0',
      },
    });
    triggerAutoUpdateMock.mockResolvedValue({
      success: false,
      skipped: true,
      code: 'QA_FAILED_CURRENT_VERSION',
      skipReason: 'QA failed; correct the uninstall command and rerun QA.',
    });

    const response = await POST(new NextRequest('http://localhost:3000/api/updates/trigger', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ winget_id: 'Microsoft.Edge', tenant_id: 'tenant-1' }),
    }));
    const body = await response.json();

    expect(body).toMatchObject({
      success: false,
      failed: 1,
      results: [{
        success: false,
        skipped: true,
        code: 'QA_FAILED_CURRENT_VERSION',
      }],
    });
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('forwards stored relationships and auto-supersedence to the packaging workflow', async () => {
    const relationships = [
      {
        relationshipType: 'dependency' as const,
        targetId: 'dep-app-1',
        targetDisplayName: 'Dependency App',
        dependencyType: 'autoInstall' as const,
      },
    ];

    const deploymentConfig: DeploymentConfig = {
      displayName: 'Microsoft Edge',
      publisher: 'Microsoft',
      architecture: 'x64',
      installerType: 'exe',
      installCommand: 'setup.exe /silent',
      uninstallCommand: '',
      installScope: 'system',
      detectionRules: [],
      assignments: [],
      relationships,
    };

    const policy: AppUpdatePolicy = {
      id: 'policy-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      winget_id: 'Microsoft.Edge',
      policy_type: 'auto_update',
      pinned_version: null,
      deployment_config: deploymentConfig,
      original_upload_history_id: null,
      last_auto_update_at: null,
      last_auto_update_version: null,
      is_enabled: true,
      consecutive_failures: 0,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    };

    const { supabase } = createTriggerSupabaseMocks(policy, {
      latestUploadIntuneAppId: 'prev-app-1',
      userSettings: { carryOverAssignments: true, supersedePreviousApp: true },
    });
    createServerClientMock.mockReturnValue(supabase);
    getLatestInstallerInfoMock.mockResolvedValue({
      ok: true,
      info: {
        wingetId: 'Microsoft.Edge',
        currentVersion: '',
        latestVersion: '2.0.0',
        displayName: 'Microsoft Edge',
        installerUrl: 'https://example.com/edge.exe',
        installerSha256: 'abc123',
        installerType: 'exe',
        installerSuccessCodes: [0, 3010],
      },
    });
    triggerAutoUpdateMock.mockResolvedValue({
      success: true,
      packagingJobId: 'pkg-job-1',
    });
    getFeatureFlagsMock.mockReturnValue({ pipeline: true, localPackager: false });
    isGitHubActionsConfiguredMock.mockReturnValue(true);
    getAppConfigMock.mockReturnValue({ app: { url: 'http://localhost:3000' } });
    triggerPackagingWorkflowMock.mockResolvedValue({ success: true });

    const request = new NextRequest('http://localhost:3000/api/updates/trigger', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        winget_id: 'Microsoft.Edge',
        tenant_id: 'tenant-1',
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.triggered).toBe(1);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'pkg-job-1',
        installerSuccessCodes: [0, 3010],
        relationships: JSON.stringify(relationships),
        sourceIntuneAppId: 'prev-app-1',
        carryOverAssignments: true,
        removeAssignmentsFromPreviousApp: false,
        autoSupersede: true,
        supersedenceType: 'update',
      }),
      undefined,
      expect.any(Object)
    );
  });

  it('does not request auto-supersedence when the user setting is off', async () => {
    const policy: AppUpdatePolicy = {
      id: 'policy-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      winget_id: 'Microsoft.Edge',
      policy_type: 'auto_update',
      pinned_version: null,
      deployment_config: {
        displayName: 'Microsoft Edge',
        publisher: 'Microsoft',
        architecture: 'x64',
        installerType: 'exe',
        installCommand: 'setup.exe /silent',
        uninstallCommand: '',
        installScope: 'system',
        detectionRules: [],
        assignments: [],
      } as DeploymentConfig,
      original_upload_history_id: null,
      last_auto_update_at: null,
      last_auto_update_version: null,
      is_enabled: true,
      consecutive_failures: 0,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    };

    const { supabase } = createTriggerSupabaseMocks(policy, {
      latestUploadIntuneAppId: 'prev-app-1',
    });
    createServerClientMock.mockReturnValue(supabase);
    getLatestInstallerInfoMock.mockResolvedValue({
      ok: true,
      info: {
        wingetId: 'Microsoft.Edge',
        currentVersion: '',
        latestVersion: '2.0.0',
        displayName: 'Microsoft Edge',
        installerUrl: 'https://example.com/edge.exe',
        installerSha256: 'abc123',
        installerType: 'exe',
      },
    });
    triggerAutoUpdateMock.mockResolvedValue({
      success: true,
      packagingJobId: 'pkg-job-2',
    });
    getFeatureFlagsMock.mockReturnValue({ pipeline: true, localPackager: false });
    isGitHubActionsConfiguredMock.mockReturnValue(true);
    getAppConfigMock.mockReturnValue({ app: { url: 'http://localhost:3000' } });
    triggerPackagingWorkflowMock.mockResolvedValue({ success: true });

    const request = new NextRequest('http://localhost:3000/api/updates/trigger', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        winget_id: 'Microsoft.Edge',
        tenant_id: 'tenant-1',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
    const workflowInputs = triggerPackagingWorkflowMock.mock.calls[0][0];
    expect(workflowInputs.autoSupersede).toBe(false);
    expect(workflowInputs.supersedenceType).toBeUndefined();
    expect(workflowInputs.relationships).toBeUndefined();
  });
  it.each(['503', 'network', 'miss', 'write error', 'stored custom', 'custom', 'missing pin', 'invalid pin', 'rate limit', 'batch', 'awaiting QA'])('handles a manual update dispatch with %s safely', async kind => {
    const policy: AppUpdatePolicy = {
      id: 'policy-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      winget_id: 'Microsoft.Edge',
      policy_type: 'auto_update',
      pinned_version: null,
      deployment_config: {
        displayName: 'Microsoft Edge',
        publisher: 'Microsoft',
        architecture: 'x64',
        installerType: 'exe',
        installCommand: 'setup.exe /silent',
        uninstallCommand: '',
        installScope: 'system',
        detectionRules: [],
        assignments: [],
      } as DeploymentConfig,
      original_upload_history_id: null,
      last_auto_update_at: null,
      last_auto_update_version: null,
      is_enabled: true,
      consecutive_failures: 0,
      created_at: '2026-02-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
    };

    const { supabase } = createTriggerSupabaseMocks(policy, {
      latestUploadIntuneAppId: 'prev-app-1',
    });
    if (kind === 'stored custom') policy.deployment_config = { ...policy.deployment_config, sourceType: 'custom' } as DeploymentConfig;
    const writes: Array<{ table: string; patch: Record<string, unknown>; guards: Record<string, unknown> }> = [];
    const from = supabase.from;
    supabase.from = ((table: string) => {
      if (!['packaging_jobs', 'auto_update_history'].includes(table)) return from(table);
      return { ...(table === 'packaging_jobs' ? from(table) : {}), update: (patch: Record<string, unknown>) => {
        const guards: Record<string, unknown> = {};
        writes.push({ table, patch, guards });
        const result = { data: kind === 'miss' ? null : { id: 'pkg-job-2' }, error: kind === 'write error' ? { message: 'synthetic write failure' } : null };
        const query = {
          eq: (key: string, value: unknown) => { guards[key] = value; return query; },
          is: (key: string, value: unknown) => { guards[key] = value; return query; },
          in: (key: string, value: unknown) => { guards[key] = value; return query; },
          select: () => query, maybeSingle: vi.fn(async () => {
            const status = kind === 'awaiting QA' ? 'awaiting_qa' : 'queued';
            const accepted = Array.isArray(guards.status) ? guards.status.includes(status) : guards.status === status;
            return accepted ? result : { data: null, error: null };
          }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
        };
        return query;
      } };
    }) as typeof supabase.from;
    createServerClientMock.mockReturnValue(supabase);
    getLatestInstallerInfoMock.mockResolvedValue({
      ok: true,
      info: {
        sourceType: kind === 'custom' ? 'custom' : undefined,
        wingetId: 'Microsoft.Edge',
        currentVersion: '',
        latestVersion: '2.0.0',
        displayName: 'Microsoft Edge',
        installerUrl: 'https://example.com/edge.exe',
        installerSha256: 'abc123',
        installerType: 'exe',
      },
    });
    triggerAutoUpdateMock.mockResolvedValue({
      success: true,
      packagingJobId: 'pkg-job-2', historyId: 'history-2',
    });
    getFeatureFlagsMock.mockReturnValue({ pipeline: true, localPackager: false });
    isGitHubActionsConfiguredMock.mockReturnValue(true);
    getAppConfigMock.mockReturnValue({ app: { url: 'http://localhost:3000' } });
    const error = kind === 'rate limit'
      ? new WorkflowDispatchRateLimitError(429, new Date(Date.now() + 60_000).toISOString())
      : new WorkflowDispatchUnconfirmedError(kind === 'network' ? null : 503, Date.now(), kind === 'missing pin' ? undefined : kind === 'invalid pin' ? 'bad' : 'a'.repeat(64));
    triggerPackagingWorkflowMock.mockRejectedValue(error);
    if (kind === 'batch') {
      triggerAutoUpdateMock.mockResolvedValueOnce({ success: true, packagingJobId: 'pkg-job-2', historyId: 'history-2' })
        .mockResolvedValueOnce({ success: true, packagingJobId: 'pkg-job-3', historyId: 'history-3' });
      triggerPackagingWorkflowMock.mockRejectedValueOnce(error).mockResolvedValueOnce({ success: true });
    }

    const request = new NextRequest('http://localhost:3000/api/updates/trigger', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...(kind === 'batch' ? { updates: [{ winget_id: 'Microsoft.Edge', tenant_id: 'tenant-1' }, { winget_id: 'Microsoft.Edge', tenant_id: 'tenant-2' }] } : { winget_id: 'Microsoft.Edge', tenant_id: 'tenant-1' }),
      }),
    });

    const requestedAt = Date.now();
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(kind === 'batch' ? 2 : 1);
    expect(triggerPackagingWorkflowMock.mock.calls[0][2]).toMatchObject({ requireQaPass: true, newJobAdmission: !['stored custom', 'custom'].includes(kind) });
    const body = await response.json();
    if (kind === 'rate limit') {
      expect(writes).toEqual([]);
      expect(body.failed).toBe(1);
      return;
    }
    const terminal = ['stored custom', 'custom', 'missing pin', 'invalid pin'].includes(kind);
    expect(writes[0]).toMatchObject({ table: 'packaging_jobs', guards: {
      id: 'pkg-job-2', github_run_id: null, callback_run_id: null,
      cancelled_at: null, archived_at: null, error_details: null,
    } });
    if (terminal) {
      expect(writes[0].patch).toMatchObject({ status: 'failed', error_code: error.code });
      expect(writes[0].patch.error_details).toBeUndefined();
      expect(writes[1]).toMatchObject({ table: 'auto_update_history', patch: { status: 'failed' }, guards: { id: 'history-2' } });
      expect(body.failed).toBe(1);
    } else {
      expect(writes).toHaveLength(1);
      expect(writes[0].patch).toMatchObject({ status: 'awaiting_qa', completed_at: null, error_code: error.code,
        error_details: { workflow_dispatch_unconfirmed_identity: 'a'.repeat(64), workflow_dispatch_rate_limit_attempts: 1 } });
      expect(Date.parse(writes[0].patch.qa_resume_due_at as string)).toBeGreaterThanOrEqual(requestedAt + 60_000);
      const success = ['503', 'network', 'batch', 'awaiting QA'].includes(kind);
      expect(body.failed).toBe(success ? 0 : 1);
      expect(body.triggered).toBe(kind === 'batch' ? 2 : success ? 1 : 0);
      if (success) expect(body.results[0]).toMatchObject({ success: true, packaging_job_id: 'pkg-job-2', code: error.code });
      else expect(body.results[0].error).toMatch(kind === 'miss' ? /status changed/ : /Could not schedule/);
    }
  });

  it.each(['user_id', 'tenant_id', 'auto_update_policy_id', 'is_auto_update', 'status',
    'github_run_id', 'callback_run_id', 'cancelled_at', 'archived_at', 'read error'])
  ('does not dispatch a stored job with a changed ownership guard: %s', async field => {
    const policy = { id: 'policy-1', user_id: 'user-1', tenant_id: 'tenant-1', winget_id: 'Microsoft.Edge',
      policy_type: 'auto_update', is_enabled: true, deployment_config: {} } as AppUpdatePolicy;
    const { supabase } = createTriggerSupabaseMocks(policy, {
      storedJob: field === 'read error' ? {} : { [field]: field === 'is_auto_update' ? false : 'changed' },
      readError: field === 'read error',
    });
    const writes: Array<{ table: string; patch: Record<string, unknown> }> = [];
    const from = supabase.from;
    supabase.from = ((table: string) => {
      if (!['packaging_jobs', 'auto_update_history'].includes(table)) return from(table);
      return { ...(table === 'packaging_jobs' ? from(table) : {}), update: (patch: Record<string, unknown>) => {
        writes.push({ table, patch });
        const query = { eq: () => query, is: () => query, in: () => query, select: () => query,
          maybeSingle: async () => ({ data: { id: 'job-guard' }, error: null }),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
        return query;
      } };
    }) as typeof supabase.from;
    createServerClientMock.mockReturnValue(supabase);
    triggerAutoUpdateMock.mockResolvedValue({ success: true, packagingJobId: 'job-guard', historyId: 'history-guard' });
    getLatestInstallerInfoMock.mockResolvedValue({ ok: true, info: { latestVersion: '2.0.0' } });
    getFeatureFlagsMock.mockReturnValue({ localPackager: false });
    isGitHubActionsConfiguredMock.mockReturnValue(true);
    getAppConfigMock.mockReturnValue({ app: { url: 'https://example.test' } });
    const response = await POST(new NextRequest('https://example.test/api/updates/trigger', {
      method: 'POST', headers: { authorization: 'Bearer test-token' },
      body: JSON.stringify({ winget_id: 'Microsoft.Edge', tenant_id: 'tenant-1' }),
    }));
    const body = await response.json();
    expect(body).toMatchObject({ failed: 1, triggered: 0 });
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
    expect(writes.map(w => [w.table, w.patch.status])).toEqual(field === 'read error'
      ? [['packaging_jobs', 'failed'], ['auto_update_history', 'failed']] : []);
    expect(JSON.stringify(body)).not.toContain('synthetic private');
  });

});
