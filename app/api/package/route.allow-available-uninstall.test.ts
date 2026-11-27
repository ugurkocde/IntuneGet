import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { triggerPackagingWorkflow, type GitHubActionsConfig, type WorkflowInputs } from '@/lib/github-actions';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

const mocks = vi.hoisted(() => ({
  parseAccessToken: vi.fn(),
  localPackager: false,
  enforceInstallerPreflight: vi.fn(),
  enforceQaGate: vi.fn(),
  resolveDependencies: vi.fn().mockResolvedValue([]),
  getDatabase: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({ parseAccessToken: mocks.parseAccessToken }));
vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: async () => ({ tenantId: 'tenant-1', errorResponse: null }),
}));
vi.mock('@/lib/msp/consent-cache', () => ({ checkStoredConsent: async () => true }));
vi.mock('@/lib/msp/consent-verification', () => ({ verifyTenantConsent: async () => ({ valid: true }) }));
vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: mocks.localPackager }) }));
vi.mock('@/lib/installer-preflight', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/installer-preflight')>();
  return { ...actual, enforceInstallerPreflight: mocks.enforceInstallerPreflight };
});
vi.mock('@/lib/qa/gate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/qa/gate')>();
  return { ...actual, enforceQaGate: mocks.enforceQaGate };
});
vi.mock('@/lib/winget-dependencies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/winget-dependencies')>();
  return { ...actual, resolveWingetPackageDependencies: mocks.resolveDependencies };
});
vi.mock('@/lib/db', () => ({ getDatabase: mocks.getDatabase, isSqliteMode: () => false }));
vi.mock('@/lib/supabase', () => ({
  createServerClient: mocks.createServerClient,
  isSupabaseServerConfigured: () => true,
  getServerClientOrNull: () => null,
}));

import { POST as packagePost } from './route';
import { POST as updatePolicyPost } from '@/app/api/update-policies/route';
import { PATCH as updatePolicyPatch } from '@/app/api/update-policies/[id]/route';
import { buildStoredJobWorkflowInputs } from '@/lib/auto-update/stored-job-workflow-inputs';

const ghConfig: GitHubActionsConfig = {
  token: 'test-token',
  owner: 'example',
  repo: 'public-repo',
  workflowsRepo: 'workflow-repo',
  workflowFile: 'package-intunewin.yml',
  ref: 'main',
};

function baseWorkflowInputs(overrides: Partial<WorkflowInputs> = {}): WorkflowInputs {
  return {
    jobId: '4a4f09e2-cc56-4ad2-a264-38b8f91e79c7',
    tenantId: '11111111-1111-4111-8111-111111111111',
    wingetId: 'Custom.Example.App',
    displayName: 'Example App',
    publisher: 'Example',
    version: '1.0.0',
    architecture: 'x64',
    installerUrl: 'https://example.com/setup.exe',
    installerSha256: '',
    installerType: 'exe',
    silentSwitches: '/S',
    uninstallCommand: 'uninstall.exe /S',
    callbackUrl: 'https://example.test/api/package/callback',
    hashValidationMode: 'calculate',
    sourceType: 'custom',
    ...overrides,
  };
}

function makeWin32Item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    addedAt: '2026-11-27T00:00:00Z',
    appSource: 'win32',
    wingetId: 'Contoso.App',
    displayName: 'Contoso App',
    publisher: 'Contoso',
    version: '1.0.0',
    architecture: 'x64',
    installScope: 'machine',
    installerType: 'exe',
    installerUrl: 'https://example.test/setup.exe',
    installerSha256: 'a'.repeat(64),
    installCommand: '/S',
    uninstallCommand: '/U',
    detectionRules: [],
    psadtConfig: { ...DEFAULT_PSADT_CONFIG },
    ...overrides,
  };
}

describe('POST /api/package, update-policies, and GitHub Actions dispatch for allowAvailableUninstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseAccessToken.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1' });
    mocks.localPackager = false;
    delete process.env.HOSTED_ALLOW_AVAILABLE_UNINSTALL_ENABLED;
    delete process.env.NEXT_PUBLIC_HOSTED_ALLOW_AVAILABLE_UNINSTALL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects non-boolean allowAvailableUninstall, Store items, sameApp items, and disabled hosted create on POST /api/package', async () => {
    const post = (item: Record<string, unknown>) =>
      packagePost(
        new NextRequest('https://fixture.invalid/api/package', {
          method: 'POST',
          headers: { Authorization: 'Bearer fixture' },
          body: JSON.stringify({ items: [item] }),
        })
      );

    expect((await post(makeWin32Item({ allowAvailableUninstall: 'true' }))).status).toBe(400);
    expect((await post({
      id: 'store-1',
      addedAt: '2026-11-27T00:00:00Z',
      appSource: 'store',
      wingetId: '9WZDNCRFJ3PZ',
      packageIdentifier: '9WZDNCRFJ3PZ',
      displayName: 'Store App',
      publisher: 'Contoso',
      version: '1.0.0',
      installExperience: 'user',
      allowAvailableUninstall: true,
    })).status).toBe(400);
    expect((await post(makeWin32Item({
      updateMode: 'sameApp',
      targetIntuneAppId: '11111111-1111-4111-8111-111111111111',
      allowAvailableUninstall: true,
    }))).status).toBe(400);
    expect((await post(makeWin32Item({ allowAvailableUninstall: true }))).status).toBe(400);
  });

  it('rejects non-boolean deployment_config.allowAvailableUninstall on POST /api/update-policies and PATCH /api/update-policies/[id]', async () => {
    const postRes = await updatePolicyPost(
      new NextRequest('https://fixture.invalid/api/update-policies', {
        method: 'POST',
        headers: { Authorization: 'Bearer fixture' },
        body: JSON.stringify({
          winget_id: 'Contoso.App',
          tenant_id: 'tenant-1',
          policy_type: 'auto_update',
          deployment_config: { allowAvailableUninstall: 'yes' },
        }),
      })
    );
    expect(postRes.status).toBe(400);

    const patchRes = await updatePolicyPatch(
      new NextRequest('https://fixture.invalid/api/update-policies/pol-1', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer fixture' },
        body: JSON.stringify({
          deployment_config: { allowAvailableUninstall: 1 },
        }),
      }),
      { params: Promise.resolve({ id: 'pol-1' }) }
    );
    expect(patchRes.status).toBe(400);
  });

  it('emits client_payload.config.allowAvailableUninstall only when hosted flag is enabled, boolean, and not sameApp', async () => {
    const payloads: Array<Record<string, unknown>> = [];
    const identities: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        payloads.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      })
    );

    const prevFlag = process.env.HOSTED_ALLOW_AVAILABLE_UNINSTALL_ENABLED;
    try {
      // Phase 1 (flag disabled): fail closed on true; omit false (Intune default)
      delete process.env.HOSTED_ALLOW_AVAILABLE_UNINSTALL_ENABLED;
      await expect(
        triggerPackagingWorkflow(baseWorkflowInputs({ allowAvailableUninstall: true }), ghConfig, {
          skipRunCapture: true,
        })
      ).rejects.toThrow(/allow available uninstall/i);
      expect(payloads).toHaveLength(0);
      await triggerPackagingWorkflow(baseWorkflowInputs({ allowAvailableUninstall: false }), ghConfig, {
        skipRunCapture: true,
      });
      const cfgFlagOff = (payloads[0].client_payload as { config: Record<string, unknown> }).config;
      expect('allowAvailableUninstall' in cfgFlagOff).toBe(false);

      // Phase 2 (flag enabled): emitted for boolean create, omitted for undefined and sameApp
      process.env.HOSTED_ALLOW_AVAILABLE_UNINSTALL_ENABLED = 'true';
      await triggerPackagingWorkflow(baseWorkflowInputs(), ghConfig, {
        skipRunCapture: true,
        beforeDispatch: async (id) => { identities.push(id); },
      });
      await triggerPackagingWorkflow(baseWorkflowInputs({ allowAvailableUninstall: true }), ghConfig, {
        skipRunCapture: true,
        beforeDispatch: async (id) => { identities.push(id); },
      });
      await triggerPackagingWorkflow(baseWorkflowInputs({ allowAvailableUninstall: false }), ghConfig, {
        skipRunCapture: true,
        beforeDispatch: async (id) => { identities.push(id); },
      });

      const cfg0 = (payloads[1].client_payload as { config: Record<string, unknown> }).config;
      const cfg1 = (payloads[2].client_payload as { config: Record<string, unknown> }).config;
      const cfg2 = (payloads[3].client_payload as { config: Record<string, unknown> }).config;

      expect('allowAvailableUninstall' in cfg0).toBe(false);
      expect(cfg1.allowAvailableUninstall).toBe('true');
      expect(cfg2.allowAvailableUninstall).toBe('false');
      expect(new Set(identities).size).toBe(3);

      // sameApp stored jobs always omit allowAvailableUninstall
      const sameAppItem = {
        ...makeWin32Item({
          updateMode: 'sameApp',
          targetIntuneAppId: '11111111-1111-4111-8111-111111111111',
          allowAvailableUninstall: true,
        }),
      };
      const sameAppInputs = buildStoredJobWorkflowInputs(
        {
          id: 'job-same',
          tenant_id: 'tenant-1',
          winget_id: 'Contoso.App',
          display_name: 'Contoso App',
          publisher: 'Contoso',
          version: '2.0.0',
          architecture: 'x64',
          installer_url: 'https://example.test/setup.exe',
          installer_sha256: 'a'.repeat(64),
          installer_type: 'exe',
          install_command: 'setup.exe /S',
          uninstall_command: 'uninstall.exe /S',
          install_scope: 'machine',
          is_auto_update: false,
          package_config: sameAppItem,
        } as never,
        sameAppItem as never,
        { callbackUrl: 'https://example.test/cb', qaOverride: false, sanitizeAssignments: false }
      );
      expect(sameAppInputs.allowAvailableUninstall).toBeUndefined();
    } finally {
      if (prevFlag === undefined) delete process.env.HOSTED_ALLOW_AVAILABLE_UNINSTALL_ENABLED;
      else process.env.HOSTED_ALLOW_AVAILABLE_UNINSTALL_ENABLED = prevFlag;
    }
  });
});
