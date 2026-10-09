import { describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from './definitions';
import { validateDefinitions } from './core.mjs';
import { candidateFromMetadata, discoverCandidate, discoverPreviousCandidate } from './discovery.mjs';

const app = (id: string) => CURATED_APPS.find(value => value.id === id)!;
const pin = (c: string) => c.repeat(64);
const metadata = (body: string) => new Response(body, { headers: { 'content-type': 'text/plain' } });
const goFile = (version: string, overrides: Record<string, unknown> = {}) => ({ filename: `${version}.windows-amd64.msi`, os: 'windows', arch: 'amd64', kind: 'installer', sha256: pin('a'), ...overrides });
const goIndex = JSON.stringify([
  { version: 'go1.28rc1', stable: false, files: [goFile('go1.28rc1')] },
  { version: 'go1.27.1', stable: true, files: [goFile('go1.27.1', { arch: 'arm64', filename: 'go1.27.1.windows-arm64.msi' }), goFile('go1.27.1')] },
  { version: 'go1.26.8', stable: true, files: [goFile('go1.26.8', { sha256: pin('b') })] },
]);
const libreOfficePage = ['25.8.7', '26.2.6', '26.8.0', '26.8.1'].map(version => `<a href="${version}/">${version}/</a>`).join('\n');
const libreOfficeSum = (version: string) => `${pin('c')}  LibreOffice_${version}_Win_x86-64.msi`;
const githubRelease = (tag: string, assets: string[]) => ({ tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/r/${tag}`, assets: assets.map(name => ({ name, digest: `sha256:${pin('d')}`, browser_download_url: name })) });

describe('curated catalog expansion to fifty applications', () => {
  it('defines thirty more machine-wide applications with unique identities', () => {
    const apps = validateDefinitions(CURATED_APPS);
    expect(apps).toHaveLength(50);
    expect(new Set(apps.map(value => value.packageId.toLowerCase())).size).toBe(50);
    expect(apps.every(value => value.scope === 'machine')).toBe(true);
  });

  it('selects the stable Go x64 MSI with its publisher hash and ignores release candidates', () => {
    const result = candidateFromMetadata(app('go'), goIndex);
    expect(result.version).toBe('1.27.1');
    expect(result.installerUrl).toBe('https://dl.google.com/go/go1.27.1.windows-amd64.msi');
    expect(result.vendorSha256).toBe(pin('a'));
  });

  it('rejects a Go release without a hash-pinned x64 MSI', () => {
    const index = JSON.stringify([{ version: 'go1.27.1', stable: true, files: [goFile('go1.27.1', { sha256: '' })] }]);
    expect(() => candidateFromMetadata(app('go'), index)).toThrow(/no reviewed/);
  });

  it('uses the previous supported Go minor release for upgrade QA', async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (options.method === 'HEAD') { expect(url).toBe('https://dl.google.com/go/go1.26.8.windows-amd64.msi'); return new Response(null, { status: 200 }); }
      return new Response(goIndex, { headers: { 'content-type': 'application/json' } });
    });
    const previous = await discoverPreviousCandidate(app('go'), candidateFromMetadata(app('go'), goIndex), fetcher);
    expect(previous?.version).toBe('1.26.8');
    expect(previous?.vendorSha256).toBe(pin('b'));
  });

  it('selects the newest LibreOffice stable release and pins the publisher checksum', () => {
    const result = candidateFromMetadata(app('libreoffice'), libreOfficePage, new Date(), libreOfficeSum('26.8.1'));
    expect(result.version).toBe('26.8.1');
    expect(result.installerUrl).toBe('https://download.documentfoundation.org/libreoffice/stable/26.8.1/win/x86_64/LibreOffice_26.8.1_Win_x86-64.msi');
    expect(result.vendorSha256).toBe(pin('c'));
  });

  it('proves the earlier LibreOffice release by checksum without following a mirror redirect', async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(options.method).not.toBe('HEAD');
      if (url === app('libreoffice').releaseSource) return metadata(libreOfficePage);
      expect(url).toBe('https://download.documentfoundation.org/libreoffice/stable/26.8.0/win/x86_64/LibreOffice_26.8.0_Win_x86-64.msi.sha256');
      return metadata(libreOfficeSum('26.8.0'));
    });
    const current = candidateFromMetadata(app('libreoffice'), libreOfficePage, new Date(), libreOfficeSum('26.8.1'));
    const previous = await discoverPreviousCandidate(app('libreoffice'), current, fetcher);
    expect(previous?.version).toBe('26.8.0');
    expect(previous?.vendorSha256).toBe(pin('c'));
  });

  it('selects the stable Thunderbird MSI and its earlier major release', async () => {
    const versions = JSON.stringify({ LATEST_THUNDERBIRD_VERSION: '157.0.1', THUNDERBIRD_ESR: '140.17.0esr' });
    const current = candidateFromMetadata(app('thunderbird'), versions, new Date(), `${pin('e')}  win64/en-US/Thunderbird Setup 157.0.1.msi`);
    expect(current.installerUrl).toBe('https://archive.mozilla.org/pub/thunderbird/releases/157.0.1/win64/en-US/Thunderbird%20Setup%20157.0.1.msi');
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'https://product-details.mozilla.org/1.0/thunderbird_history_major_releases.json') return new Response(JSON.stringify({ '156.0': '2026-09-15', '157.0': '2026-09-30' }), { headers: { 'content-type': 'application/json' } });
      expect(url).toBe('https://archive.mozilla.org/pub/thunderbird/releases/157.0/SHA256SUMS');
      return metadata(`${pin('f')}  win64/en-US/Thunderbird Setup 157.0.msi`);
    });
    const previous = await discoverPreviousCandidate(app('thunderbird'), current, fetcher);
    expect(previous?.version).toBe('157.0');
    expect(previous?.vendorSha256).toBe(pin('f'));
  });

  it('strips the WinDirStat release/ tag prefix and rejects unprefixed tags', () => {
    const release = { ...githubRelease('release/v2.9.2', []), assets: [{ name: 'WinDirStat-x64.msi', digest: `sha256:${pin('d')}`, browser_download_url: 'https://github.com/windirstat/windirstat/releases/download/release/v2.9.2/WinDirStat-x64.msi' }] };
    expect(candidateFromMetadata(app('windirstat'), JSON.stringify(release)).version).toBe('2.9.2');
    expect(() => candidateFromMetadata(app('windirstat'), JSON.stringify({ ...release, tag_name: 'v2.9.2' }))).toThrow(/unexpected prefix/);
    expect(() => validateDefinitions([{ ...app('windirstat'), releaseTagPrefix: 'release//' }])).toThrow(/tag prefix/);
  });

  it('retries a too-large GitHub release list with a smaller page', async () => {
    const vscodium = app('vscodium');
    const current = { appId: 'vscodium', version: '1.135.06055' };
    const asset = (version: string) => ({ name: `VSCodiumSetup-x64-${version}.exe`, digest: `sha256:${pin('d')}`, browser_download_url: `https://github.com/VSCodium/vscodium/releases/download/${version}/VSCodiumSetup-x64-${version}.exe` });
    const pages: string[] = [];
    const fetcher = vi.fn(async (url: string) => {
      pages.push(url);
      if (url.endsWith('per_page=10')) return new Response('[]', { headers: { 'content-type': 'application/json', 'content-length': String(3 * 1024 * 1024) } });
      return new Response(JSON.stringify([{ ...githubRelease('1.135.06055', []), assets: [asset('1.135.06055')] }, { ...githubRelease('1.134.01234', []), assets: [asset('1.134.01234')] }]), { headers: { 'content-type': 'application/json' } });
    });
    const previous = await discoverPreviousCandidate(vscodium, current as never, fetcher);
    expect(previous?.version).toBe('1.134.01234');
    expect(pages).toEqual([vscodium.releaseSource.replace('/releases/latest', '/releases?per_page=10'), vscodium.releaseSource.replace('/releases/latest', '/releases?per_page=3')]);
  });

  it('falls back to the reviewed calibre baseline when older GitHub releases have no installer', async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (options.method === 'HEAD') { expect(url).toBe('https://download.calibre-ebook.com/9.14.0/calibre-64bit-9.14.0.msi'); return new Response(null, { status: 200 }); }
      return new Response(JSON.stringify([githubRelease('v9.14.0', [])]), { headers: { 'content-type': 'application/json' } });
    });
    const previous = await discoverPreviousCandidate(app('calibre'), { appId: 'calibre', version: '9.15.0' } as never, fetcher);
    expect(previous?.version).toBe('9.14.0');
    expect(previous?.vendorSha256).toBeNull();
  });

  it('confirms the constructed Go installer exists using HEAD only', async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => options.method === 'HEAD' ? new Response(null, { status: 404 }) : new Response(goIndex, { headers: { 'content-type': 'application/json' } }));
    await expect(discoverCandidate(app('go'), fetcher)).rejects.toThrow(/no full installer/);
  });
});
