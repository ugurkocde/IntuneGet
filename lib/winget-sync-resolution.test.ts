import { describe, expect, it, vi } from 'vitest';
import {
  WingetSyncOperationalError,
  classifyWingetSyncRun,
  createWingetManifestClient,
  resolveWingetManifest,
} from './winget-sync-resolution.mjs';

const installerManifest = {
  PackageIdentifier: 'Example.App',
  PackageVersion: '2.0.0',
  Installers: [{ InstallerUrl: 'https://example.test/app.exe' }],
};

describe('resolveWingetManifest', () => {
  it('uses a valid stored version without enumerating GitHub versions', async () => {
    const client = {
      fetchInstallerManifest: vi.fn().mockResolvedValue(installerManifest),
      fetchVersions: vi.fn(),
    };

    await expect(resolveWingetManifest({ client, wingetId: 'Example.App', storedVersion: '1.0.0' }))
      .resolves.toMatchObject({ status: 'resolved', version: '1.0.0', source: 'stored' });
    expect(client.fetchVersions).not.toHaveBeenCalled();
  });

  it('heals a pruned stored version to the current live version', async () => {
    const client = {
      fetchInstallerManifest: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(installerManifest),
      fetchVersions: vi.fn().mockResolvedValue(['2.0.0', '1.5.0']),
    };

    await expect(resolveWingetManifest({ client, wingetId: 'Example.App', storedVersion: '1.0.0' }))
      .resolves.toMatchObject({ status: 'resolved', version: '2.0.0', source: 'live' });
  });

  it('classifies a removed package as unavailable', async () => {
    const client = {
      fetchInstallerManifest: vi.fn().mockResolvedValue(null),
      fetchVersions: vi.fn().mockResolvedValue([]),
    };

    await expect(resolveWingetManifest({ client, wingetId: 'Removed.App', storedVersion: '1.0.0' }))
      .resolves.toEqual({ status: 'unavailable', reason: 'package_or_version_missing' });
  });

  it('uses a singleton version manifest when no installer file exists', async () => {
    const singletonYaml = [
      'PackageIdentifier: Example.App',
      'PackageVersion: 1.0.0',
      'ManifestType: singleton',
      'Installers:',
      '- Architecture: x64',
      '  InstallerUrl: https://example.test/app.exe',
      '  InstallerSha256: ABC123',
    ].join('\n');
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(singletonYaml, { status: 200 }));
    const client = createWingetManifestClient({ fetchImpl, maxRetries: 0 });

    await expect(resolveWingetManifest({ client, wingetId: 'Example.App', storedVersion: '1.0.0' }))
      .resolves.toMatchObject({ status: 'resolved', version: '1.0.0' });
  });

  it('verifies a raw 404 through the GitHub Contents API', async () => {
    const yaml = [
      'PackageIdentifier: Example.App',
      'PackageVersion: 1.0.0',
      'ManifestType: installer',
      'Installers:',
      '- Architecture: x64',
      '  InstallerUrl: https://example.test/app.exe',
    ].join('\n');
    const apiPayload = JSON.stringify({ encoding: 'base64', content: Buffer.from(yaml).toString('base64') });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(apiPayload, { status: 200 }));
    const client = createWingetManifestClient({ fetchImpl, maxRetries: 0 });

    await expect(resolveWingetManifest({ client, wingetId: 'Example.App', storedVersion: '1.0.0' }))
      .resolves.toMatchObject({ status: 'resolved', version: '1.0.0' });
  });

  it('treats exhausted rate limits as operational errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const client = createWingetManifestClient({ fetchImpl, maxRetries: 0 });

    await expect(resolveWingetManifest({ client, wingetId: 'Example.App', storedVersion: '1.0.0' }))
      .rejects.toMatchObject({ name: 'WingetSyncOperationalError', code: 'HTTP_429' });
  });

  it('treats invalid YAML as an operational error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('[unclosed', { status: 200 }));
    const client = createWingetManifestClient({ fetchImpl, maxRetries: 0 });

    await expect(resolveWingetManifest({ client, wingetId: 'Example.App', storedVersion: '1.0.0' }))
      .rejects.toBeInstanceOf(WingetSyncOperationalError);
  });
});

describe('classifyWingetSyncRun', () => {
  it('keeps source unavailability non-fatal while recording partial status', () => {
    expect(classifyWingetSyncRun({ complete: true, unavailable: 3 })).toEqual({
      shouldFail: false,
      status: 'partial',
    });
  });

  it('fails for operational or database errors', () => {
    expect(classifyWingetSyncRun({ complete: true, failed: 1 })).toEqual({
      shouldFail: true,
      status: 'failed',
    });
  });

  it('fails when shard output is incomplete', () => {
    expect(classifyWingetSyncRun({ complete: false })).toEqual({
      shouldFail: true,
      status: 'failed',
    });
  });
});
