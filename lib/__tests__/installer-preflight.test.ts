import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLiveInstallersMock, hashRemoteInstallerMock } = vi.hoisted(() => ({
  getLiveInstallersMock: vi.fn(),
  hashRemoteInstallerMock: vi.fn(),
}));

vi.mock('@/lib/manifest-api', () => ({
  getLiveInstallers: getLiveInstallersMock,
}));

vi.mock('@/lib/installer-download', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/installer-download')>();
  return {
    ...original,
    hashRemoteInstaller: hashRemoteInstallerMock,
  };
});

import {
  createInstallerHealthKey,
  enforceInstallerPreflight,
  InstallerPreflightError,
  resetInstallerPreflightStateForTests,
} from '@/lib/installer-preflight';

const expectedSha256 = 'a'.repeat(64).toUpperCase();
const actualSha256 = 'b'.repeat(64).toUpperCase();
const request = {
  wingetId: 'Example.App',
  version: '1.2.3',
  architecture: 'x64',
  installerUrl: 'https://example.test/releases/1.2.3/setup.exe',
  installerSha256: expectedSha256,
  installerType: 'exe',
  installScope: 'machine' as const,
  sourceType: 'winget' as const,
};

describe('installer dispatch preflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetInstallerPreflightStateForTests();
    getLiveInstallersMock.mockResolvedValue([{
      architecture: 'x64',
      url: request.installerUrl,
      sha256: expectedSha256,
      type: 'exe',
      scope: 'machine',
    }]);
    hashRemoteInstallerMock.mockResolvedValue({
      sha256: expectedSha256,
      bytes: 42,
      finalUrl: request.installerUrl,
    });
  });

  it('skips custom installers', async () => {
    await expect(enforceInstallerPreflight({
      ...request,
      wingetId: 'Custom.Example.App',
      installerSha256: '',
      sourceType: 'custom',
    })).resolves.toEqual(expect.objectContaining({ status: 'skipped', source: 'custom' }));
    expect(getLiveInstallersMock).not.toHaveBeenCalled();
    expect(hashRemoteInstallerMock).not.toHaveBeenCalled();
  });

  it('checks the exact live manifest and caches a healthy tuple', async () => {
    await expect(enforceInstallerPreflight(request)).resolves.toEqual(expect.objectContaining({
      status: 'healthy',
      source: 'live',
    }));
    await expect(enforceInstallerPreflight(request)).resolves.toEqual(expect.objectContaining({
      status: 'healthy',
      source: 'cache',
    }));

    expect(getLiveInstallersMock).toHaveBeenCalledTimes(1);
    expect(getLiveInstallersMock).toHaveBeenCalledWith('Example.App', '1.2.3');
    expect(hashRemoteInstallerMock).toHaveBeenCalledTimes(1);
  });

  it('reuses an already-fetched trusted manifest during preflight', async () => {
    await expect(enforceInstallerPreflight(request, [{
      architecture: 'x64',
      url: request.installerUrl,
      sha256: expectedSha256,
      type: 'exe',
      scope: 'machine',
    }])).resolves.toMatchObject({ status: 'healthy', source: 'live' });

    expect(getLiveInstallersMock).not.toHaveBeenCalled();
    expect(hashRemoteInstallerMock).toHaveBeenCalledTimes(1);
  });

  it('keeps user and machine health identities separate', () => {
    expect(createInstallerHealthKey(request)).not.toBe(createInstallerHealthKey({
      ...request,
      installScope: 'user',
    }));
  });

  it('treats WinGet installer aliases as the same executable contract', async () => {
    const msiRequest = {
      ...request,
      installerUrl: 'https://example.test/releases/1.2.3/setup.msi',
      installerType: 'msi',
    };
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x64',
      url: msiRequest.installerUrl,
      sha256: expectedSha256,
      type: 'wix',
      scope: 'machine',
    }]);
    hashRemoteInstallerMock.mockResolvedValueOnce({
      sha256: expectedSha256,
      bytes: 42,
      finalUrl: msiRequest.installerUrl,
    });

    await expect(enforceInstallerPreflight(msiRequest)).resolves.toMatchObject({
      status: 'healthy',
      source: 'live',
    });
    expect(createInstallerHealthKey(msiRequest)).toBe(createInstallerHealthKey({
      ...msiRequest,
      installerType: 'wix',
    }));
  });

  it('quarantines a hash mismatch and blocks later dispatch without another download', async () => {
    hashRemoteInstallerMock.mockResolvedValueOnce({
      sha256: actualSha256,
      bytes: 42,
      finalUrl: request.installerUrl,
    });

    await expect(enforceInstallerPreflight(request)).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
      retryable: false,
      actualSha256,
      message: 'The publisher currently serves different bytes for Example.App 1.2.3. The deployment was quarantined before the packaging pipeline started.',
    });
    await expect(enforceInstallerPreflight(request)).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
      retryable: false,
      actualSha256,
    });

    expect(hashRemoteInstallerMock).toHaveBeenCalledTimes(1);
  });

  it('caches manifest drift as a deterministic tuple error', async () => {
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x64',
      url: request.installerUrl,
      sha256: actualSha256,
      type: 'exe',
      scope: 'machine',
    }]);

    await expect(enforceInstallerPreflight(request)).rejects.toBeInstanceOf(InstallerPreflightError);
    await expect(enforceInstallerPreflight(request)).rejects.toMatchObject({
      code: 'MANIFEST_CHANGED',
      retryable: false,
    });
    expect(hashRemoteInstallerMock).not.toHaveBeenCalled();
  });

  it('fails closed in hosted mode without shared health state', async () => {
    vi.stubEnv('VERCEL', '1');
    resetInstallerPreflightStateForTests();

    await expect(enforceInstallerPreflight(request)).rejects.toMatchObject({
      code: 'PREFLIGHT_STATE_UNAVAILABLE',
      retryable: true,
    });
    expect(hashRemoteInstallerMock).not.toHaveBeenCalled();
  });
});
