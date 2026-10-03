import { describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from './definitions';
import { candidateFromMetadata, discoverCandidate } from './discovery.mjs';

const app = (id: string) => CURATED_APPS.find(app => app.id === id)!;
describe('vendor metadata discovery', () => {
  it('selects the Firefox ESR x64 MSI independently of Winget', () => {
    const candidate = candidateFromMetadata(app('firefox-esr'), JSON.stringify({ FIREFOX_ESR: '140.2.0esr', LATEST_FIREFOX_VERSION: '999.0' }));
    expect(candidate.version).toBe('140.2.0');
    expect(candidate.installerUrl).toContain('/140.2.0esr/win64/en-US/');
  });
  it('selects the VS Code system stable installer and vendor hash', () => {
    const candidate = candidateFromMetadata(app('vscode'), JSON.stringify({ productVersion: '1.100.0',
      url: 'https://vscode.download.prss.microsoft.com/dbazure/download/stable/commit/VSCodeSetup-x64.exe', sha256hash: 'a'.repeat(64) }));
    expect(candidate.vendorSha256).toBe('a'.repeat(64));
  });
  it('reads a versioned PuTTY filename from the publisher latest directory', () => {
    expect(candidateFromMetadata(app('putty'), '<a href="https://the.earth.li/~sgtatham/putty/latest/w64/putty-64bit-0.84-installer.msi">Windows x64</a>').version).toBe('0.84');
    expect(() => candidateFromMetadata(app('putty'), '<a href="https://the.earth.li/~sgtatham/putty/0.83/w64/putty-64bit-0.84-installer.msi">Windows x64</a>')).toThrow(/differs/);
  });
  it('parses WinSCP and VLC text feeds', () => {
    expect(candidateFromMetadata(app('winscp'), 'version=6.5.7.0\n').version).toBe('6.5.7');
    expect(candidateFromMetadata(app('vlc'), '3.0.24\nhttp://ignored-mirror.test/vlc.exe').installerUrl)
      .toBe('https://downloads.videolan.org/pub/videolan/vlc/3.0.24/win64/vlc-3.0.24-win64.exe');
  });
  it('accepts exactly one stable GitHub installer with an allowed source', () => {
    const metadata = { tag_name: 'v2.50.0.windows.1', html_url: 'https://github.com/git-for-windows/git/releases/tag/v2.50.0.windows.1',
      assets: [{ name: 'Git-2.50.0-64-bit.exe', browser_download_url: 'https://github.com/git-for-windows/git/releases/download/v2.50.0.windows.1/Git-2.50.0-64-bit.exe', digest: `sha256:${'a'.repeat(64)}` }] };
    expect(candidateFromMetadata(app('git'), JSON.stringify(metadata)).version).toBe('2.50.0');
    expect(() => candidateFromMetadata(app('git'), JSON.stringify({ ...metadata, prerelease: true }))).toThrow(/stable/);
    expect(() => candidateFromMetadata(app('git'), JSON.stringify({ ...metadata, assets: [...metadata.assets, ...metadata.assets] }))).toThrow(/one reviewed/);
  });
  it('never downloads installers or silently approves discovery candidates', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ versions: [{ version: '140.0.0.0' }] }), { headers: { 'content-type': 'application/json' } }));
    const result = await discoverCandidate(app('chrome'), fetcher);
    expect(result.state).toBe('candidate');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(app('chrome').releaseSource, expect.objectContaining({ redirect: 'error' }));
    expect(result).not.toHaveProperty('approvedAt');
  });
  it('allows VLC text metadata despite its vendor MIME type', async () => {
    const fetcher = vi.fn(async () => new Response('3.0.24\n', { headers: { 'content-type': 'application/octet-stream' } }));
    expect((await discoverCandidate(app('vlc'), fetcher)).state).toBe('candidate');
    await expect(discoverCandidate(app('chrome'), fetcher)).rejects.toThrow(/text metadata/);
  });
  it('rejects oversized responses without trusting content-length', async () => {
    const fetcher = vi.fn(async () => new Response('a'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/plain' } }));
    await expect(discoverCandidate(app('chrome'), fetcher)).rejects.toThrow(/limit/);
  });
  it('leaves full Adobe installer selection to an explicit source review', async () => {
    const fetcher = vi.fn();
    expect((await discoverCandidate(app('acrobat-reader'), fetcher)).state).toBe('manual');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
