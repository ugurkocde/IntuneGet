import { NextRequest } from 'next/server';
import { STALE_JOB_TIMEOUT_MINUTES, STALE_JOB_ERROR_MESSAGE } from '@/lib/stale-jobs';
import type { PackagingJob } from '@/lib/db/types';

const {
  getDatabaseMock,
  getByUserIdMock,
  getByIdMock,
  updateMock,
  createMock,
  parseAccessTokenMock,
  checkStoredConsentMock,
  verifyTenantConsentMock,
  isGitHubActionsConfiguredMock,
  triggerPackagingWorkflowMock,
  getAppConfigMock,
  getFeatureFlagsMock,
  enforceInstallerPreflightMock,
  getLiveInstallersMock,
  ensureQaDemandMock,
  getPackageEligibilityBlocksMock,
  isSupabaseServerConfiguredMock,
} = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  getByUserIdMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  createMock: vi.fn(),
  parseAccessTokenMock: vi.fn(),
  checkStoredConsentMock: vi.fn(),
  verifyTenantConsentMock: vi.fn(),
  isGitHubActionsConfiguredMock: vi.fn(),
  triggerPackagingWorkflowMock: vi.fn(),
  getAppConfigMock: vi.fn(),
  getFeatureFlagsMock: vi.fn(),
  enforceInstallerPreflightMock: vi.fn(),
  getLiveInstallersMock: vi.fn(),
  ensureQaDemandMock: vi.fn(),
  getPackageEligibilityBlocksMock: vi.fn(),
  isSupabaseServerConfiguredMock: vi.fn(),
}));

vi.mock('@/lib/manifest-api', () => ({
  getLiveInstallers: getLiveInstallersMock,
}));

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/msp/consent-cache', () => ({
  checkStoredConsent: checkStoredConsentMock,
}));

vi.mock('@/lib/msp/consent-verification', () => ({
  verifyTenantConsent: verifyTenantConsentMock,
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

vi.mock('@/lib/installer-preflight', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/installer-preflight')>();
  return {
    ...original,
    enforceInstallerPreflight: enforceInstallerPreflightMock,
  };
});

vi.mock('@/lib/qa/demand', () => ({ ensureQaDemand: ensureQaDemandMock }));

vi.mock('@/lib/package-eligibility', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/package-eligibility')>();
  return {
    ...original,
    getPackageEligibilityBlocks: getPackageEligibilityBlocksMock,
  };
});

vi.mock('@/lib/supabase', () => ({
  createServerClient: vi.fn(),
  isSupabaseServerConfigured: isSupabaseServerConfiguredMock,
}));

vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: vi.fn(async ({ tokenTenantId }: { tokenTenantId: string }) => ({
    tenantId: tokenTenantId,
    errorResponse: null,
  })),
}));

vi.mock('@/lib/graph-token', () => ({
  acquireGraphToken: vi.fn(),
}));

vi.mock('@/lib/store-app-deploy', () => ({
  deployStoreApp: vi.fn(),
}));

import { GET, POST } from '@/app/api/package/route';
import { InstallerPreflightError } from '@/lib/installer-preflight';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

function makeJob(overrides: Partial<PackagingJob>): PackagingJob {
  const now = new Date().toISOString();
  return {
    id: 'job-1',
    user_id: 'user-1',
    winget_id: 'Test.App',
    version: '1.0.0',
    display_name: 'Test App',
    publisher: 'Test',
    status: 'queued',
    progress_percent: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as PackagingJob;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

describe('GET /api/package (userId listing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The list path now authenticates and uses the token's userId.
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      userEmail: 'user@example.com',
      userName: 'User One',
    });
    getDatabaseMock.mockReturnValue({
      jobs: {
        getByUserId: getByUserIdMock,
        getById: getByIdMock,
        update: updateMock,
      },
    });
    updateMock.mockImplementation(async (id: string, data: Partial<PackagingJob>) =>
      makeJob({ id, ...data })
    );
  });

  it('marks stale intermediate jobs as failed and returns the corrected status', async () => {
    const staleJob = makeJob({
      id: 'job-stale',
      status: 'packaging',
      updated_at: minutesAgo(STALE_JOB_TIMEOUT_MINUTES + 5),
    });
    getByUserIdMock.mockResolvedValue([staleJob]);

    const request = new NextRequest('http://localhost:3000/api/package?userId=user-1');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith('job-stale', {
      status: 'failed',
      error_message: STALE_JOB_ERROR_MESSAGE,
      completed_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].status).toBe('failed');
    expect(body.jobs[0].error_message).toBe(STALE_JOB_ERROR_MESSAGE);
    expect(body.jobs[0].completed_at).toEqual(expect.any(String));
  });

  it('leaves fresh intermediate jobs untouched', async () => {
    const freshJob = makeJob({
      id: 'job-fresh',
      status: 'uploading',
      updated_at: minutesAgo(5),
    });
    getByUserIdMock.mockResolvedValue([freshJob]);

    const request = new NextRequest('http://localhost:3000/api/package?userId=user-1');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
    expect(body.jobs[0].status).toBe('uploading');
  });

  it('does not touch terminal jobs regardless of age', async () => {
    const oldFailedJob = makeJob({
      id: 'job-done',
      status: 'deployed',
      updated_at: minutesAgo(60 * 24),
    });
    getByUserIdMock.mockResolvedValue([oldFailedJob]);

    const request = new NextRequest('http://localhost:3000/api/package?userId=user-1');
    const response = await GET(request);
    const body = await response.json();

    expect(updateMock).not.toHaveBeenCalled();
    expect(body.jobs[0].status).toBe('deployed');
  });

  it('falls back to created_at when updated_at is missing', async () => {
    const staleJob = makeJob({
      id: 'job-no-updated-at',
      status: 'queued',
      updated_at: undefined as unknown as string,
      created_at: minutesAgo(STALE_JOB_TIMEOUT_MINUTES + 10),
    });
    getByUserIdMock.mockResolvedValue([staleJob]);

    const request = new NextRequest('http://localhost:3000/api/package?userId=user-1');
    const response = await GET(request);
    const body = await response.json();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(body.jobs[0].status).toBe('failed');
  });

  it('keeps the original status when the heal update does not apply', async () => {
    // e.g. a concurrent callback already moved the job out of the stale state
    updateMock.mockResolvedValue(null);
    const staleJob = makeJob({
      id: 'job-race',
      status: 'packaging',
      updated_at: minutesAgo(STALE_JOB_TIMEOUT_MINUTES + 5),
    });
    getByUserIdMock.mockResolvedValue([staleJob]);

    const request = new NextRequest('http://localhost:3000/api/package?userId=user-1');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jobs[0].status).toBe('packaging');
  });
});

describe('POST /api/package (workflow dispatch)', () => {
  const relationships = [
    {
      relationshipType: 'supersedence',
      targetId: 'old-app-1',
      targetDisplayName: 'Old App',
      supersedenceType: 'replace',
    },
  ];

  function makeWin32Item(overrides: Record<string, unknown> = {}) {
    return {
      wingetId: 'Test.App',
      displayName: 'Test App',
      publisher: 'Test',
      version: '1.0.0',
      architecture: 'x64',
      installerType: 'exe',
      installerUrl: 'https://example.com/setup.exe',
      installerSha256: 'a'.repeat(64),
      installCommand: 'setup.exe /S',
      uninstallCommand: 'uninstall.exe /S',
      installScope: 'machine',
      detectionRules: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getDatabaseMock.mockReturnValue({
      jobs: {
        create: createMock,
        update: updateMock,
      },
    });
    createMock.mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      created_at: new Date().toISOString(),
    }));
    updateMock.mockResolvedValue({});
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-1',
      userName: 'User',
    });
    checkStoredConsentMock.mockResolvedValue(true);
    getFeatureFlagsMock.mockReturnValue({ pipeline: true, localPackager: false });
    isGitHubActionsConfiguredMock.mockReturnValue(true);
    getAppConfigMock.mockReturnValue({ app: { url: 'http://localhost:3000' } });
    triggerPackagingWorkflowMock.mockResolvedValue({ success: true });
    enforceInstallerPreflightMock.mockResolvedValue({
      cacheKey: 'healthy-key',
      status: 'healthy',
      source: 'cache',
    });
    getLiveInstallersMock.mockImplementation(async (wingetId: string) => {
      if (wingetId === 'VNGCorp.Zalo') {
        return [{
          architecture: 'x86',
          url: 'https://example.com/setup.exe',
          sha256: 'A'.repeat(64),
          type: 'exe',
          scope: 'user',
          silentArgs: '/S',
        }];
      }
      if (wingetId === 'TeamSpeakSystems.TeamSpeakClient.Beta.6') {
        return [{
          architecture: 'x64',
          url: 'https://example.com/teamspeak-client.msi',
          sha256: 'A'.repeat(64),
          type: 'wix',
          scope: 'user',
          silentArgs: '/qn /norestart ALLUSERS=1',
          productCode: '{7BC5AB94-97F7-480C-A8A0-3D334A3A56DC}',
        }];
      }
      if (wingetId === 'Opera.Opera') {
        return [
          {
            architecture: 'x64',
            url: 'https://example.com/opera.exe',
            sha256: 'A'.repeat(64),
            type: 'exe',
            scope: 'user',
            silentArgs: '/silent /allusers=0',
          },
          {
            architecture: 'x64',
            url: 'https://example.com/opera.exe',
            sha256: 'A'.repeat(64),
            type: 'exe',
            scope: 'machine',
            silentArgs: '/silent /allusers=1',
          },
        ];
      }
      return [{
        architecture: 'x64',
        url: 'https://example.com/setup.exe',
        sha256: 'A'.repeat(64),
        type: 'exe',
        scope: 'machine',
        silentArgs: '/S',
      }];
    });
    ensureQaDemandMock.mockResolvedValue({
      state: 'passed',
      candidateId: null,
      identity: {
        executionProfileSha256: 'A'.repeat(64),
        packageProfileSha256: 'A'.repeat(64),
        presentationProfileSha256: 'B'.repeat(64),
      },
    });
    getPackageEligibilityBlocksMock.mockResolvedValue([]);
    isSupabaseServerConfiguredMock.mockReturnValue(true);
  });

  it('creates a queued local-packager job without Supabase or QA', async () => {
    isSupabaseServerConfiguredMock.mockReturnValue(false);
    getFeatureFlagsMock.mockReturnValue({ pipeline: true, localPackager: true });
    ensureQaDemandMock.mockResolvedValue({
      state: 'waiting',
      candidateId: 'candidate-1',
      identity: {
        executionProfileSha256: 'A'.repeat(64),
        packageProfileSha256: 'A'.repeat(64),
        presentationProfileSha256: 'B'.repeat(64),
      },
    });

    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item()] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(getPackageEligibilityBlocksMock).not.toHaveBeenCalled();
    expect(ensureQaDemandMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }));
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('blocks a retired catalog app before QA or customer packaging begins', async () => {
    getPackageEligibilityBlocksMock.mockResolvedValueOnce([
      { wingetId: 'Autodesk.DesktopApp', code: 'vendor_retired' },
    ]);
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'Autodesk.DesktopApp',
          displayName: 'Autodesk Desktop App',
        })],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: 'App unavailable',
      message: 'This app is not available for automated deployment.',
      code: 'PACKAGE_UNAVAILABLE',
      package: { wingetId: 'Autodesk.DesktopApp' },
    });
    expect(enforceInstallerPreflightMock).not.toHaveBeenCalled();
    expect(ensureQaDemandMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('preflights Blender through its official mirror while preserving manifest identity', async () => {
    const manifestUrl =
      'https://download.blender.org/release/Blender4.2/blender-4.2.16-windows-x64.msi';
    const mirrorUrl =
      'https://mirror.blender.org/release/Blender4.2/blender-4.2.16-windows-x64.msi';
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x64',
      url: manifestUrl,
      sha256: 'A'.repeat(64),
      type: 'wix',
      scope: 'machine',
      silentArgs: '',
      productCode: '{3CA82049-A4E1-4EFC-B529-4ED32AEF3F4F}',
    }]);
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'BlenderFoundation.Blender.LTS.4.2',
          displayName: 'Blender 4.2 LTS',
          version: '4.2.16',
          installerType: 'wix',
          installerUrl: manifestUrl,
          installerSha256: 'A'.repeat(64),
          installCommand: '',
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(enforceInstallerPreflightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        wingetId: 'BlenderFoundation.Blender.LTS.4.2',
        installerUrl: mirrorUrl,
        manifestInstallerUrl: manifestUrl,
        installerSha256: 'A'.repeat(64),
      }),
      expect.any(Array),
    );
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledOnce();
  });

  it('preflights ImageGlass through its renamed official asset while preserving manifest identity', async () => {
    const manifestUrl =
      'https://github.com/d2phap/ImageGlass/releases/download/10.0.4.819/ImageGlass_10.0.4.819_win-x64.msi';
    const releaseAssetUrl =
      'https://github.com/d2phap/ImageGlass/releases/download/10.0.4.819/ImageGlass_10.0.4.819_win-x64_pro-business.msi';
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x64',
      url: manifestUrl,
      sha256: 'D'.repeat(64),
      type: 'wix',
      scope: 'machine',
      silentArgs: 'ALLUSERS=1',
      productCode: '{6D0C2C70-3535-5F89-AC42-194E255ED60E}',
    }]);
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'DuongDieuPhap.ImageGlass',
          displayName: 'ImageGlass',
          version: '10.0.4.819',
          installerType: 'wix',
          installerUrl: manifestUrl,
          installerSha256: 'D'.repeat(64),
          installCommand: 'ALLUSERS=1',
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(enforceInstallerPreflightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        wingetId: 'DuongDieuPhap.ImageGlass',
        installerUrl: releaseAssetUrl,
        manifestInstallerUrl: manifestUrl,
        installerSha256: 'D'.repeat(64),
      }),
      expect.any(Array),
    );
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledOnce();
  });

  it('does not apply catalog retirement policy to a custom package', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'Autodesk.DesktopApp',
          sourceType: 'custom',
          installerSha256: '',
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(getPackageEligibilityBlocksMock.mock.calls[0][1]).toEqual([]);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
  });

  it('forwards item relationships into the workflow inputs', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item({ relationships })] }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        wingetId: 'Test.App',
        relationships: JSON.stringify(relationships),
      }),
      undefined,
      expect.any(Object)
    );
  });

  it('omits relationships from the workflow inputs when none are configured', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item()] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
    expect(triggerPackagingWorkflowMock.mock.calls[0][0].relationships).toBeUndefined();
  });

  it('uses a reviewed user scope consistently for QA, packaging, and Intune', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'VNGCorp.Zalo',
          displayName: 'Zalo',
          architecture: 'x86',
          installerType: 'exe',
          installScope: 'machine',
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(enforceInstallerPreflightMock).toHaveBeenCalledWith(
      expect.objectContaining({ installScope: 'user' }),
      expect.any(Array)
    );
    expect(ensureQaDemandMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ installScope: 'user' })
    );
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ install_scope: 'user' })
    );
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({ installScope: 'user' }),
      undefined,
      expect.any(Object)
    );
  });

  it('uses TeamSpeak 6 Beta all-users MSI scope for QA and customer packaging', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'TeamSpeakSystems.TeamSpeakClient.Beta.6',
          displayName: 'TeamSpeak 6 Beta',
          version: '6.0.0-beta4.1',
          installerType: 'wix',
          installerUrl: 'https://example.com/teamspeak-client.msi',
          installerSha256: 'A'.repeat(64),
          installScope: 'user',
          installCommand:
            'msiexec /i "teamspeak-client.msi" /qn /norestart ALLUSERS=1',
          uninstallCommand:
            'msiexec /x "{7BC5AB94-97F7-480C-A8A0-3D334A3A56DC}" /qn /norestart',
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(enforceInstallerPreflightMock).toHaveBeenCalledWith(
      expect.objectContaining({ installScope: 'machine' }),
      expect.any(Array)
    );
    expect(ensureQaDemandMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        installScope: 'machine',
        silentSwitches: '/qn /norestart ALLUSERS=1',
      })
    );
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      install_scope: 'machine',
      install_command:
        'msiexec /i "teamspeak-client.msi" /qn /norestart ALLUSERS=1',
    }));
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        installScope: 'machine',
        silentSwitches: '/qn /norestart ALLUSERS=1',
      }),
      undefined,
      expect.any(Object)
    );
  });

  it('rebuilds machine-scope commands before both QA and customer packaging', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'Opera.Opera',
          displayName: 'Opera Browser',
          installerUrl: 'https://example.com/opera.exe',
          installScope: 'machine',
          installCommand: '"opera.exe" /silent /allusers=0',
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(ensureQaDemandMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        installScope: 'machine',
        silentSwitches: '/silent /allusers=1',
      })
    );
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      install_scope: 'machine',
      install_command: '"opera.exe" /silent /allusers=1',
    }));
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        installScope: 'machine',
        silentSwitches: '/silent /allusers=1',
      }),
      undefined,
      expect.any(Object)
    );
  });

  it('passes trusted vendor MSI properties to both QA and customer packaging', async () => {
    const installerUrl = 'https://downloads.example.com/Macabacus-9.9.2.msi';
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x64',
      url: installerUrl,
      sha256: 'A'.repeat(64),
      type: 'wix',
      silentArgs: '/qn /norestart OFFICE2016X64FOUND=1 EULA=1',
      productCode: '{0B0CCAB5-2957-4FB4-9F55-EAEE1A613023}',
    }]);
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'Macabacus.Macabacus',
          displayName: 'Macabacus',
          version: '9.9.2',
          installerType: 'wix',
          installerUrl,
          installerSha256: 'A'.repeat(64),
          installScope: 'machine',
          installCommand: 'msiexec /i "Macabacus-9.9.2.msi" /qn ALLUSERS=1 /norestart',
          uninstallCommand:
            'msiexec /x "{0B0CCAB5-2957-4FB4-9F55-EAEE1A613023}" /qn /norestart',
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const expectedSilentSwitches =
      '/qn /norestart OFFICE2016X64FOUND=1 EULA=1 ALLUSERS=1';
    expect(ensureQaDemandMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ silentSwitches: expectedSilentSwitches })
    );
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      install_command:
        'msiexec /i "Macabacus-9.9.2.msi" /qn /norestart OFFICE2016X64FOUND=1 EULA=1 ALLUSERS=1',
    }));
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({ silentSwitches: expectedSilentSwitches }),
      undefined,
      expect.any(Object)
    );
  });

  it('applies the reviewed Opera immediate-uninstall contract to QA and customer packaging', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'Opera.Opera',
          displayName: 'Opera Browser',
          psadtConfig: { ...DEFAULT_PSADT_CONFIG },
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const expectedAdapter = {
      processesToClose: [{ name: 'opera', description: 'Opera browser' }],
      reviewedExactUninstall: {
        executablePath: '%ProgramFiles%\\Opera\\opera.exe',
        arguments: ['--uninstall', '--runimmediately', '--deleteuserprofile=0'],
        completionTimeoutMinutes: 5,
      },
    };
    expect(JSON.parse(ensureQaDemandMock.mock.calls[0][1].psadtConfig)).toMatchObject(
      expectedAdapter
    );
    expect(JSON.parse(triggerPackagingWorkflowMock.mock.calls[0][0].psadtConfig)).toMatchObject(
      expectedAdapter
    );
    expect(createMock.mock.calls[0][0].package_config).toMatchObject({
      psadtConfig: expectedAdapter,
    });
  });

  it('applies the reviewed Teradata archive uninstall to QA and customer packaging', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'Teradata.TTUOdbc',
          displayName: 'Teradata ODBC Driver',
          installerType: 'zip',
          installerUrl: 'https://example.com/TeradataODBC.zip',
          installCommand: 'TeradataODBC\\TTUSuiteSilent.exe /silent',
          uninstallCommand:
            'REGISTRY_UNINSTALL_PRODUCT:{F075B63A-C629-41F8-BA56-33D9940F2000}:Teradata ODBC Driver',
          nestedInstallerType: 'exe',
          nestedInstallerPath: 'TeradataODBC\\TTUSuiteSilent.exe',
          psadtConfig: { ...DEFAULT_PSADT_CONFIG },
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const expectedContract = {
      reviewedArchiveUninstall: {
        relativePath: 'TeradataODBC\\silent_uninstall.bat',
        arguments: ['ALL'],
        completionTimeoutMinutes: 15,
      },
    };
    expect(JSON.parse(ensureQaDemandMock.mock.calls[0][1].psadtConfig)).toMatchObject(
      expectedContract
    );
    expect(JSON.parse(triggerPackagingWorkflowMock.mock.calls[0][0].psadtConfig)).toMatchObject(
      expectedContract
    );
    expect(createMock.mock.calls[0][0].package_config).toMatchObject({
      psadtConfig: expectedContract,
    });
  });

  it('adds a usable Build Tools workload to QA and customer packaging', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'Microsoft.VisualStudio.BuildTools',
          displayName: 'Visual Studio BuildTools 2026',
          version: '18.9.1',
          psadtConfig: { ...DEFAULT_PSADT_CONFIG },
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const expectedAdapter = {
      reviewedInstallArguments: [
        '--installPath "%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools"',
        '--add Microsoft.VisualStudio.Workload.MSBuildTools',
        '--norestart',
      ],
      reviewedManagedInstallDirectory:
        '%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools',
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
        arguments: [
          'uninstall',
          '--installPath',
          '%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools',
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    };
    expect(JSON.parse(ensureQaDemandMock.mock.calls[0][1].psadtConfig)).toMatchObject(
      expectedAdapter
    );
    expect(JSON.parse(triggerPackagingWorkflowMock.mock.calls[0][0].psadtConfig)).toMatchObject(
      expectedAdapter
    );
    expect(createMock.mock.calls[0][0].package_config).toMatchObject({
      psadtConfig: expectedAdapter,
    });
  });

  it('repairs empty catalog detection rules for both QA and customer packaging', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'Anysphere.Cursor',
          displayName: 'Cursor',
          version: '3.14.27',
          detectionRules: [],
          psadtConfig: { ...DEFAULT_PSADT_CONFIG, detectionRules: [] },
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const expectedRule = expect.objectContaining({
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Anysphere_Cursor',
      detectionValue: '3.14.27',
    });
    expect(JSON.parse(ensureQaDemandMock.mock.calls[0][1].detectionRules)).toEqual([
      expectedRule,
    ]);
    expect(JSON.parse(triggerPackagingWorkflowMock.mock.calls[0][0].detectionRules)).toEqual([
      expectedRule,
    ]);
    expect(JSON.parse(triggerPackagingWorkflowMock.mock.calls[0][0].psadtConfig)).toMatchObject({
      detectionRules: [expectedRule],
    });
    expect(createMock.mock.calls[0][0].package_config).toMatchObject({
      detectionRules: [expectedRule],
      psadtConfig: { detectionRules: [expectedRule] },
    });
  });

  it('restores a saved custom marker root for both QA and customer packaging', async () => {
    const savedRule = {
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\HBX\\InstalledApps\\8x8_Work',
      valueName: 'Version',
      check32BitOn64System: false,
      detectionType: 'version',
      operator: 'greaterThanOrEqual',
      detectionValue: '8.36.2',
    };
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: '8x8.Work',
          displayName: '8x8 Work',
          version: '8.36.2',
          installerType: 'msi',
          detectionRules: [savedRule],
          psadtConfig: { ...DEFAULT_PSADT_CONFIG, detectionRules: [savedRule] },
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    for (const serializedConfig of [
      ensureQaDemandMock.mock.calls[0][1].psadtConfig,
      triggerPackagingWorkflowMock.mock.calls[0][0].psadtConfig,
    ]) {
      expect(JSON.parse(serializedConfig)).toMatchObject({
        registryMarkerPath: 'SOFTWARE\\HBX\\InstalledApps',
        detectionRules: [savedRule],
      });
    }
    expect(createMock.mock.calls[0][0].package_config).toMatchObject({
      detectionRules: [savedRule],
      psadtConfig: {
        registryMarkerPath: 'SOFTWARE\\HBX\\InstalledApps',
        detectionRules: [savedRule],
      },
    });
  });

  it('repairs stale generated MSIX detection before both QA and customer MSI packaging', async () => {
    const staleMsixRule = {
      type: 'script',
      scriptContent: [
        '# MSIX Detection Script',
        '# Package Family Name: Agilebits.1Password_amwd9z03whsfe',
        'exit 0',
      ].join('\n'),
      enforceSignatureCheck: false,
      runAs32Bit: false,
    };
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          wingetId: 'AgileBits.1Password',
          displayName: '1Password',
          version: '8.12.30.21',
          installerType: 'msi',
          detectionRules: [staleMsixRule],
          psadtConfig: { ...DEFAULT_PSADT_CONFIG, detectionRules: [staleMsixRule] },
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const expectedRule = expect.objectContaining({
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\AgileBits_1Password',
      detectionValue: '8.12.30.21',
    });
    expect(JSON.parse(ensureQaDemandMock.mock.calls[0][1].detectionRules)).toEqual([
      expectedRule,
    ]);
    expect(JSON.parse(triggerPackagingWorkflowMock.mock.calls[0][0].detectionRules)).toEqual([
      expectedRule,
    ]);
    expect(createMock.mock.calls[0][0].package_config).toMatchObject({
      detectionRules: [expectedRule],
      psadtConfig: { detectionRules: [expectedRule] },
    });
  });

  it('preserves configured PSADT rules when the top-level list is unusable', async () => {
    const fileRule = {
      type: 'file',
      path: '%ProgramFiles%\\Cursor',
      fileOrFolderName: 'Cursor.exe',
      detectionType: 'exists',
    };
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          detectionRules: [{}],
          psadtConfig: { ...DEFAULT_PSADT_CONFIG, detectionRules: [fileRule] },
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(JSON.parse(ensureQaDemandMock.mock.calls[0][1].detectionRules)).toEqual([fileRule]);
    expect(JSON.parse(triggerPackagingWorkflowMock.mock.calls[0][0].detectionRules)).toEqual([
      fileRule,
    ]);
    expect(createMock.mock.calls[0][0].package_config).toMatchObject({
      detectionRules: [fileRule],
      psadtConfig: { detectionRules: [fileRule] },
    });
  });

  it('leaves custom-source detection rules untouched', async () => {
    const fileRule = {
      type: 'file',
      path: '%LocalAppData%\\Custom App',
      fileOrFolderName: 'Custom.exe',
      detectionType: 'exists',
    };
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          sourceType: 'custom',
          installerSha256: '',
          detectionRules: [fileRule],
        })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(ensureQaDemandMock).not.toHaveBeenCalled();
    expect(JSON.parse(triggerPackagingWorkflowMock.mock.calls[0][0].detectionRules)).toEqual([
      fileRule,
    ]);
    expect(createMock.mock.calls[0][0].package_config).toMatchObject({
      sourceType: 'custom',
      detectionRules: [fileRule],
    });
  });

  it('fails closed before job creation when a catalog identity is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({ wingetId: undefined })],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: false,
      errors: [{ error: 'Catalog package detection requires a non-empty Winget ID' }],
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(ensureQaDemandMock).not.toHaveBeenCalled();
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('parks a customer deployment until its exact execution profile passes QA', async () => {
    ensureQaDemandMock.mockResolvedValueOnce({
      state: 'waiting',
      candidateId: 'candidate-1',
      identity: {
        executionProfileSha256: 'A'.repeat(64),
        packageProfileSha256: 'A'.repeat(64),
        presentationProfileSha256: 'B'.repeat(64),
      },
    });

    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item()] }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jobs[0]).toMatchObject({ status: 'awaiting_qa' });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'awaiting_qa',
      status_message: 'Running an isolated installation test to make sure this app works before deployment',
      qa_candidate_id: 'candidate-1',
      execution_profile_sha256: 'A'.repeat(64),
      presentation_profile_sha256: 'B'.repeat(64),
    }));
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('calculates the hash in the workflow for a custom app without a supplied SHA256', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({ sourceType: 'custom', installerSha256: '' })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
    expect(triggerPackagingWorkflowMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        installerSha256: '',
        hashValidationMode: 'calculate',
      })
    );
  });

  it('rejects a custom plain EXE without silent switches before creating a job', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({
          sourceType: 'custom',
          installerSha256: '',
          installCommand: 'setup.exe',
        })],
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ code: 'SILENT_INSTALL_UNAVAILABLE' });
    expect(createMock).not.toHaveBeenCalled();
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('treats a whitespace-only custom-app SHA256 as missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({ sourceType: 'custom', installerSha256: '   ' })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerPackagingWorkflowMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        installerSha256: '',
        hashValidationMode: 'calculate',
      })
    );
  });

  it('keeps strict hash validation when a trusted SHA256 is supplied', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item()] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerPackagingWorkflowMock.mock.calls[0][0].hashValidationMode).toBe('strict');
  });

  it('rejects a catalog package without its trusted manifest SHA256', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item({ installerSha256: '' })] }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/catalog packages require a trusted manifest hash/i);
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid custom-app SHA256 instead of calculating over malformed input', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({ sourceType: 'custom', installerSha256: 'not-a-hash' })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('blocks a quarantined installer before creating a job or dispatching an Action', async () => {
    enforceInstallerPreflightMock.mockRejectedValueOnce(new InstallerPreflightError(
      'HASH_MISMATCH',
      'The publisher currently serves different bytes.',
      false,
      'b'.repeat(64),
    ));

    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item()] }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual(expect.objectContaining({
      code: 'HASH_MISMATCH',
      retryable: false,
      package: {
        wingetId: 'Test.App',
        displayName: 'Test App',
        version: '1.0.0',
      },
      expectedSha256: 'A'.repeat(64),
      actualSha256: 'b'.repeat(64),
    }));
    expect(createMock).not.toHaveBeenCalled();
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('creates an actionable blocked job for a failed execution profile', async () => {
    ensureQaDemandMock.mockResolvedValueOnce({
      state: 'failed',
      candidateId: 'candidate-1',
      failureSummary: 'Correct the uninstall command.',
      identity: {
        executionProfileSha256: 'A'.repeat(64),
        packageProfileSha256: 'A'.repeat(64),
        presentationProfileSha256: 'B'.repeat(64),
      },
    });

    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item()] }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jobs[0]).toMatchObject({ status: 'qa_failed' });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      status: 'qa_failed',
      qa_candidate_id: 'candidate-1',
      error_code: 'QA_FAILED_EXECUTION_PROFILE',
    }));
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });
});
