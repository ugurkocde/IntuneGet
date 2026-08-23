import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchQaCandidate } from './dispatch';

const { enforceInstallerPreflightMock } = vi.hoisted(() => ({
  enforceInstallerPreflightMock: vi.fn(),
}));

vi.mock('@/lib/github-actions', () => ({
  getGitHubActionsConfig: () => ({
    token: 'secret-token',
    owner: 'example',
    workflowsRepo: 'workflows',
    ref: 'main',
  }),
}));

vi.mock('@/lib/installer-preflight', () => ({
  enforceInstallerPreflight: enforceInstallerPreflightMock,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  enforceInstallerPreflightMock.mockReset();
});

describe('dispatchQaCandidate', () => {
  it('dispatches only exact public candidate metadata', async () => {
    enforceInstallerPreflightMock.mockResolvedValue({
      cacheKey: 'healthy',
      status: 'healthy',
      source: 'live',
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    await dispatchQaCandidate({
      id: '11111111-1111-4111-8111-111111111111',
      winget_id: 'Example.App',
      definition_path: 'qa/apps/example.app.json',
      version: '2.0.0',
      architecture: 'x64',
      installer_url: 'https://example.test/setup.exe',
      installer_sha256: 'A'.repeat(64),
      installer_file_name: 'setup.exe',
      installer_type: 'exe',
      test_level: 'psadt-package',
      package_profile_sha256: 'B'.repeat(64),
      test_config: {
        mode: 'psadt-package',
        scope: 'user',
        sourceInstallerType: 'wix',
      },
    });

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toContain('/actions/workflows/intune-qa.yml/dispatches');
    const body = JSON.parse(String((request as RequestInit).body));
    expect(body.inputs).toMatchObject({
      app_definition: 'qa/apps/example.app.json',
      candidate_label: 'Example.App 2.0.0 x64',
      timeout_minutes: '20',
    });
    expect(JSON.parse(body.inputs.candidate_payload)).toMatchObject({
      version: '2.0.0',
      wingetId: 'Example.App',
      architecture: 'x64',
      installerSha256: 'A'.repeat(64),
      testLevel: 'psadt-package',
      packageProfileSha256: 'B'.repeat(64),
    });
    expect(JSON.stringify(body)).not.toContain('secret-token');
    expect(enforceInstallerPreflightMock).toHaveBeenCalledWith({
      wingetId: 'Example.App',
      version: '2.0.0',
      architecture: 'x64',
      installerUrl: 'https://example.test/setup.exe',
      manifestInstallerUrl: 'https://example.test/setup.exe',
      installerSha256: 'A'.repeat(64),
      installerType: 'wix',
      installScope: 'user',
      sourceType: 'winget',
    });
  });

  it('uses a reviewed mirror for both QA preflight and the runner payload', async () => {
    enforceInstallerPreflightMock.mockResolvedValue({
      cacheKey: 'healthy',
      status: 'healthy',
      source: 'live',
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const manifestUrl =
      'https://download.blender.org/release/Blender4.2/blender-4.2.16-windows-x64.msi';
    const mirrorUrl =
      'https://mirror.blender.org/release/Blender4.2/blender-4.2.16-windows-x64.msi';

    await dispatchQaCandidate({
      id: '22222222-2222-4222-8222-222222222222',
      winget_id: 'BlenderFoundation.Blender.LTS.4.2',
      definition_path: null,
      version: '4.2.16',
      architecture: 'x64',
      installer_url: manifestUrl,
      installer_sha256: 'B'.repeat(64),
      installer_file_name: 'blender-4.2.16-windows-x64.msi',
      installer_type: 'msi',
      test_level: 'psadt-package',
      package_profile_sha256: 'C'.repeat(64),
      test_config: { mode: 'psadt-package', sourceInstallerType: 'wix' },
    });

    expect(enforceInstallerPreflightMock).toHaveBeenCalledWith(expect.objectContaining({
      installerUrl: mirrorUrl,
      manifestInstallerUrl: manifestUrl,
      installerSha256: 'B'.repeat(64),
    }));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(JSON.parse(body.inputs.candidate_payload).installerUrl).toBe(mirrorUrl);
  });

  it('keeps the outer QA guard beyond a reviewed customer-package installer deadline', async () => {
    enforceInstallerPreflightMock.mockResolvedValue({
      cacheKey: 'healthy',
      status: 'healthy',
      source: 'live',
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await dispatchQaCandidate({
      id: '44444444-4444-4444-8444-444444444444',
      winget_id: 'Webroot.SecureAnywhere',
      definition_path: null,
      version: '9.0.45.63',
      architecture: 'x86',
      installer_url: 'https://example.test/wsainstall.msi',
      installer_sha256: 'F'.repeat(64),
      installer_file_name: 'wsainstall.msi',
      installer_type: 'msi',
      test_level: 'psadt-package',
      package_profile_sha256: 'A'.repeat(64),
      test_config: {
        mode: 'psadt-package',
        psadtConfig: { reviewedInstallCompletionTimeoutMinutes: 30 },
      },
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.inputs.timeout_minutes).toBe('35');
  });

  it('uses the renamed ImageGlass release asset for QA preflight and runner payload', async () => {
    enforceInstallerPreflightMock.mockResolvedValue({
      cacheKey: 'healthy',
      status: 'healthy',
      source: 'live',
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const manifestUrl =
      'https://github.com/d2phap/ImageGlass/releases/download/10.0.4.819/ImageGlass_10.0.4.819_win-x64.msi';
    const releaseAssetUrl =
      'https://github.com/d2phap/ImageGlass/releases/download/10.0.4.819/ImageGlass_10.0.4.819_win-x64_pro-business.msi';

    await dispatchQaCandidate({
      id: '33333333-3333-4333-8333-333333333333',
      winget_id: 'DuongDieuPhap.ImageGlass',
      definition_path: null,
      version: '10.0.4.819',
      architecture: 'x64',
      installer_url: manifestUrl,
      installer_sha256: 'D'.repeat(64),
      installer_file_name: 'ImageGlass_10.0.4.819_win-x64.msi',
      installer_type: 'msi',
      test_level: 'psadt-package',
      package_profile_sha256: 'E'.repeat(64),
      test_config: { mode: 'psadt-package', sourceInstallerType: 'wix' },
    });

    expect(enforceInstallerPreflightMock).toHaveBeenCalledWith(expect.objectContaining({
      installerUrl: releaseAssetUrl,
      manifestInstallerUrl: manifestUrl,
      installerSha256: 'D'.repeat(64),
    }));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(JSON.parse(body.inputs.candidate_payload).installerUrl).toBe(releaseAssetUrl);
  });

  it('surfaces a rejected GitHub dispatch', async () => {
    enforceInstallerPreflightMock.mockResolvedValue({
      cacheKey: 'healthy',
      status: 'healthy',
      source: 'live',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('denied', { status: 403 })));
    await expect(
      dispatchQaCandidate({
        id: '11111111-1111-4111-8111-111111111111',
        winget_id: 'Example.App',
        definition_path: 'qa/apps/example.app.json',
        version: '2.0.0',
        architecture: 'x64',
        installer_url: 'https://example.test/setup.exe',
        installer_sha256: 'A'.repeat(64),
        installer_file_name: 'setup.exe',
        installer_type: 'exe',
        test_level: 'psadt-package',
        package_profile_sha256: 'B'.repeat(64),
        test_config: { mode: 'psadt-package' },
      })
    ).rejects.toThrow('403');
  });
});
