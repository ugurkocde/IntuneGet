import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWin32App } from '@/lib/intune-api';
import * as intuneApi from '@/lib/intune-api';
import * as buildDeploymentConfig from '@/lib/update-policies/build-deployment-config';
import { buildStoredJobWorkflowInputs } from '@/lib/auto-update/stored-job-workflow-inputs';
import { normalizeQaWorkflowPackageInput } from '@/lib/qa/package-profile';
import type { Database } from '@/types/database';
import type { Win32CartItem } from '@/types/upload';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

type StoredJob = Database['public']['Tables']['packaging_jobs']['Row'];

function baseJob(packageConfig: Record<string, unknown>): StoredJob {
  return {
    id: 'job-2145',
    user_id: 'user-1',
    user_email: 'admin@contoso.test',
    tenant_id: 'tenant-1',
    winget_id: 'Contoso.App',
    display_name: 'Contoso App',
    publisher: 'Contoso',
    version: '2.0.0',
    architecture: 'x64',
    installer_type: 'exe',
    installer_url: 'https://example.test/app.exe',
    installer_sha256: 'a'.repeat(64),
    install_command: 'app.exe /S',
    uninstall_command: 'uninstall.exe /S',
    install_scope: 'machine',
    detection_rules: [],
    package_config: packageConfig,
    status: 'queued',
    status_message: null,
    error_message: null,
    error_code: null,
    error_details: null,
    progress_percent: 0,
    github_run_id: null,
    github_run_url: null,
    callback_run_id: null,
    intune_app_id: null,
    intune_app_url: null,
    is_auto_update: false,
    auto_update_policy_id: null,
    execution_profile_sha256: null,
    presentation_profile_sha256: null,
    qa_candidate_id: null,
    qa_requested_at: null,
    qa_completed_at: null,
    archived_at: null,
    cancelled_at: null,
    completed_at: null,
    created_at: '2026-11-27T00:00:00.000Z',
    updated_at: '2026-11-27T00:00:00.000Z',
  } as unknown as StoredJob;
}

function baseCartItem(overrides: Partial<Win32CartItem> = {}): Win32CartItem {
  return {
    id: 'item-1',
    addedAt: '2026-11-27T00:00:00.000Z',
    appSource: 'win32',
    wingetId: 'Contoso.App',
    displayName: 'Contoso App',
    publisher: 'Contoso',
    version: '2.0.0',
    architecture: 'x64',
    installScope: 'machine',
    installerType: 'exe',
    installerUrl: 'https://example.test/app.exe',
    installerSha256: 'a'.repeat(64),
    installCommand: 'app.exe /S',
    uninstallCommand: 'uninstall.exe /S',
    detectionRules: [],
    psadtConfig: { ...DEFAULT_PSADT_CONFIG },
    ...overrides,
  };
}

describe('allowAvailableUninstall core Graph, deployment config, workflow inputs, and QA profile invariants', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('createWin32App omits allowAvailableUninstall when undefined and sends exact boolean when set', async () => {
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ id: 'app-id-1' }), { status: 201 })
    );
    vi.stubGlobal('fetch', fetchMock);

    await createWin32App('tok', {
      displayName: 'App',
      fileName: 'app.intunewin',
      installCommandLine: 'install.exe',
      uninstallCommandLine: 'uninstall.exe',
    });
    const omittedBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect('allowAvailableUninstall' in omittedBody).toBe(false);

    await createWin32App('tok', {
      displayName: 'App',
      fileName: 'app.intunewin',
      installCommandLine: 'install.exe',
      uninstallCommandLine: 'uninstall.exe',
      allowAvailableUninstall: true,
    } as Record<string, unknown>);
    const trueBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(trueBody.allowAvailableUninstall).toBe(true);

    await createWin32App('tok', {
      displayName: 'App',
      fileName: 'app.intunewin',
      installCommandLine: 'install.exe',
      uninstallCommandLine: 'uninstall.exe',
      allowAvailableUninstall: false,
    } as Record<string, unknown>);
    const falseBody = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(falseBody.allowAvailableUninstall).toBe(false);
  });

  it('updateWin32AllowAvailableUninstall sends minimal win32LobApp PATCH and readWin32AllowAvailableUninstall classifies responses', async () => {
    const api = intuneApi as Record<string, unknown>;
    expect(typeof api.updateWin32AllowAvailableUninstall).toBe('function');
    expect(typeof api.readWin32AllowAvailableUninstall).toBe('function');

    const updateFn = api.updateWin32AllowAvailableUninstall as (t: string, id: string, v: boolean) => Promise<void>;
    const readFn = api.readWin32AllowAvailableUninstall as (t: string, id: string) => Promise<Record<string, unknown>>;

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ '@odata.type': '#microsoft.graph.win32LobApp', allowAvailableUninstall: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ '@odata.type': '#microsoft.graph.win32LobApp' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ '@odata.type': '#microsoft.graph.winGetApp', allowAvailableUninstall: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    await updateFn('tok', '11111111-1111-4111-8111-111111111111', true);
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      '@odata.type': '#microsoft.graph.win32LobApp',
      allowAvailableUninstall: true,
    });

    expect(await readFn('tok', '11111111-1111-4111-8111-111111111111')).toEqual({ status: 'hit', value: true });
    expect(await readFn('tok', '11111111-1111-4111-8111-111111111111')).toEqual({ status: 'field_missing' });
    expect(await readFn('tok', '11111111-1111-4111-8111-111111111111')).toEqual({ status: 'not_found' });
    expect(await readFn('tok', '11111111-1111-4111-8111-111111111111')).toEqual({ status: 'not_found' });
    await expect(readFn('tok', '11111111-1111-4111-8111-111111111111')).rejects.toThrow();
  });

  it('parseAllowAvailableUninstall only accepts booleans and buildStoredJobWorkflowInputs forwards only on non-sameApp', () => {
    const mod = buildDeploymentConfig as Record<string, unknown>;
    expect(typeof mod.parseAllowAvailableUninstall).toBe('function');
    const parse = mod.parseAllowAvailableUninstall as (c: unknown) => boolean | undefined;

    expect(parse({ allowAvailableUninstall: true })).toBe(true);
    expect(parse({ allowAvailableUninstall: false })).toBe(false);
    expect(parse({ allowAvailableUninstall: true, allowAvailableUninstallSource: 'explicit_settings_patch' })).toBe(true);
    expect(parse({ allowAvailableUninstall: false, allowAvailableUninstallSource: 'inherited_graph' })).toBeUndefined();
    expect(parse({ allowAvailableUninstall: false, allowAvailableUninstallSource: 'default_graph_field_missing' })).toBeUndefined();
    expect(parse({ allowAvailableUninstall: 'true' })).toBeUndefined();
    expect(parse({ allowAvailableUninstall: 1 })).toBeUndefined();
    expect(parse({})).toBeUndefined();

    const itemTrue = baseCartItem({ allowAvailableUninstall: true } as Partial<Win32CartItem>);
    const wfTrue = buildStoredJobWorkflowInputs(baseJob(itemTrue as unknown as Record<string, unknown>), itemTrue, {
      callbackUrl: 'https://example.test/cb',
      qaOverride: false,
      sanitizeAssignments: false,
    }) as unknown as Record<string, unknown>;
    expect(wfTrue.allowAvailableUninstall).toBe(true);

    const sameAppItem = baseCartItem({
      updateMode: 'sameApp',
      targetIntuneAppId: '11111111-1111-4111-8111-111111111111',
      allowAvailableUninstall: true,
    } as Partial<Win32CartItem>);
    const wfSame = buildStoredJobWorkflowInputs(baseJob(sameAppItem as unknown as Record<string, unknown>), sameAppItem, {
      callbackUrl: 'https://example.test/cb',
      qaOverride: false,
      sanitizeAssignments: false,
    }) as unknown as Record<string, unknown>;
    expect(wfSame.allowAvailableUninstall).toBeUndefined();
  });

  it('QA executionProfileSha256 stays invariant when allowAvailableUninstall changes', () => {
    const common = {
      jobId: 'job-1',
      tenantId: 'tenant-1',
      wingetId: 'Contoso.App',
      displayName: 'Contoso App',
      publisher: 'Contoso',
      version: '2.0.0',
      architecture: 'x64',
      installerUrl: 'https://example.test/app.exe',
      installerSha256: 'a'.repeat(64),
      installerType: 'exe',
      silentSwitches: '/S',
      uninstallCommand: 'uninstall.exe /S',
      callbackUrl: 'https://example.test/cb',
      psadtConfig: JSON.stringify(DEFAULT_PSADT_CONFIG),
      detectionRules: '[]',
      installScope: 'machine' as const,
      packageDependencies: [],
    };
    const pUndef = normalizeQaWorkflowPackageInput(common);
    const pTrue = normalizeQaWorkflowPackageInput({ ...common, allowAvailableUninstall: true } as never);
    const pFalse = normalizeQaWorkflowPackageInput({ ...common, allowAvailableUninstall: false } as never);
    expect(pTrue.identity.executionProfileSha256).toBe(pUndef.identity.executionProfileSha256);
    expect(pFalse.identity.executionProfileSha256).toBe(pUndef.identity.executionProfileSha256);
  });
});
