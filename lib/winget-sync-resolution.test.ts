import { describe, expect, it, vi } from 'vitest';
import {
  WingetSyncOperationalError,
  manifestReleaseDate,
  canSkipStoredManifest,
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

  it('uses the authenticated Contents API before the anonymous raw endpoint', async () => {
    const yaml = [
      'PackageIdentifier: Example.App',
      'PackageVersion: 1.0.0',
      'ManifestType: installer',
      'Installers:',
      '- Architecture: x64',
      '  InstallerUrl: https://example.test/app.exe',
    ].join('\n');
    const apiPayload = JSON.stringify({
      encoding: 'base64',
      content: Buffer.from(yaml).toString('base64'),
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(apiPayload, { status: 200 }));
    const client = createWingetManifestClient({ token: 'secret-token', fetchImpl, maxRetries: 0 });

    await expect(resolveWingetManifest({ client, wingetId: 'Example.App', storedVersion: '1.0.0' }))
      .resolves.toMatchObject({ status: 'resolved', version: '1.0.0' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('https://api.github.com/');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-token');
  });

  it('treats exhausted rate limits as operational errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const client = createWingetManifestClient({ fetchImpl, maxRetries: 0 });

    await expect(resolveWingetManifest({ client, wingetId: 'Example.App', storedVersion: '1.0.0' }))
      .rejects.toMatchObject({ name: 'WingetSyncOperationalError', code: 'HTTP_429' });
  });

  it('falls back to the anonymous GitHub quota when the application token is exhausted', async () => {
    const yaml = [
      'PackageIdentifier: Example.App',
      'PackageVersion: 1.0.0',
      'ManifestType: installer',
      'Installers:',
      '- Architecture: x64',
      '  InstallerUrl: https://example.test/app.exe',
    ].join('\n');
    const apiPayload = JSON.stringify({
      encoding: 'base64',
      content: Buffer.from(yaml).toString('base64'),
    });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
      }))
      .mockResolvedValueOnce(new Response(apiPayload, { status: 200 }));
    const client = createWingetManifestClient({ token: 'secret-token', fetchImpl, maxRetries: 0 });

    await expect(resolveWingetManifest({ client, wingetId: 'Example.App', storedVersion: '1.0.0' }))
      .resolves.toMatchObject({ status: 'resolved', version: '1.0.0' });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer secret-token');
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBeUndefined();
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


describe('bulk manifest sync', () => {
  it('uses raw files with a token without spending Contents API quota', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('PackageIdentifier: Example.App\nPackageVersion: 2.0\nInstallers: []'));
    const client = createWingetManifestClient({ fetchImpl, token: 'test-token', preferRaw: true });
    await client.fetchInstallerManifest('Example.App', '2.0');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('raw.githubusercontent.com');
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });
  it('skips stored versions only for incremental syncs with complete descriptions', () => {
    const input = { mode: 'incremental', forceRefresh: false, version: '1', hasVersion: true, description: 'App' };
    expect(canSkipStoredManifest(input)).toBe(true);
    for (const override of [{ mode: 'all' }, { forceRefresh: true }, { hasVersion: false }, { description: null }]) {
      expect(canSkipStoredManifest({ ...input, ...override })).toBe(false);
    }
  });
  it('preserves publisher calendar dates and rejects invalid dates', () => {
    expect(manifestReleaseDate({ ReleaseDate: '2026-09-05' })).toBe('2026-09-05T00:00:00.000Z');
    expect(manifestReleaseDate({ Installers: [{ ReleaseDate: '2026-09-04' }] })).toBe('2026-09-04T00:00:00.000Z');
    expect(manifestReleaseDate({ ReleaseDate: '2026-02-30' })).toBeNull();
    expect(manifestReleaseDate({ ReleaseDate: 'yesterday' })).toBeNull();
    expect(manifestReleaseDate({})).toBeNull();
  });
});
