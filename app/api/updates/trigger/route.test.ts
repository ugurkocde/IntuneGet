import { NextRequest } from 'next/server';
import type { AppUpdatePolicy, DeploymentConfig } from '@/types/update-policies';

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
    chain.eq.mockImplementation(() => chain);
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
          select: vi.fn(() => createSingleResultChain(policy)),
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
  });

  it('restores original policy fields when installer lookup fails', async () => {
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
    getLatestInstallerInfoMock.mockResolvedValue(null);

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
    expect(policyUpdatePayloads).toEqual([
      { policy_type: 'auto_update', is_enabled: true },
      { policy_type: 'notify', is_enabled: false },
    ]);
  });

  it('restores original policy fields when trigger throws', async () => {
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
      currentVersion: '',
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
    expect(policyUpdatePayloads).toEqual([
      { policy_type: 'auto_update', is_enabled: true },
      { policy_type: 'notify', is_enabled: false },
    ]);
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
      userSettings: { supersedePreviousApp: true },
    });
    createServerClientMock.mockReturnValue(supabase);
    getLatestInstallerInfoMock.mockResolvedValue({
      wingetId: 'Microsoft.Edge',
      currentVersion: '',
      latestVersion: '2.0.0',
      displayName: 'Microsoft Edge',
      installerUrl: 'https://example.com/edge.exe',
      installerSha256: 'abc123',
      installerType: 'exe',
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
        relationships: JSON.stringify(relationships),
        sourceIntuneAppId: 'prev-app-1',
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
      wingetId: 'Microsoft.Edge',
      currentVersion: '',
      latestVersion: '2.0.0',
      displayName: 'Microsoft Edge',
      installerUrl: 'https://example.com/edge.exe',
      installerSha256: 'abc123',
      installerType: 'exe',
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
});
