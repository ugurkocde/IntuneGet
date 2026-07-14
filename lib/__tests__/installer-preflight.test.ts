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
    });
    await expect(enforceInstallerPreflight(request)).rejects.toMatchObject({
      code: 'HASH_MISMATCH',
      retryable: false,
      actualSha256,
    });

    expect(hashRemoteInstallerMock).toHaveBeenCalledTimes(1);
  });

  it('quarantines a stale tuple when the trusted manifest has changed', async () => {
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x64',
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
