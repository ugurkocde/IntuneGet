/**
 * Tests for deploy-time update policy creation: the cart's updatePolicy choice
 * must materialize as a usable app_update_policies row once a deployment
 * completes, and must never write a null-config auto_update row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureUpdatePolicy, parseCartUpdatePolicy } from '../ensure-policy';

const {
  isSupabaseServerConfiguredMock,
  buildDeploymentConfigForAppMock,
  upsertMock,
  maybeSingleMock,
} = vi.hoisted(() => ({
  isSupabaseServerConfiguredMock: vi.fn(),
  buildDeploymentConfigForAppMock: vi.fn(),
  upsertMock: vi.fn(),
  maybeSingleMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseServerConfigured: isSupabaseServerConfiguredMock,
  createServerClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'app_update_policies') {
        return { upsert: upsertMock };
      }
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      builder.select = vi.fn(chain);
      builder.eq = vi.fn(chain);
      builder.maybeSingle = maybeSingleMock;
      return builder;
    }),
  })),
}));

vi.mock('@/lib/update-policies/build-deployment-config', () => ({
  buildDeploymentConfigForApp: buildDeploymentConfigForAppMock,
}));

const ARGS = {
  userId: 'user-1',
  tenantId: 'tenant-1',
  wingetId: 'Publisher.App',
  deployedVersion: '1.2.3',
};

const DEPLOYMENT_CONFIG = {
  displayName: 'App',
  publisher: 'Publisher',
  architecture: 'x64',
  installerType: 'msi',
  installCommand: 'msiexec /i app.msi /qn',
  uninstallCommand: 'msiexec /x {GUID} /qn',
  installScope: 'system',
  detectionRules: [],
};

describe('parseCartUpdatePolicy', () => {
  it('returns the choice for valid values', () => {
    expect(parseCartUpdatePolicy({ updatePolicy: 'auto_update' })).toBe('auto_update');
    expect(parseCartUpdatePolicy({ updatePolicy: 'ignore' })).toBe('ignore');
  });

  it('returns null for absent, invalid, or malformed configs', () => {
    expect(parseCartUpdatePolicy({})).toBeNull();
    expect(parseCartUpdatePolicy({ updatePolicy: 'notify' })).toBeNull();
    expect(parseCartUpdatePolicy({ updatePolicy: 'pin_version' })).toBeNull();
    expect(parseCartUpdatePolicy(null)).toBeNull();
    expect(parseCartUpdatePolicy('auto_update')).toBeNull();
    expect(parseCartUpdatePolicy([])).toBeNull();
  });
});

describe('ensureUpdatePolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupabaseServerConfiguredMock.mockReturnValue(true);
    maybeSingleMock.mockResolvedValue({ data: { settings: { carryOverAssignments: true } }, error: null });
    upsertMock.mockResolvedValue({ error: null });
  });

  it('skips when Supabase is not configured', async () => {
    isSupabaseServerConfiguredMock.mockReturnValue(false);

    const result = await ensureUpdatePolicy({ ...ARGS, policyType: 'auto_update' });

    expect(result).toEqual({ status: 'skipped', reason: 'not_configured' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('saves an auto_update policy with config and upload history link', async () => {
    buildDeploymentConfigForAppMock.mockResolvedValue({
      status: 'ok',
      deploymentConfig: DEPLOYMENT_CONFIG,
      originalUploadHistoryId: 'history-1',
    });

    const result = await ensureUpdatePolicy({ ...ARGS, policyType: 'auto_update' });

    expect(result).toEqual({ status: 'saved' });
    expect(buildDeploymentConfigForAppMock).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user-1',
      tenantId: 'tenant-1',
      wingetId: 'Publisher.App',
      latestVersion: '1.2.3',
      globalCarryOver: true,
    });
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        winget_id: 'Publisher.App',
        policy_type: 'auto_update',
        pinned_version: null,
        deployment_config: DEPLOYMENT_CONFIG,
        original_upload_history_id: 'history-1',
        is_enabled: true,
      }),
      { onConflict: 'user_id,tenant_id,winget_id' }
    );
  });

  it('skips auto_update instead of writing a null-config row when no config can be built', async () => {
    buildDeploymentConfigForAppMock.mockResolvedValue({ status: 'orphaned_job' });

    const result = await ensureUpdatePolicy({ ...ARGS, policyType: 'auto_update' });

    expect(result).toEqual({ status: 'skipped', reason: 'config_unavailable' });
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('saves an ignore policy without building a deployment config', async () => {
    const result = await ensureUpdatePolicy({ ...ARGS, policyType: 'ignore' });

    expect(result).toEqual({ status: 'saved' });
    expect(buildDeploymentConfigForAppMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        policy_type: 'ignore',
        deployment_config: null,
        original_upload_history_id: null,
      }),
      { onConflict: 'user_id,tenant_id,winget_id' }
    );
  });

  it('returns error instead of throwing when the upsert fails', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'boom' } });

    const result = await ensureUpdatePolicy({ ...ARGS, policyType: 'ignore' });

    expect(result).toEqual({ status: 'error', error: { message: 'boom' } });
  });

  it('returns error instead of throwing on unexpected failures', async () => {
    buildDeploymentConfigForAppMock.mockRejectedValue(new Error('network down'));

    const result = await ensureUpdatePolicy({ ...ARGS, policyType: 'auto_update' });

    expect(result.status).toBe('error');
  });
});
