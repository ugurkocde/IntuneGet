import { describe, expect, it, vi } from 'vitest';
import { detectWingetChanges, wingetIdFromManifestPath } from './winget-changes';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

describe('wingetIdFromManifestPath', () => {
  it('extracts installer and singleton manifest package ids', () => {
    expect(
      wingetIdFromManifestPath('manifests/g/Google/Chrome/152.0/Google.Chrome.installer.yaml')
    ).toBe('Google.Chrome');
    expect(wingetIdFromManifestPath('manifests/v/VideoLAN/VLC/4.0/VideoLAN.VLC.yaml')).toBe(
      'VideoLAN.VLC'
    );
  });

  it('ignores locale and non-manifest paths', () => {
    expect(
      wingetIdFromManifestPath('manifests/g/Google/Chrome/152.0/Google.Chrome.locale.en-US.yaml')
    ).toBeNull();
    expect(wingetIdFromManifestPath('README.md')).toBeNull();
  });
});

describe('detectWingetChanges', () => {
  it('compares a durable cursor and returns unique changed package ids', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ sha: HEAD }]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'ahead',
            total_commits: 2,
            files: [
              { status: 'added', filename: 'manifests/g/Google/Chrome/2/Google.Chrome.installer.yaml' },
              { status: 'modified', filename: 'manifests/g/Google/Chrome/2/Google.Chrome.yaml' },
              { status: 'removed', filename: 'manifests/o/Old/App/1/Old.App.installer.yaml' },
            ],
          }),
          { status: 200 }
        )
      );

    await expect(detectWingetChanges({ baseSha: BASE, fetchImpl })).resolves.toMatchObject({
      baseSha: BASE,
      headSha: HEAD,
      changedFiles: 3,
      changedPackageIds: ['Google.Chrome'],
      initialized: false,
    });
  });

  it('uses a bounded lookback when no cursor exists', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ sha: HEAD }]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ sha: HEAD, parents: [{ sha: BASE }] }]), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'ahead',
            total_commits: 1,
            files: [
              { status: 'added', filename: 'manifests/m/Mozilla/Firefox/2/Mozilla.Firefox.yaml' },
            ],
          }),
          { status: 200 }
        )
      );

    const changes = await detectWingetChanges({ since: '2026-08-08T00:00:00Z', fetchImpl });
    expect(changes.initialized).toBe(true);
    expect(changes.changedPackageIds).toEqual(['Mozilla.Firefox']);
  });

  it('refuses to advance a truncated comparison', async () => {
    const files = Array.from({ length: 300 }, (_, index) => ({
      status: 'modified',
      filename: `manifests/e/Example/App/${index}/Example.App.yaml`,
    }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ sha: HEAD }]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'ahead', total_commits: 10, files }), { status: 200 })
      );

    await expect(detectWingetChanges({ baseSha: BASE, fetchImpl })).rejects.toThrow(
      'compare limits'
    );
  });
});
