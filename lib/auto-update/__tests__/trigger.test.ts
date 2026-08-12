/**
 * Tests for auto-update trigger psadtConfig handling:
 * per-package PSADT settings must survive app updates (issue follow-up to #96).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoUpdateTrigger, getLatestInstallerInfo } from '../trigger';
import type { AppUpdatePolicy, DeploymentConfig } from '@/types/update-policies';
import type { QaResultRow } from '@/types/qa';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

const {
  getQaResultMock,
  getAppForInstallerMock,
  getVersionInstallerInfoMock,
  ensureQaDemandMock,
} = vi.hoisted(() => ({
  getQaResultMock: vi.fn(),
  getAppForInstallerMock: vi.fn(),
  getVersionInstallerInfoMock: vi.fn(),
  ensureQaDemandMock: vi.fn(),
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSource: () => ({
    getQaResult: getQaResultMock,
    getAppForInstaller: getAppForInstallerMock,
    getVersionInstallerInfo: getVersionInstallerInfoMock,
  }),
}));
vi.mock('@/lib/qa/demand', () => ({
  ensureQaDemand: ensureQaDemandMock,
}));

interface TableHandlers {
  maybeSingleResult?: { data: unknown; error: unknown };
  maybeSingleSpy?: ReturnType<typeof vi.fn>;
  singleResult?: { data: unknown; error: unknown };
  updateSpy?: ReturnType<typeof vi.fn>;
  insertSpy?: ReturnType<typeof vi.fn>;
  terminalError?: unknown;
}

function createSupabaseMock(tables: Record<string, TableHandlers>) {
  return {
    from: vi.fn((table: string) => {
      const handlers = tables[table] || {};
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const method of ['select', 'eq', 'not', 'contains', 'order', 'limit']) {
        builder[method] = vi.fn(chain);
      }
      builder.error = handlers.terminalError || null;
      builder.maybeSingle = vi.fn(async () => handlers.maybeSingleSpy
        ? handlers.maybeSingleSpy()
        : handlers.maybeSingleResult || { data: null, error: null });
      builder.single = vi.fn(async () => handlers.singleResult || { data: null, error: null });
      builder.update = vi.fn((payload: unknown) => {
        handlers.updateSpy?.(payload);
        return builder;
      });
      builder.insert = vi.fn((payload: unknown) => {
        handlers.insertSpy?.(payload);
        return builder;
      });
      return builder;
    }),
  };
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({})),
}));

const PSADT_CONFIG = {
  deployMode: 'Silent',
  verifyInstall: true,
  removeExistingInstall: true,
  registryMarkerPath: 'SOFTWARE\\Contoso\\Apps',
  installCommand: 'msiexec /i "setup.msi" /qn',
};

function makePolicy(deploymentConfig: Partial<DeploymentConfig>): AppUpdatePolicy {
  return {
    id: 'policy-1',
    user_id: 'user-1',
    tenant_id: 'tenant-1',
    winget_id: 'Test.App',
    policy_type: 'auto_update',
    deployment_config: deploymentConfig as DeploymentConfig,
    is_enabled: true,
  } as unknown as AppUpdatePolicy;
}

function zoomConfigForTrigger(): DeploymentConfig {
  const legacyRule = {
    type: 'file' as const,
    path: '%ProgramFiles%',
    fileOrFolderName: 'Zoom VDI Workplace',
    detectionType: 'exists' as const,
    check32BitOn64System: false,
  };
  return {
    displayName: 'Zoom VDI Workplace',
    publisher: 'Zoom',
    architecture: 'x64',
    installerType: 'msi',
    installCommand: 'msiexec /i "ZoomInstallerVDI.msi" /qn',
    uninstallCommand: 'msiexec /x {PRODUCT_CODE} /qn /norestart',
    installScope: 'machine',
    detectionRules: [legacyRule],
    psadtConfig: {
      ...DEFAULT_PSADT_CONFIG,
      detectionRules: [legacyRule],
    },
  };
}

const UPDATE_INFO = {
  wingetId: 'Test.App',
  currentVersion: '1.0.0',
  latestVersion: '2.0.0',
  displayName: 'Test App',
  installerUrl: 'https://example.com/setup-2.0.0.zip',
  installerSha256: 'abc',
  installerType: 'zip',
  installCommand: '"setup-2.0.0.exe" --current-version-silent',
  silentSwitches: '--current-version-silent',
  installScope: 'user' as const,
  nestedInstallerType: 'exe',
  nestedInstallerPath: 'setup-2.0.0.exe',
};

function makeTrigger(supabaseMock: ReturnType<typeof createSupabaseMock>): AutoUpdateTrigger {
  const trigger = new AutoUpdateTrigger('https://stub.supabase.co', 'stub-key');
  (trigger as unknown as { supabase: unknown }).supabase = supabaseMock;
  return trigger;
}

describe('AutoUpdateTrigger psadtConfig handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getQaResultMock.mockResolvedValue(null);
    getAppForInstallerMock.mockReset();
    getVersionInstallerInfoMock.mockReset();
    ensureQaDemandMock.mockResolvedValue({
      state: 'waiting',
      candidateId: 'candidate-1',
      identity: {
        executionProfileSha256: 'B'.repeat(64),
        presentationProfileSha256: 'D'.repeat(64),
      },
    });
  });

  it('builds the current version command from normalized WinGet switches', async () => {
    getAppForInstallerMock.mockResolvedValue({
      latest_version: '8.1.4087.62',
      name: 'Vivaldi',
    });
    getVersionInstallerInfoMock.mockResolvedValue({
      installer_url: 'https://example.com/Vivaldi.8.1.4087.62.x64.exe',
      installer_sha256: 'A'.repeat(64),
      installer_type: 'exe',
      installer_scope: 'user',
      silent_args: '--vivaldi-silent --do-not-launch-chrome',
      installers: [{
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/Vivaldi.8.1.4087.62.x64.exe',
        InstallerSha256: 'A'.repeat(64),
        InstallerType: 'exe',
        Scope: 'user',
        InstallerSwitches: {
          Custom: '--do-not-launch-chrome',
        },
      }],
    });

    const result = await getLatestInstallerInfo({} as never, 'Vivaldi.Vivaldi', 'x64');

    expect(result).toMatchObject({
      installCommand: '"Vivaldi.8.1.4087.62.x64.exe" --vivaldi-silent --do-not-launch-chrome',
      silentSwitches: '--vivaldi-silent --do-not-launch-chrome',
      installScope: 'user',
    });
  });

  it('records a current QA failure as a safety skip before creating history or a job', async () => {
    const failedPackageResult = {
      winget_id: 'Test.App',
      display_name: 'Test App',
      publisher: 'Test',
      tested_version: '2.0.0',
      architecture: 'x64',
      outcome: 'Failed',
      installer_sha256: 'A'.repeat(64),
      tested_at_utc: '2026-08-07T12:00:00Z',
      overall_duration_seconds: 30,
      installer_type: 'zip',
      install_command: 'setup.exe /S',
      uninstall_command: 'setup.exe /uninstall',
      detection: { type: 'fileVersion', path: 'C:\\Test\\app.exe', minimumVersion: '2.0.0' },
      phase_results: {
        install: { exitCode: 0, durationSeconds: 1, timedOut: false },
        detectionAfterInstall: { exitCode: 0, durationSeconds: 1, timedOut: false },
        uninstall: { exitCode: 1605, durationSeconds: 1, timedOut: false },
        detectionAfterUninstall: null,
      },
      changes: null,
      relevant_event_count: 0,
      environment: null,
      effective_configuration: null,
      qa_schema_version: 1,
      synced_at: '2026-08-07T12:01:00Z',
      test_level: 'psadt-package',
      package_profile_sha256: 'B'.repeat(64),
      psadt_version: '4.1.8',
      psadt_template_sha256: 'C'.repeat(64),
      psadt_config_sha256: 'D'.repeat(64),
      detection_rules_sha256: 'E'.repeat(64),
      packager_commit: 'f'.repeat(40),
      package_content_sha256: 'F'.repeat(64),
    } satisfies QaResultRow;
    getQaResultMock.mockResolvedValue(failedPackageResult);
    ensureQaDemandMock.mockResolvedValue({
      state: 'failed',
      candidateId: null,
      failureSummary: 'The isolated installation test failed.',
      identity: {
        executionProfileSha256: 'B'.repeat(64),
        presentationProfileSha256: 'D'.repeat(64),
      },
    });

    const supabase = createSupabaseMock({});
    const trigger = makeTrigger(supabase);
    const policy = makePolicy({
      displayName: 'Test App',
      architecture: 'x64',
    });
    policy.original_upload_history_id = 'prior-upload';
    policy.consecutive_failures = 0;
    vi.spyOn(trigger as never, 'verifyTenantConsent' as never).mockResolvedValue(true as never);
    vi.spyOn(trigger as never, 'ensurePsadtConfig' as never).mockResolvedValue(undefined as never);
    const createHistorySpy = vi.spyOn(trigger as never, 'createHistoryRecord' as never);

    const result = await trigger.triggerAutoUpdate(policy, UPDATE_INFO, { skipRateLimits: true });

    expect(result).toMatchObject({
      success: false,
      skipped: true,
      code: 'QA_FAILED_CURRENT_VERSION',
    });
    expect(result.skipReason).toBe('The isolated installation test failed.');
    expect(createHistorySpy).not.toHaveBeenCalled();
    expect(ensureQaDemandMock).toHaveBeenCalledTimes(1);
  });

  it('applies the same app adapter to auto-update QA and customer packaging', async () => {
    const supabase = createSupabaseMock({});
    const trigger = makeTrigger(supabase);
    const storedConfig: DeploymentConfig = {
      displayName: 'Elgato Stream Deck',
      publisher: 'Elgato',
      architecture: 'x64',
      installerType: 'msi',
      installCommand: 'msiexec /i setup.msi /qn',
      uninstallCommand: 'msiexec /x {PRODUCT-CODE} /qn',
      installScope: 'machine',
      detectionRules: [],
      psadtConfig: { ...DEFAULT_PSADT_CONFIG, processesToClose: [] },
    };
    const policy = makePolicy(storedConfig);
    policy.original_upload_history_id = 'prior-upload';
    policy.consecutive_failures = 0;

    vi.spyOn(trigger as never, 'verifyTenantConsent' as never).mockResolvedValue(true as never);
    vi.spyOn(trigger as never, 'ensurePsadtConfig' as never).mockResolvedValue(undefined as never);
    vi.spyOn(trigger as never, 'ensureCurrentPackageDefaults' as never).mockResolvedValue(undefined as never);
    vi.spyOn(trigger as never, 'createHistoryRecord' as never)
      .mockResolvedValue({ id: 'history-elgato' } as never);
    const createPackagingJobSpy = vi.spyOn(trigger as never, 'createPackagingJob' as never)
      .mockResolvedValue({ id: 'job-elgato' } as never);
    vi.spyOn(trigger as never, 'updateHistoryRecord' as never).mockResolvedValue(undefined as never);
    vi.spyOn(trigger as never, 'updatePolicyTracking' as never).mockResolvedValue(undefined as never);

    const result = await trigger.triggerAutoUpdate(policy, {
      ...UPDATE_INFO,
      wingetId: 'elgato.streamdeck',
      displayName: 'Elgato Stream Deck',
      installerType: 'msi',
      nestedInstallerType: undefined,
      nestedInstallerPath: undefined,
    }, { skipRateLimits: true });

    expect(result).toMatchObject({ success: true, packagingJobId: 'job-elgato' });
    const qaInput = ensureQaDemandMock.mock.calls[0][1] as {
      psadtConfig: string;
    };
    expect(JSON.parse(qaInput.psadtConfig).processesToClose).toEqual([
      { name: 'StreamDeck', description: 'Elgato Stream Deck' },
    ]);
    const effectivePolicy = createPackagingJobSpy.mock.calls[0][0] as AppUpdatePolicy;
    expect(
      (effectivePolicy.deployment_config as DeploymentConfig).psadtConfig?.processesToClose
    ).toEqual([
      { name: 'StreamDeck', description: 'Elgato Stream Deck' },
    ]);
    expect(storedConfig.psadtConfig?.processesToClose).toEqual([]);
  });

  it('uses a reviewed user scope for both auto-update QA and the packaging job', async () => {
    const supabase = createSupabaseMock({});
    const trigger = makeTrigger(supabase);
    const storedConfig: DeploymentConfig = {
      displayName: 'Zalo',
      publisher: 'VNGCorp',
      architecture: 'x86',
      installerType: 'exe',
      installCommand: 'ZaloSetup.exe /S',
      uninstallCommand: 'REGISTRY_UNINSTALL:Zalo',
      installScope: 'machine',
      detectionRules: [],
      psadtConfig: DEFAULT_PSADT_CONFIG,
    };
    const policy = makePolicy(storedConfig);
    policy.original_upload_history_id = 'prior-upload';
    policy.consecutive_failures = 0;

    vi.spyOn(trigger as never, 'verifyTenantConsent' as never).mockResolvedValue(true as never);
    vi.spyOn(trigger as never, 'ensurePsadtConfig' as never).mockResolvedValue(undefined as never);
    vi.spyOn(trigger as never, 'ensureCurrentPackageDefaults' as never).mockResolvedValue(undefined as never);
    vi.spyOn(trigger as never, 'createHistoryRecord' as never)
      .mockResolvedValue({ id: 'history-zalo' } as never);
    const createPackagingJobSpy = vi.spyOn(trigger as never, 'createPackagingJob' as never)
      .mockResolvedValue({ id: 'job-zalo' } as never);
    vi.spyOn(trigger as never, 'updateHistoryRecord' as never).mockResolvedValue(undefined as never);
    vi.spyOn(trigger as never, 'updatePolicyTracking' as never).mockResolvedValue(undefined as never);

    const result = await trigger.triggerAutoUpdate(policy, {
      ...UPDATE_INFO,
      wingetId: 'VNGCorp.Zalo',
      displayName: 'Zalo',
      installerType: 'exe',
      installScope: 'machine',
    }, { skipRateLimits: true });

    expect(result).toMatchObject({ success: true, packagingJobId: 'job-zalo' });
    expect(ensureQaDemandMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ installScope: 'user' })
    );
    const effectivePolicy = createPackagingJobSpy.mock.calls[0][0] as AppUpdatePolicy;
    expect((effectivePolicy.deployment_config as DeploymentConfig).installScope).toBe('user');
    const effectiveUpdate = createPackagingJobSpy.mock.calls[0][1] as { installScope?: string };
    expect(effectiveUpdate.installScope).toBe('user');
    expect(storedConfig.installScope).toBe('machine');
  });

  describe('ensurePsadtConfig', () => {
    it('backfills psadtConfig from the most recent packaging job and persists it', async () => {
      const updateSpy = vi.fn();
      const supabase = createSupabaseMock({
        upload_history: {
          maybeSingleResult: { data: { packaging_job_id: 'job-1' }, error: null },
        },
        packaging_jobs: {
          maybeSingleResult: {
            data: { package_config: { psadtConfig: PSADT_CONFIG, assignments: [] } },
            error: null,
          },
        },
        app_update_policies: { updateSpy },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({ displayName: 'Test App' });

      await (trigger as unknown as {
        ensurePsadtConfig: (p: AppUpdatePolicy) => Promise<void>;
      }).ensurePsadtConfig(policy);

      const config = policy.deployment_config as DeploymentConfig;
      expect(config.psadtConfig).toEqual(PSADT_CONFIG);
      expect(updateSpy).toHaveBeenCalledWith({ deployment_config: policy.deployment_config });
    });

    it('does nothing when the policy already carries psadtConfig', async () => {
      const supabase = createSupabaseMock({});
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({
        displayName: 'Test App',
        psadtConfig: PSADT_CONFIG,
      } as Partial<DeploymentConfig>);

      await (trigger as unknown as {
        ensurePsadtConfig: (p: AppUpdatePolicy) => Promise<void>;
      }).ensurePsadtConfig(policy);

      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('leaves the policy untouched when no prior packaging job exists', async () => {
      const updateSpy = vi.fn();
      const supabase = createSupabaseMock({
        upload_history: { maybeSingleResult: { data: null, error: null } },
        app_update_policies: { updateSpy },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({ displayName: 'Test App' });

      await (trigger as unknown as {
        ensurePsadtConfig: (p: AppUpdatePolicy) => Promise<void>;
      }).ensurePsadtConfig(policy);

      expect((policy.deployment_config as DeploymentConfig).psadtConfig).toBeUndefined();
      expect(updateSpy).not.toHaveBeenCalled();
    });
  });

  describe('ensureCurrentPackageDefaults', () => {
    it('persists corrected legacy MSI defaults before QA and packaging', async () => {
      const updateSpy = vi.fn();
      const supabase = createSupabaseMock({
        app_update_policies: { updateSpy },
      });
      const trigger = makeTrigger(supabase);
      const legacyRule = {
        type: 'file' as const,
        path: '%ProgramFiles%',
        fileOrFolderName: 'Zoom VDI Workplace',
        detectionType: 'exists' as const,
        check32BitOn64System: false,
      };
      const policy = makePolicy({
        displayName: 'Zoom VDI Workplace',
        publisher: 'Zoom',
        architecture: 'x64',
        installerType: 'msi',
        installCommand: 'msiexec /i "ZoomInstallerVDI.msi" /qn',
        uninstallCommand: 'msiexec /x {PRODUCT_CODE} /qn /norestart',
        installScope: 'machine',
        detectionRules: [legacyRule],
        psadtConfig: {
          ...DEFAULT_PSADT_CONFIG,
          deployMode: 'Silent',
          verifyInstall: true,
          removeExistingInstall: true,
          registryMarkerPath: 'SOFTWARE\\Contoso\\Apps',
          installCommand: 'msiexec /i "setup.msi" /qn',
          detectionRules: [legacyRule],
        },
      });

      await (trigger as unknown as {
        ensureCurrentPackageDefaults: (
          p: AppUpdatePolicy,
          u: Parameters<AutoUpdateTrigger['triggerAutoUpdate']>[1]
        ) => Promise<void>;
      }).ensureCurrentPackageDefaults(policy, {
        ...UPDATE_INFO,
        wingetId: 'Zoom.Zoom.VDI',
        latestVersion: '7.0.27050',
        displayName: 'Zoom VDI Workplace',
        installerUrl: 'https://zoom.example/ZoomInstallerVDI.msi',
        installerSha256: 'A'.repeat(64),
        installerType: 'msi',
        installScope: 'machine',
        nestedInstallerType: undefined,
        nestedInstallerPath: undefined,
      });

      const config = policy.deployment_config as DeploymentConfig;
      expect(config.uninstallCommand).toBe('REGISTRY_UNINSTALL:Zoom VDI Workplace');
      expect(config.detectionRules[0]).toMatchObject({
        type: 'registry',
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Apps\\Zoom_Zoom_VDI',
        detectionValue: '7.0.27050',
      });
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
        deployment_config: config,
        updated_at: expect.any(String),
      }));
    });

    it('persists the corrected profile before looking up QA demand', async () => {
      const updateSpy = vi.fn();
      const supabase = createSupabaseMock({
        app_update_policies: { updateSpy },
      });
      const trigger = makeTrigger(supabase);
      const legacyRule = {
        type: 'file' as const,
        path: '%ProgramFiles%',
        fileOrFolderName: 'Zoom VDI Workplace',
        detectionType: 'exists' as const,
        check32BitOn64System: false,
      };
      const policy = makePolicy({
        displayName: 'Zoom VDI Workplace',
        publisher: 'Zoom',
        architecture: 'x64',
        installerType: 'msi',
        installCommand: 'msiexec /i "ZoomInstallerVDI.msi" /qn',
        uninstallCommand: 'msiexec /x {PRODUCT_CODE} /qn /norestart',
        installScope: 'machine',
        detectionRules: [legacyRule],
        psadtConfig: {
          ...DEFAULT_PSADT_CONFIG,
          detectionRules: [legacyRule],
        },
      });
      policy.original_upload_history_id = 'prior-upload';
      policy.consecutive_failures = 0;
      vi.spyOn(trigger as never, 'verifyTenantConsent' as never).mockResolvedValue(true as never);
      vi.spyOn(trigger as never, 'ensurePsadtConfig' as never).mockResolvedValue(undefined as never);

      await trigger.triggerAutoUpdate(policy, {
        ...UPDATE_INFO,
        wingetId: 'Zoom.Zoom.VDI',
        latestVersion: '7.0.27050',
        displayName: 'Zoom VDI Workplace',
        installerUrl: 'https://zoom.example/ZoomInstallerVDI.msi',
        installerSha256: 'A'.repeat(64),
        installerType: 'msi',
        installScope: 'machine',
      }, { skipRateLimits: true });

      expect(updateSpy).toHaveBeenCalled();
      expect(ensureQaDemandMock).toHaveBeenCalledTimes(1);
      expect(updateSpy.mock.invocationCallOrder[0]).toBeLessThan(
        ensureQaDemandMock.mock.invocationCallOrder[0]
      );
    });

    it('does not mutate the in-memory policy when persistence fails', async () => {
      const supabase = createSupabaseMock({
        app_update_policies: {
          terminalError: { message: 'database unavailable' },
        },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({
        ...zoomConfigForTrigger(),
      });
      const originalConfig = policy.deployment_config;

      await expect((trigger as unknown as {
        ensureCurrentPackageDefaults: (
          p: AppUpdatePolicy,
          u: Parameters<AutoUpdateTrigger['triggerAutoUpdate']>[1]
        ) => Promise<void>;
      }).ensureCurrentPackageDefaults(policy, {
        ...UPDATE_INFO,
        wingetId: 'Zoom.Zoom.VDI',
        latestVersion: '7.0.27050',
        displayName: 'Zoom VDI Workplace',
        installerUrl: 'https://zoom.example/ZoomInstallerVDI.msi',
        installerSha256: 'A'.repeat(64),
        installerType: 'msi',
        installScope: 'machine',
      })).rejects.toThrow('Could not persist corrected package defaults');

      expect(policy.deployment_config).toBe(originalConfig);
    });
  });

  describe('createPackagingJob', () => {
    it('stores psadtConfig and nested installer info on the new job package_config', async () => {
      const insertSpy = vi.fn();
      const supabase = createSupabaseMock({
        user_profiles: { singleResult: { data: { email: 'user@example.com' }, error: null } },
        user_settings: { maybeSingleResult: { data: null, error: null } },
        packaging_jobs: {
          insertSpy,
          singleResult: { data: { id: 'job-2' }, error: null },
        },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({
        displayName: 'Test App',
        publisher: 'Test Publisher',
        architecture: 'x64',
        installerType: 'zip',
        installCommand: 'setup.exe /S',
        uninstallCommand: '',
        installScope: 'machine',
        detectionRules: [],
        psadtConfig: PSADT_CONFIG,
      } as Partial<DeploymentConfig>);

      const result = await (trigger as unknown as {
        createPackagingJob: (
          p: AppUpdatePolicy,
          u: typeof UPDATE_INFO,
          h: string
        ) => Promise<{ id: string }>;
      }).createPackagingJob(policy, UPDATE_INFO, 'history-1');

      expect(result.id).toBe('job-2');
      expect(insertSpy).toHaveBeenCalledTimes(1);
      const jobData = insertSpy.mock.calls[0][0] as {
        install_command: string;
        install_scope: string;
        package_config: Record<string, unknown>;
      };
      expect(jobData.install_command).toBe('"setup-2.0.0.exe" --current-version-silent');
      expect(jobData.install_scope).toBe('user');
      expect(jobData.package_config.psadtConfig).toEqual(PSADT_CONFIG);
      expect(jobData.package_config.nestedInstallerType).toBe('exe');
      expect(jobData.package_config.nestedInstallerPath).toBe('setup-2.0.0.exe');
    });

    it('persists relationships and auto-supersedence info on the new job package_config', async () => {
      const relationships = [
        {
          relationshipType: 'dependency' as const,
          targetId: 'dep-app-1',
          targetDisplayName: 'Dependency App',
          dependencyType: 'autoInstall' as const,
        },
      ];
      const insertSpy = vi.fn();
      const supabase = createSupabaseMock({
        user_profiles: { singleResult: { data: { email: 'user@example.com' }, error: null } },
        user_settings: {
          maybeSingleResult: {
            data: { settings: { supersedePreviousApp: true } },
            error: null,
          },
        },
        packaging_jobs: {
          insertSpy,
          singleResult: { data: { id: 'job-3' }, error: null },
        },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({
        displayName: 'Test App',
        publisher: 'Test Publisher',
        architecture: 'x64',
        installerType: 'zip',
        installCommand: 'setup.exe /S',
        uninstallCommand: '',
        installScope: 'machine',
        detectionRules: [],
        relationships,
      } as Partial<DeploymentConfig>);

      await (trigger as unknown as {
        createPackagingJob: (
          p: AppUpdatePolicy,
          u: typeof UPDATE_INFO & { currentIntuneAppId?: string },
          h: string
        ) => Promise<{ id: string }>;
      }).createPackagingJob(
        policy,
        { ...UPDATE_INFO, currentIntuneAppId: 'prev-app-1' },
        'history-1'
      );

      expect(insertSpy).toHaveBeenCalledTimes(1);
      const jobData = insertSpy.mock.calls[0][0] as {
        package_config: Record<string, unknown>;
      };
      expect(jobData.package_config.relationships).toEqual(relationships);
      expect(jobData.package_config.autoSupersede).toBe(true);
      expect(jobData.package_config.sourceIntuneAppId).toBe('prev-app-1');
      expect(jobData.package_config.supersedenceType).toBe('update');
    });

    it('does not flag auto-supersedence when the user setting is off', async () => {
      const insertSpy = vi.fn();
      const supabase = createSupabaseMock({
        user_profiles: { singleResult: { data: { email: 'user@example.com' }, error: null } },
        user_settings: { maybeSingleResult: { data: null, error: null } },
        packaging_jobs: {
          insertSpy,
          singleResult: { data: { id: 'job-4' }, error: null },
        },
      });
      const trigger = makeTrigger(supabase);
      const policy = makePolicy({
        displayName: 'Test App',
        publisher: 'Test Publisher',
        architecture: 'x64',
        installerType: 'zip',
        installCommand: 'setup.exe /S',
        uninstallCommand: '',
        installScope: 'machine',
        detectionRules: [],
      } as Partial<DeploymentConfig>);

      await (trigger as unknown as {
        createPackagingJob: (
          p: AppUpdatePolicy,
          u: typeof UPDATE_INFO & { currentIntuneAppId?: string },
          h: string
        ) => Promise<{ id: string }>;
      }).createPackagingJob(
        policy,
        { ...UPDATE_INFO, currentIntuneAppId: 'prev-app-1' },
        'history-1'
      );

      expect(insertSpy).toHaveBeenCalledTimes(1);
      const jobData = insertSpy.mock.calls[0][0] as {
        package_config: Record<string, unknown>;
      };
      expect(jobData.package_config.autoSupersede).toBe(false);
      expect(jobData.package_config.supersedenceType).toBeUndefined();
    });
  });
});
