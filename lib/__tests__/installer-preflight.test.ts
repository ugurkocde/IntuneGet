import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLiveInstallersMock, hashRemoteInstallerMock, requestMock } = vi.hoisted(() => ({
  getLiveInstallersMock: vi.fn(),
  hashRemoteInstallerMock: vi.fn(),
  requestMock: vi.fn(),
}));

vi.mock('node:https', () => ({ request: requestMock }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]) }));

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
import { InstallerDownloadDeadlineError } from '@/lib/installer-download';

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

  it('caches the size refusal for one day without suggesting retries or hash quarantine', async () => {
    const initial = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(initial);
    try {
      const body = Buffer.from('size-limit-cache-fixture');
      const sha256 = createHash('sha256').update(body).digest('hex').toUpperCase();
      const sizeRequest = { ...request, installerSha256: sha256 };
      getLiveInstallersMock.mockResolvedValue([{ architecture: 'x64', url: request.installerUrl,
        sha256, type: 'exe', scope: 'machine' }]);
      const downloader = await vi.importActual<typeof import('@/lib/installer-download')>('@/lib/installer-download');
      hashRemoteInstallerMock.mockImplementation(downloader.hashRemoteInstaller);
      let oversized = true;
      requestMock.mockImplementation((_options, callback) => {
        const transport = new EventEmitter() as EventEmitter & { setTimeout: () => void; end: () => void };
        transport.setTimeout = () => {};
        transport.end = () => queueMicrotask(() => {
          const response = Object.assign(new PassThrough(), {
            headers: { 'content-length': String(oversized ? 5 * 1024 ** 3 + 1 : body.length) }, statusCode: 200,
          });
          callback(response);
          if (!response.destroyed) response.end(body);
        });
        return transport;
      });
      await expect(enforceInstallerPreflight(sizeRequest)).rejects.toMatchObject({ code: 'INSTALLER_TOO_LARGE', retryable: false });
      clock.mockReturnValue(initial + 23 * 60 * 60 * 1000);
      await expect(enforceInstallerPreflight(sizeRequest)).rejects.toMatchObject({ code: 'INSTALLER_TOO_LARGE', retryable: false });
      expect(requestMock).toHaveBeenCalledOnce();
      expect(hashRemoteInstallerMock).toHaveBeenCalledOnce();
      oversized = false;
      clock.mockReturnValue(initial + 24 * 60 * 60 * 1000 + 1);
      await expect(enforceInstallerPreflight(sizeRequest)).resolves.toMatchObject({ status: 'healthy', source: 'live', actualSha256: sha256 });
      expect(requestMock).toHaveBeenCalledTimes(2);
      expect(hashRemoteInstallerMock).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });

  it.each(['Installer download returned HTTP 403', 'Installer download returned HTTP 404', 'unable to verify the first certificate'])(
    'keeps transport failures retryable: %s', async (message) => {
      hashRemoteInstallerMock.mockRejectedValueOnce(new Error(message));
      await expect(enforceInstallerPreflight(request)).rejects.toMatchObject({ code: 'PREFLIGHT_UNAVAILABLE', retryable: true });
    },
  );

  it.each([
    { wingetId: 'Custom.Example.App', sourceType: 'custom' as const },
    { wingetId: 'Custom.Example.App', sourceType: undefined },
    { wingetId: 'Example.App', sourceType: 'custom' as const },
  ])('rejects HTTP custom installers before any network or catalog work: %j', async (custom) => {
    await expect(enforceInstallerPreflight({
      ...request,
      ...custom,
      installerUrl: 'http://example.com/setup.exe',
      installerSha256: '',
    })).rejects.toMatchObject({ code: 'INVALID_INSTALLER_URL', retryable: false });
    expect(getLiveInstallersMock).not.toHaveBeenCalled();
    expect(hashRemoteInstallerMock).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
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

  it('does not download or suggest retrying a removed manifest version', async () => {
    getLiveInstallersMock.mockResolvedValue([]);
    await expect(enforceInstallerPreflight(request)).rejects.toMatchObject({
      code: 'MANIFEST_UNAVAILABLE', retryable: false,
    });
    expect(hashRemoteInstallerMock).not.toHaveBeenCalled();
    // The claim is released into a definitive error, never left "checking".
    await expect(enforceInstallerPreflight(request)).rejects.toMatchObject({
      code: 'MANIFEST_UNAVAILABLE', retryable: false,
    });
    expect(getLiveInstallersMock).toHaveBeenCalledOnce();
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
    expect(createInstallerHealthKey(request)).toBe(
      '4a163d0ab2ee36349a086201a52a30090585393dee25fec8889fee47d254d937'
    );
    expect(createInstallerHealthKey(request)).not.toBe(createInstallerHealthKey({
      ...request,
      installScope: 'user',
    }));
  });

  it('accepts Appium machine-labelled manifest bytes for reviewed user execution', async () => {
    const appiumRequest = {
      ...request,
      wingetId: 'AppiumDevelopers.AppiumInspector',
      installerUrl: 'https://example.test/appium-inspector.exe',
      installScope: 'user' as const,
    };
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x64',
      url: appiumRequest.installerUrl,
      sha256: expectedSha256,
      type: 'exe',
      scope: 'machine',
    }]);

    await expect(enforceInstallerPreflight(appiumRequest)).resolves.toMatchObject({
      status: 'healthy',
      source: 'live',
    });
    expect(hashRemoteInstallerMock).toHaveBeenCalledTimes(1);
  });

  it('accepts Logitech Presentation user manifest bytes for reviewed SYSTEM execution', async () => {
    const logitechRequest = {
      ...request,
      wingetId: 'Logitech.Presentation',
      architecture: 'x86',
      installerUrl: 'https://example.test/logitech-presentation.exe',
      installerType: 'nullsoft',
    };
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x86',
      url: logitechRequest.installerUrl,
      sha256: expectedSha256,
      type: 'nullsoft',
      scope: 'user',
    }]);

    await expect(enforceInstallerPreflight(logitechRequest)).resolves.toMatchObject({
      status: 'healthy',
      source: 'live',
    });
    expect(hashRemoteInstallerMock).toHaveBeenCalledTimes(1);
  });

  it('accepts WatchBP Analyzer user manifest bytes for reviewed SYSTEM execution', async () => {
    const watchBpRequest = {
      ...request,
      wingetId: 'Microlife.WatchBPAnalyzer',
      architecture: 'x64',
      installerUrl: 'https://example.test/watchbp-analyzer.exe',
      installerType: 'nullsoft',
    };
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x64',
      url: watchBpRequest.installerUrl,
      sha256: expectedSha256,
      type: 'nullsoft',
      scope: 'user',
    }]);

    await expect(enforceInstallerPreflight(watchBpRequest)).resolves.toMatchObject({
      status: 'healthy',
      source: 'live',
    });
    expect(hashRemoteInstallerMock).toHaveBeenCalledTimes(1);
  });

  it('accepts NVM user manifest bytes for reviewed SYSTEM execution', async () => {
    const nvmRequest = {
      ...request,
      wingetId: 'CoreyButler.NVMforWindows',
      architecture: 'x86',
      installerUrl: 'https://example.test/nvm-setup.exe',
      installerType: 'inno',
    };
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x86',
      url: nvmRequest.installerUrl,
      sha256: expectedSha256,
      type: 'inno',
      scope: 'user',
    }]);

    await expect(enforceInstallerPreflight(nvmRequest)).resolves.toMatchObject({
      status: 'healthy',
      source: 'live',
    });
    expect(hashRemoteInstallerMock).toHaveBeenCalledTimes(1);
  });

  it('accepts WPS Office user manifest bytes for reviewed SYSTEM execution', async () => {
    const wpsRequest = {
      ...request,
      wingetId: 'Kingsoft.WPSOffice',
      architecture: 'x86',
      installerUrl: 'https://example.test/wps-office.exe',
      installerType: 'exe',
    };
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x86',
      url: wpsRequest.installerUrl,
      sha256: expectedSha256,
      type: 'exe',
      scope: 'user',
    }]);

    await expect(enforceInstallerPreflight(wpsRequest)).resolves.toMatchObject({
      status: 'healthy',
      source: 'live',
    });
    expect(hashRemoteInstallerMock).toHaveBeenCalledTimes(1);
  });

  it('still rejects an opposite manifest scope without a reviewed adapter', async () => {
    getLiveInstallersMock.mockResolvedValueOnce([{
      architecture: 'x64',
      url: request.installerUrl,
      sha256: expectedSha256,
      type: 'exe',
      scope: 'user',
    }]);

    await expect(enforceInstallerPreflight(request)).rejects.toMatchObject({
      code: 'MANIFEST_CHANGED',
      retryable: false,
    });
    expect(hashRemoteInstallerMock).not.toHaveBeenCalled();
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

  it('maps the hard download deadline to a retryable preflight result', async () => {
    hashRemoteInstallerMock.mockRejectedValueOnce(new InstallerDownloadDeadlineError(240_000));

    await expect(enforceInstallerPreflight(request)).rejects.toMatchObject({
      code: 'PREFLIGHT_DEADLINE_EXCEEDED',
      retryable: true,
      message: 'Installer verification exceeded the 240000ms wall-clock deadline',
    });
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
