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
  isSupabaseConfiguredMock,
  getDatabaseMock,
  getDetectedUpdatesMock,
  getHistoryMock,
  createJobMock,
  buildDeploymentConfigForAppMock,
  appExistsMock,
} = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  createServerClientMock: vi.fn(),
  getLatestInstallerInfoMock: vi.fn(),
  triggerAutoUpdateMock: vi.fn(),
  isGitHubActionsConfiguredMock: vi.fn(),
  triggerPackagingWorkflowMock: vi.fn(),
  getAppConfigMock: vi.fn(),
  getFeatureFlagsMock: vi.fn(),
  isSupabaseConfiguredMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  getDetectedUpdatesMock: vi.fn(),
  getHistoryMock: vi.fn(),
  createJobMock: vi.fn(),
  buildDeploymentConfigForAppMock: vi.fn(),
  appExistsMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
  isSupabaseConfigured: isSupabaseConfiguredMock,
}));

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}));

vi.mock('@/lib/update-policies/build-deployment-config', () => ({
  buildDeploymentConfigForApp: buildDeploymentConfigForAppMock,
}));

vi.mock('@/lib/catalog', () => ({
  getCatalogSource: () => ({ appExists: appExistsMock }),
}));

vi.mock('@/lib/auto-update/trigger', () => ({
  AutoUpdateTrigger: class {
    triggerAutoUpdate = triggerAutoUpdateMock;
  },
  getLatestInstallerInfo: getLatestInstallerInfoMock,
  // The Supabase-less path reuses these so both paths write the same
  // package_config shape.
  normalizeAssignments: (config: DeploymentConfig) => config.assignments ?? [],
  normalizeCategories: (config: DeploymentConfig) => config.categories ?? [],
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
    isSupabaseConfiguredMock.mockReturnValue(true);
    getDatabaseMock.mockReturnValue({
      updateCheckResults: { getByUserId: getDetectedUpdatesMock },
      uploadHistory: { getByUserIdAndTenantId: getHistoryMock },
      jobs: { create: createJobMock },
    });
    getDetectedUpdatesMock.mockResolvedValue([]);
    getHistoryMock.mockResolvedValue([]);
    createJobMock.mockResolvedValue({ id: 'job-new' });

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
  describe('without Supabase (DATABASE_MODE=sqlite self-hosting)', () => {
    const detectedUpdate = {
      id: 'upd-1',
      user_id: 'user-1',
      tenant_id: 'tenant-1',
      winget_id: 'Mozilla.Firefox',
      intune_app_id: 'stale-app-id',
      display_name: 'Mozilla Firefox',
      current_version: '152.0.1',
      latest_version: '152.0.5',
      is_critical: false,
      is_managed: false,
      large_icon_type: null,
      large_icon_value: null,
      notified_at: null,
      dismissed_at: null,
      detected_at: '2026-08-03T10:00:00Z',
      updated_at: '2026-08-03T10:00:00Z',
    };

    const deploymentConfig = {
      displayName: 'Mozilla Firefox',
      publisher: 'Mozilla',
      architecture: 'x64',
      installerType: 'exe',
      installCommand: 'setup.exe /S',
      uninstallCommand: 'helper.exe /S',
      installScope: 'system',
      detectionRules: [{ type: 'registry' }],
      assignments: [{ type: 'group', groupId: 'g-1' }],
      categories: [],
      forceCreateNewApp: true,
    } as unknown as DeploymentConfig;

    beforeEach(() => {
      isSupabaseConfiguredMock.mockReturnValue(false);
      getFeatureFlagsMock.mockReturnValue({ localPackager: true });
      getDetectedUpdatesMock.mockResolvedValue([detectedUpdate]);
      buildDeploymentConfigForAppMock.mockResolvedValue({
        status: 'ok',
        deploymentConfig,
        originalUploadHistoryId: 'upload-1',
      });
      getLatestInstallerInfoMock.mockResolvedValue({
        wingetId: 'Mozilla.Firefox',
        currentVersion: '152.0.1',
        latestVersion: '152.0.5',
        displayName: 'Mozilla Firefox',
        installerUrl: 'https://example.com/firefox.exe',
        installerSha256: 'a'.repeat(64),
        installerType: 'exe',
      });
    });

    function triggerRequest() {
      const request = new NextRequest('http://localhost:3000/api/updates/trigger', {
        method: 'POST',
        body: JSON.stringify({ winget_id: 'Mozilla.Firefox', tenant_id: 'tenant-1' }),
      });
      request.headers.set('Authorization', 'Bearer test-token');
      return request;
    }

    it('queues a packaging job instead of refusing with a 503', async () => {
      // Regression: this route answered 503 "Update deployment requires
      // Supabase" for every request, so the Update button in a self-hosted
      // install could never do anything. A manual trigger needs no policy and
      // no auto-update bookkeeping - only a queued job for the local packager.
      const response = await POST(triggerRequest());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.triggered).toBe(1);
      expect(body.results[0].packaging_job_id).toBe('job-new');
      expect(createServerClientMock).not.toHaveBeenCalled();

      const job = createJobMock.mock.calls[0][0];
      expect(job).toMatchObject({
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        winget_id: 'Mozilla.Firefox',
        version: '152.0.5',
        installer_url: 'https://example.com/firefox.exe',
        status: 'queued',
      });
      expect(job.package_config.assignments).toEqual([
        { type: 'group', groupId: 'g-1' },
      ]);
    });

    it('prefers the newest deployment over a stale detected app id', async () => {
      getHistoryMock.mockResolvedValue([
        { winget_id: 'Mozilla.Firefox', intune_app_id: 'current-app-id' },
        { winget_id: 'Mozilla.Firefox', intune_app_id: 'older-app-id' },
      ]);

      await POST(triggerRequest());

      const job = createJobMock.mock.calls[0][0];
      expect(job.package_config.sourceIntuneAppId).toBe('current-app-id');
    });

    it('falls back to the detected app id when there is no deployment history', async () => {
      getHistoryMock.mockResolvedValue([]);

      await POST(triggerRequest());

      const job = createJobMock.mock.calls[0][0];
      expect(job.package_config.sourceIntuneAppId).toBe('stale-app-id');
    });

    it('reports an unknown app instead of queueing a job for it', async () => {
      getDetectedUpdatesMock.mockResolvedValue([]);

      const body = await (await POST(triggerRequest())).json();

      expect(body.success).toBe(false);
      expect(body.failed).toBe(1);
      expect(body.results[0].error).toBe('Update not found');
      expect(createJobMock).not.toHaveBeenCalled();
    });

    it('refuses when no local packager would pick the job up', async () => {
      // Queueing here would leave the job sitting in 'queued' forever with no
      // indication to the user that nothing is going to run it.
      getFeatureFlagsMock.mockReturnValue({ localPackager: false });

      const body = await (await POST(triggerRequest())).json();

      expect(body.failed).toBe(1);
      expect(body.results[0].error).toMatch(/local packager/);
      expect(createJobMock).not.toHaveBeenCalled();
    });
  });
});
