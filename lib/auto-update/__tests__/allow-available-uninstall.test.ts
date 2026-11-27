import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { AutoUpdateTrigger, type UpdateInfo } from '../trigger';
import { triggerSqliteAutoUpdate } from '../sqlite';
import type { AppUpdatePolicy, DeploymentConfig } from '@/types/update-policies';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

const mocks = vi.hoisted(() => ({
  notifyPaused: vi.fn(),
  ensureQaDemand: vi.fn(),
  getApprovalFailures: vi.fn().mockResolvedValue([]),
  getServicePrincipalToken: vi.fn(),
  readWin32AllowAvailableUninstall: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/notification-service', () => ({ notifyAutoUpdatePaused: mocks.notifyPaused }));
vi.mock('@/lib/qa/demand', () => ({ ensureQaDemand: mocks.ensureQaDemand }));
vi.mock('@/lib/db/supabase-adapter', () => ({
  supabaseDb: { jobs: { getApprovalFailures: mocks.getApprovalFailures } },
}));
vi.mock('@/lib/intune/graph-client', () => ({
  getServicePrincipalToken: mocks.getServicePrincipalToken,
}));
vi.mock('@/lib/intune-api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    readWin32AllowAvailableUninstall: mocks.readWin32AllowAvailableUninstall,
  };
});

const SOURCE_APP_UUID = '11111111-1111-4111-8111-111111111111';

function makePolicy(deploymentConfigOverrides: Partial<DeploymentConfig> = {}): AppUpdatePolicy {
  return {
    id: 'policy-2145',
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    winget_id: 'Contoso.App',
    policy_type: 'auto_update',
    pinned_version: null,
    deployment_config: {
      displayName: 'Contoso App',
      publisher: 'Contoso',
      architecture: 'x64',
      installerType: 'exe',
      installCommand: 'setup.exe /S',
      uninstallCommand: 'uninstall.exe /S',
      installScope: 'machine',
      detectionRules: [],
      psadtConfig: { ...DEFAULT_PSADT_CONFIG },
      ...deploymentConfigOverrides,
    },
    original_upload_history_id: 'hist-1',
    last_auto_update_at: null,
    last_auto_update_version: null,
    is_enabled: true,
    consecutive_failures: 0,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  };
}

function makeUpdateInfo(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    wingetId: 'Contoso.App',
    currentVersion: '1.0.0',
    latestVersion: '2.0.0',
    displayName: 'Contoso App',
    installerUrl: 'https://example.test/setup.exe',
    installerSha256: 'a'.repeat(64),
    installerType: 'exe',
    installCommand: 'setup.exe /S',
    uninstallCommand: 'uninstall.exe /S',
    installScope: 'machine',
    currentIntuneAppId: SOURCE_APP_UUID,
    ...overrides,
  };
}

function buildSupabaseMock(opts: {
  priorJobPackageConfig?: Record<string, unknown> | null;
  insertedJobs: Array<Record<string, unknown>>;
  policyUpdates: Array<Record<string, unknown>>;
}) {
  return {
    from: vi.fn((table: string) => {
      let checkpoint = false;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ['select', 'eq', 'is', 'not', 'contains', 'order', 'limit', 'gt', 'gte', 'in']) {
        builder[m] = vi.fn(chain);
      }
      builder.or = vi.fn(() => { checkpoint = true; return builder; });
      builder.single = vi.fn(async () => {
        if (table === 'tenant_consent') return { data: { is_active: true }, error: null };
        if (table === 'user_profiles') return { data: { email: 'admin@contoso.test' }, error: null };
        return { data: { id: `${table}-1` }, error: null };
      });
      builder.maybeSingle = vi.fn(async () => {
        if (checkpoint) return { data: null, error: null };
        if (table === 'upload_history') {
          return { data: opts.priorJobPackageConfig ? { packaging_job_id: 'prior-job-1' } : null, error: null };
        }
        if (table === 'packaging_jobs') {
          return { data: opts.priorJobPackageConfig ? { package_config: opts.priorJobPackageConfig } : null, error: null };
        }
        if (table === 'user_settings') return { data: { settings: {} }, error: null };
        return { data: null, error: null };
      });
      builder.insert = vi.fn((payload: Record<string, unknown>) => {
        if (table === 'packaging_jobs') opts.insertedJobs.push(payload);
        return {
          select: () => ({
            single: async () => ({ data: { id: `${table}-created-1` }, error: null }),
          }),
        };
      });
      builder.update = vi.fn((payload: Record<string, unknown>) => {
        if (table === 'app_update_policies') opts.policyUpdates.push(payload);
        return { eq: async () => ({ error: null }) };
      });
      return builder;
    }),
  };
}

describe('AutoUpdateTrigger allowAvailableUninstall precedence and fail-closed Graph inheritance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureQaDemand.mockResolvedValue({
      state: 'passed',
      candidateId: 'cand-1',
      identity: { executionProfileSha256: 'exec-sha', presentationProfileSha256: 'pres-sha' },
    });
    mocks.getServicePrincipalToken.mockResolvedValue('secret-bearer-token-do-not-log');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses explicit_config without calling Graph when deployment_config.allowAvailableUninstall is set', async () => {
    const insertedJobs: Array<Record<string, unknown>> = [];
    const policyUpdates: Array<Record<string, unknown>> = [];
    vi.mocked(createClient).mockReturnValue(buildSupabaseMock({ insertedJobs, policyUpdates }) as never);

    const trigger = new AutoUpdateTrigger('https://sb.test', 'key');
    const result = await trigger.triggerAutoUpdate(
      makePolicy({ allowAvailableUninstall: true } as Partial<DeploymentConfig>),
      makeUpdateInfo(),
      { skipRateLimits: true }
    );

    expect(result.success).toBe(true);
    expect(mocks.getServicePrincipalToken).not.toHaveBeenCalled();
    expect(mocks.readWin32AllowAvailableUninstall).not.toHaveBeenCalled();
    expect((insertedJobs[0].package_config as Record<string, unknown>).allowAvailableUninstall).toBe(true);
  });

  it('explicit_override wins over explicit_config', async () => {
    const insertedJobs: Array<Record<string, unknown>> = [];
    const policyUpdates: Array<Record<string, unknown>> = [];
    vi.mocked(createClient).mockReturnValue(buildSupabaseMock({ insertedJobs, policyUpdates }) as never);

    const trigger = new AutoUpdateTrigger('https://sb.test', 'key');
    const result = await trigger.triggerAutoUpdate(
      makePolicy({ allowAvailableUninstall: true } as Partial<DeploymentConfig>),
      makeUpdateInfo(),
      { skipRateLimits: true, allowAvailableUninstallOverride: false } as never
    );

    expect(result.success).toBe(true);
    expect(mocks.readWin32AllowAvailableUninstall).not.toHaveBeenCalled();
    expect((insertedJobs[0].package_config as Record<string, unknown>).allowAvailableUninstall).toBe(false);
  });

  it('inherits from prior upload_history packaging_job when deployment_config omits allowAvailableUninstall', async () => {
    const insertedJobs: Array<Record<string, unknown>> = [];
    const policyUpdates: Array<Record<string, unknown>> = [];
    vi.mocked(createClient).mockReturnValue(
      buildSupabaseMock({ priorJobPackageConfig: { allowAvailableUninstall: true }, insertedJobs, policyUpdates }) as never
    );

    const trigger = new AutoUpdateTrigger('https://sb.test', 'key');
    const result = await trigger.triggerAutoUpdate(makePolicy(), makeUpdateInfo(), { skipRateLimits: true });

    expect(result.success).toBe(true);
    expect(mocks.readWin32AllowAvailableUninstall).not.toHaveBeenCalled();
    expect((insertedJobs[0].package_config as Record<string, unknown>).allowAvailableUninstall).toBe(true);
  });

  it('inherits from live Intune Graph without persisting back to deployment_config and logs redacted source', async () => {
    const insertedJobs: Array<Record<string, unknown>> = [];
    const policyUpdates: Array<Record<string, unknown>> = [];
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.mocked(createClient).mockReturnValue(buildSupabaseMock({ insertedJobs, policyUpdates }) as never);
    mocks.readWin32AllowAvailableUninstall.mockResolvedValue({ status: 'hit', value: true });

    const policy = makePolicy();
    const trigger = new AutoUpdateTrigger('https://sb.test', 'key');
    const result = await trigger.triggerAutoUpdate(policy, makeUpdateInfo(), { skipRateLimits: true });

    expect(result.success).toBe(true);
    expect(mocks.readWin32AllowAvailableUninstall).toHaveBeenCalledWith('secret-bearer-token-do-not-log', SOURCE_APP_UUID);
    expect((insertedJobs[0].package_config as Record<string, unknown>).allowAvailableUninstall).toBe(true);
    expect((policy.deployment_config as Record<string, unknown>).allowAvailableUninstall).toBeUndefined();
    expect(policyUpdates.every((u) => !('deployment_config' in u))).toBe(true);
    const logged = JSON.stringify(infoSpy.mock.calls);
    expect(logged).toContain('inherited_graph');
    expect(logged).not.toContain('secret-bearer-token-do-not-log');
  });

  it('fails closed with INTUNE_SETTINGS_UNVERIFIED without incrementing consecutive_failures on transient Graph failure', async () => {
    const insertedJobs: Array<Record<string, unknown>> = [];
    const policyUpdates: Array<Record<string, unknown>> = [];
    vi.mocked(createClient).mockReturnValue(buildSupabaseMock({ insertedJobs, policyUpdates }) as never);
    mocks.readWin32AllowAvailableUninstall.mockRejectedValue(new Error('HTTP 503 Service Unavailable'));

    const trigger = new AutoUpdateTrigger('https://sb.test', 'key');
    const result = await trigger.triggerAutoUpdate(makePolicy(), makeUpdateInfo(), { skipRateLimits: true });

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(result.code).toBe('INTUNE_SETTINGS_UNVERIFIED');
    expect(insertedJobs).toHaveLength(0);
    expect(policyUpdates).toHaveLength(0);
  });

  it('falls back safely to omitted on Graph 404 or missing field', async () => {
    for (const resp of [{ status: 'not_found' }, { status: 'field_missing' }]) {
      const insertedJobs: Array<Record<string, unknown>> = [];
      vi.mocked(createClient).mockReturnValue(buildSupabaseMock({ insertedJobs, policyUpdates: [] }) as never);
      mocks.readWin32AllowAvailableUninstall.mockResolvedValue(resp);

      const trigger = new AutoUpdateTrigger('https://sb.test', 'key');
      const result = await trigger.triggerAutoUpdate(makePolicy(), makeUpdateInfo(), { skipRateLimits: true });
      expect(result.success).toBe(true);
      expect('allowAvailableUninstall' in (insertedJobs[0].package_config as Record<string, unknown>)).toBe(false);
    }
  });

  it('triggerSqliteAutoUpdate forwards explicit boolean and leaves undefined when unset', async () => {
    const createdJobs: Array<Record<string, unknown>> = [];
    const db = {
      jobs: {
        getApprovalFailures: async () => [],
        create: async (j: Record<string, unknown>) => { createdJobs.push(j); return { id: 'sqlite-job-1' }; },
      },
      autoUpdateHistory: {
        create: async () => ({ id: 'sqlite-hist-1' }),
        update: async () => undefined,
      },
      updatePolicies: {
        update: async () => undefined,
      },
    };

    const res1 = await triggerSqliteAutoUpdate(
      db as never,
      makePolicy({ allowAvailableUninstall: true } as Partial<DeploymentConfig>),
      { ...makeUpdateInfo(), currentIntuneAppId: SOURCE_APP_UUID, installCommand: '/S', uninstallCommand: '/U' },
      { skipRateLimits: true }
    );
    expect(res1.success).toBe(true);
    expect((createdJobs[0].package_config as Record<string, unknown>).allowAvailableUninstall).toBe(true);

    const res2 = await triggerSqliteAutoUpdate(
      db as never,
      makePolicy(),
      { ...makeUpdateInfo(), currentIntuneAppId: SOURCE_APP_UUID, installCommand: '/S', uninstallCommand: '/U' },
      { skipRateLimits: true }
    );
    expect(res2.success).toBe(true);
    expect('allowAvailableUninstall' in (createdJobs[1].package_config as Record<string, unknown>)).toBe(false);
  });
});
