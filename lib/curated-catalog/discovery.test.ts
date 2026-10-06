import { describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from './definitions';
import { candidateFromMetadata, discoverCandidate, discoverPreviousCandidate, vendorSha256FromChecksums } from './discovery.mjs';

describe('next five publisher-sourced additions',()=>{
  it('discovers Firefox Stable separately from ESR and binds its checksum',()=>{
    const candidate=candidateFromMetadata(app('firefox'),JSON.stringify({LATEST_FIREFOX_VERSION:'157.0.1',FIREFOX_ESR:'140.17.0esr'}),new Date(),pin('a')+'  win64/en-US/Firefox Setup 157.0.1.msi');
    expect(candidate.version).toBe('157.0.1');
    expect(candidate.vendorSha256).toBe(pin('a'));
    expect(candidate.installerUrl).not.toContain('esr');
  });
  it('recognizes Audacity publisher tags and only selects the x86_64 MSI',()=>{
    const candidate=candidateFromMetadata(app('audacity'),JSON.stringify({tag_name:'Audacity-4.0.1',html_url:'https://github.com/audacity/audacity/releases/tag/Audacity-4.0.1',assets:[{name:'audacity-win-4.0.1-x86_64.msi',browser_download_url:'https://github.com/audacity/audacity/releases/download/Audacity-4.0.1/audacity-win-4.0.1-x86_64.msi',digest:'sha256:'+pin('b')}]}));
    expect(candidate.version).toBe('4.0.1');expect(candidate.vendorSha256).toBe(pin('b'));
  });
  it('retains the PowerShell LTS MSI channel when a newer major/minor is released',()=>{
    const release=(v:string)=>({tag_name:'v'+v,html_url:'https://github.com/PowerShell/PowerShell/releases/tag/v'+v,assets:[{name:'PowerShell-'+v+'-win-x64.msi',browser_download_url:'https://github.com/PowerShell/PowerShell/releases/download/v'+v+'/PowerShell-'+v+'-win-x64.msi',digest:'sha256:'+pin('c')}]});
    const candidate=candidateFromMetadata(app('powershell-lts'),JSON.stringify([release('7.7.0'),release('7.6.6'),{...release('7.6.7'),prerelease:true}]));
    expect(candidate.version).toBe('7.6.6');
  });
  it('finds the LTS release and upgrade baseline beyond the first GitHub page',async()=>{
    const release=(v:string)=>({tag_name:'v'+v,html_url:'https://github.com/PowerShell/PowerShell/releases/tag/v'+v,assets:[{name:'PowerShell-'+v+'-win-x64.msi',browser_download_url:'https://github.com/PowerShell/PowerShell/releases/download/v'+v+'/PowerShell-'+v+'-win-x64.msi',digest:'sha256:'+pin('c')}]});
    const pages=[...Array.from({length:3},(_,page)=>Array.from({length:10},(_,i)=>release('7.7.'+(page*10+i)))),
      [release('7.6.6'),...Array.from({length:9},(_,i)=>release('7.7.'+(i+30)))],
      [release('7.6.5')]];
    const fetcher=vi.fn(async(url:string)=>{
      const page=Number(new URL(url).searchParams.get('page')||1);
      return text(JSON.stringify(pages[page-1]),'application/json');
    });
    const result=await discoverCandidate(app('powershell-lts'),fetcher);
    expect(result.state).toBe('candidate');
    if(result.state!=='candidate')throw new Error('Expected candidate');
    expect(result.candidate.version).toBe('7.6.6');
    expect(fetcher).toHaveBeenCalledTimes(5);
    fetcher.mockClear();
    expect((await discoverPreviousCandidate(app('powershell-lts'),result.candidate,fetcher))?.version).toBe('7.6.5');
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.every(([url])=>new URL(url).origin==='https://api.github.com' && new URL(url).searchParams.get('per_page')==='10')).toBe(true);
  });
  it('fails closed when the LTS channel remains beyond the bounded page limit',async()=>{
    const fetcher=vi.fn(async()=>text(JSON.stringify(Array.from({length:10},()=>({tag_name:'v7.7.0',assets:[]}))),'application/json'));
    await expect(discoverCandidate(app('powershell-lts'),fetcher)).rejects.toThrow(/bounded discovery limit/);
    expect(fetcher).toHaveBeenCalledTimes(20);
  });
  it('binds Zoom download builds to the MSI product version and versioned x64 payload',()=>{
    const candidate=candidateFromMetadata(app('zoom'),JSON.stringify({status:true,result:{downloadVO:{zoomX64:{version:'7.2.1.48556',archType:'x64',packageNameForIT:'ZoomInstallerFull.msi'}}}}));
    expect(candidate.version).toBe('7.2.48556');
    expect(candidate.installerUrl).toBe('https://cdn.zoom.us/prod/7.2.1.48556/x64/ZoomInstallerFull.msi');
  });
  it('selects the latest AWS v2 tag and constructs an immutable all-users MSI URL',()=>{
    const candidate=candidateFromMetadata(app('aws-cli'),JSON.stringify([{name:'2.37.8'},{name:'2.37.9'},{name:'3.0.0'},{name:'2.38.0rc1'}]));
    expect(candidate.version).toBe('2.37.9');expect(candidate.installerUrl).toBe('https://awscli.amazonaws.com/AWSCLIV2-2.37.9.msi');
  });
  it('reuses the reviewed Zoom publisher baseline for first-release upgrade QA',async()=>{
    const current=candidateFromMetadata(app('zoom'),JSON.stringify({status:true,result:{downloadVO:{zoomX64:{version:'7.2.1.48556',archType:'x64',packageNameForIT:'ZoomInstallerFull.msi'}}}}));
    const fetcher=vi.fn(async(_url:string,options:RequestInit)=>{expect(options.method).toBe('HEAD');return new Response(null,{status:200});});
    const previous=await discoverPreviousCandidate(app('zoom'),current,fetcher);
    expect(previous?.version).toBe('7.1.41345');expect(previous?.installerUrl).toContain('/7.1.0.41345/x64/');
  });
});


const app = (id: string) => CURATED_APPS.find(app => app.id === id)!;
const pin = (char: string) => char.repeat(64);
const text = (body: string, contentType: string | null = 'text/plain') => new Response(body, { headers: contentType ? { 'content-type': contentType } : {} });
// Routes synthetic vendor responses by exact URL; any other request fails the test.
const routed = (routes: Record<string, () => Response>) => vi.fn(async (url: string) => {
  if (!routes[url]) throw new Error(`Unexpected request ${url}`);
  return routes[url]();
});
const VLC_SUMS = 'https://downloads.videolan.org/pub/videolan/vlc/3.0.24/win64/vlc-3.0.24-win64.exe.sha256';
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
  it('discovers PuTTY from the official archive using only one constrained metadata redirect', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/~sgtatham/putty/0.85/w64/' } }))
      .mockResolvedValueOnce(new Response('<h1>Index of /~sgtatham/putty/0.85/w64</h1><a href="putty-64bit-0.85-installer.msi">MSI</a>', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(text(`${pin('1')}  w32/putty-0.85-installer.msi\n${pin('2')}  w64/putty-64bit-0.85-installer.msi\n`, null));
    const result = await discoverCandidate(app('putty'), fetcher);
    expect(result.state).toBe('candidate');
    if (result.state === 'candidate') {
      expect(result.candidate.installerUrl).toBe('https://the.earth.li/~sgtatham/putty/0.85/w64/putty-64bit-0.85-installer.msi');
      expect(result.candidate.vendorSha256).toBe(pin('2'));
    }
    expect(fetcher.mock.calls[1][0]).toBe('https://the.earth.li/~sgtatham/putty/0.85/w64/');
    expect(fetcher.mock.calls[2]).toEqual(['https://the.earth.li/~sgtatham/putty/0.85/sha256sums', expect.objectContaining({ redirect: 'error' })]);
    expect(fetcher.mock.calls.every(call => !String(call[0]).endsWith('.msi'))).toBe(true);
  });
  it('rejects archive redirects to an installer or another host', async () => {
    for (const location of ['https://evil.example/w64/', '/~sgtatham/putty/0.85/w64/putty-64bit-0.85-installer.msi']) {
      const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location } }));
      await expect(discoverCandidate(app('putty'), fetcher)).rejects.toThrow(/metadata redirect/);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    expect(() => candidateFromMetadata(app('putty'), '<h1>Index of /~sgtatham/putty/0.84/w64</h1><a href="putty-64bit-0.85-installer.msi">MSI</a>')).toThrow(/matching versioned/);
  });
  it('selects the fully rolled out Chrome release instead of a staged cohort', () => {
    const releases = [{ version: '154.0.8037.93', fraction: 0.495 }, { version: '154.0.8037.98', fraction: 1 },
      { version: '155.0.8059.26', fraction: 0.005 }, { version: '154.0.8037.100', fraction: 1 }];
    expect(candidateFromMetadata(app('chrome'), JSON.stringify({ releases })).version).toBe('154.0.8037.100');
    expect(() => candidateFromMetadata(app('chrome'), JSON.stringify({ releases: releases.filter(release => release.fraction < 1) }))).toThrow(/fully rolled out/);
    expect(() => candidateFromMetadata(app('chrome'), JSON.stringify({ releases, nextPageToken: 'next' }))).toThrow(/more than one page/);
  });
  it('parses WinSCP and VLC text feeds', () => {
    expect(candidateFromMetadata(app('winscp'), 'version=6.5.7.0\n').version).toBe('6.5.7');
    const vlc = candidateFromMetadata(app('vlc'), '3.0.24\nhttp://ignored-mirror.test/vlc.exe', new Date(), `${pin('C')}  vlc-3.0.24-win64.exe\n`);
    expect(vlc.installerUrl).toBe('https://downloads.videolan.org/pub/videolan/vlc/3.0.24/win64/vlc-3.0.24-win64.exe');
    expect(vlc.vendorSha256).toBe(pin('c'));
    // VideoLAN publishes binary-mode lines ('<hash> *<file>').
    expect(candidateFromMetadata(app('vlc'), '3.0.24\n', new Date(), `${pin('D')} *vlc-3.0.24-win64.exe\r\n`).vendorSha256).toBe(pin('d'));
    expect(() => candidateFromMetadata(app('vlc'), '3.0.24\n')).toThrow(/SHA256 pin/);
  });
  it('reads only the publisher SHA256 line for the exact candidate installer', () => {
    const firefox = 'https://archive.mozilla.org/pub/firefox/releases/140.17.0esr/win64/en-US/Firefox%20Setup%20140.17.0esr.msi';
    const sums = `${pin('1')}  win64/en-US/Firefox Setup 140.17.0esr.exe\n${pin('2')}  win64/en-US/Firefox Setup 140.17.0esr.msi\n${pin('3')}  win64/de/Firefox Setup 140.17.0esr.msi\n`;
    expect(vendorSha256FromChecksums(app('firefox-esr'), firefox, '140.17.0', sums)).toBe(pin('2'));
    expect(() => vendorSha256FromChecksums(app('firefox-esr'), firefox, '140.17.0', sums.replace('140.17.0esr.msi', '140.16.0esr.msi'))).toThrow(/found 0/);
    expect(() => vendorSha256FromChecksums(app('firefox-esr'), firefox, '140.17.0', `${sums}${pin('4')}  win64/en-US/Firefox Setup 140.17.0esr.msi\n`)).toThrow(/found 2/);
    expect(() => vendorSha256FromChecksums(app('firefox-esr'), firefox, '140.16.0', sums)).toThrow(/does not name the candidate/);
    const readMe = `WinSCP-6.5.7-Setup.exe\n - MD5: ${'d'.repeat(32)}\n - SHA-256: ${pin('A')}\n - Installation package\n\nWinSCP-6.5.7-Portable.zip\n - SHA-256: ${pin('b')}\n`;
    const winscp = 'https://downloads.sourceforge.net/project/winscp/WinSCP/6.5.7/WinSCP-6.5.7-Setup.exe';
    expect(vendorSha256FromChecksums(app('winscp'), winscp, '6.5.7', readMe)).toBe(pin('a'));
    expect(() => vendorSha256FromChecksums(app('winscp'), winscp, '6.5.7', readMe.replace('WinSCP-6.5.7-Setup.exe', 'WinSCP-6.5.6-Setup.exe'))).toThrow(/found 0/);
  });
  it('pins VLC discovery to the .sha256 file beside the official installer', async () => {
    const fetcher = routed({ [app('vlc').releaseSource]: () => text('3.0.24\n', 'application/octet-stream'),
      [VLC_SUMS]: () => text(`${pin('e')}  vlc-3.0.24-win64.exe\n`, 'application/octet-stream') });
    const result = await discoverCandidate(app('vlc'), fetcher);
    expect(result.state === 'candidate' && result.candidate.vendorSha256).toBe(pin('e'));
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([app('vlc').releaseSource, VLC_SUMS]);
  });
  it('fails VLC discovery when no publisher pin can be obtained', async () => {
    for (const [sums, error] of [[() => new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } }), /HTTP 404/],
      [() => text(`${pin('e')}  vlc-3.0.23-win64.exe\n`), /found 0/], [() => text(`${pin('e')}  vlc-3.0.24-win64.exe\n`, 'application/x-msdownload'), /text checksum/],
      [() => text(`MZ\0\0${pin('e')}  vlc-3.0.24-win64.exe\n`, 'application/octet-stream'), /not text/], [() => text('a'.repeat(1024 * 1024 + 1)), /limit/]] as const) {
      const fetcher = routed({ [app('vlc').releaseSource]: () => text('3.0.24\n', 'application/octet-stream'), [VLC_SUMS]: sums });
      await expect(discoverCandidate(app('vlc'), fetcher)).rejects.toThrow(error);
    }
    const unreachable = routed({ [app('vlc').releaseSource]: () => text('3.0.24\n', 'application/octet-stream') });
    await expect(discoverCandidate(app('vlc'), unreachable)).rejects.toThrow(/Unexpected request/);
  });
  it('accepts exactly one stable GitHub installer with an allowed source', () => {
    const metadata = { tag_name: 'v2.50.0.windows.1', html_url: 'https://github.com/git-for-windows/git/releases/tag/v2.50.0.windows.1',
      assets: [{ name: 'Git-2.50.0-64-bit.exe', browser_download_url: 'https://github.com/git-for-windows/git/releases/download/v2.50.0.windows.1/Git-2.50.0-64-bit.exe', digest: `sha256:${'a'.repeat(64)}` }] };
    expect(candidateFromMetadata(app('git'), JSON.stringify(metadata)).version).toBe('2.50.0');
    expect(() => candidateFromMetadata(app('git'), JSON.stringify({ ...metadata, prerelease: true }))).toThrow(/stable/);
    expect(() => candidateFromMetadata(app('git'), JSON.stringify({ ...metadata, assets: [...metadata.assets, ...metadata.assets] }))).toThrow(/one reviewed/);
  });
  it('never downloads installers or silently approves discovery candidates', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ releases: [{ version: '140.0.0.0', fraction: 1 }] }), { headers: { 'content-type': 'application/json' } }));
    const result = await discoverCandidate(app('chrome'), fetcher);
    expect(result.state).toBe('candidate');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(app('chrome').releaseSource, expect.objectContaining({ redirect: 'error' }));
    expect(result).not.toHaveProperty('approvedAt');
  });
  it('fetches only metadata and checksum text for pinned apps, never installers', async () => {
    const fixtures = {
      'firefox-esr': [JSON.stringify({ FIREFOX_ESR: '140.17.0esr' }), 'https://archive.mozilla.org/pub/firefox/releases/140.17.0esr/SHA256SUMS', `${pin('1')}  win64/en-US/Firefox Setup 140.17.0esr.msi\n`],
      vlc: ['3.0.24\n', VLC_SUMS, `${pin('2')}  vlc-3.0.24-win64.exe\n`],
      winscp: ['version=6.5.7.0\n', 'https://winscp.net/download/WinSCP-6.5.7-ReadMe.txt', `WinSCP-6.5.7-Setup.exe\n - SHA-256: ${pin('3')}\n`],
    } as const;
    for (const [id, [metadata, sumsUrl, sums]] of Object.entries(fixtures)) {
      const fetcher = routed({ [app(id).releaseSource]: () => text(metadata), [sumsUrl]: () => text(sums) });
      const result = await discoverCandidate(app(id), fetcher);
      expect(result.state === 'candidate' && result.candidate.vendorSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(fetcher.mock.calls.every(call => call[1]?.redirect === 'error' && !/\.(?:msi|exe)$/i.test(new URL(call[0]).pathname))).toBe(true);
      expect(result).not.toHaveProperty('approvedAt');
    }
  });
  it('allows VLC text metadata despite its vendor MIME type', async () => {
    const fetcher = routed({ [app('vlc').releaseSource]: () => text('3.0.24\n', 'application/octet-stream'),
      [VLC_SUMS]: () => text(`${pin('e')}  vlc-3.0.24-win64.exe\n`, 'application/octet-stream'),
      [app('chrome').releaseSource]: () => text('{}', 'application/octet-stream') });
    expect((await discoverCandidate(app('vlc'), fetcher)).state).toBe('candidate');
    await expect(discoverCandidate(app('chrome'), fetcher)).rejects.toThrow(/text metadata/);
  });
  it('rejects oversized responses without trusting content-length', async () => {
    const fetcher = vi.fn(async () => new Response('a'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/plain' } }));
    await expect(discoverCandidate(app('chrome'), fetcher)).rejects.toThrow(/limit/);
  });
  it('selects the full Adobe x64 installer for the reported version and confirms it exists without downloading it', async () => {
    const installer = 'https://ardownload2.adobe.com/pub/adobe/acrobat/win/AcrobatDC/2600221931/AcroRdrDCx642600221931_en_US.exe';
    const head = vi.fn(() => new Response(null, { status: 200 }));
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === app('acrobat-reader').releaseSource) return text(JSON.stringify({ products: { reader: [{ version: '26.002.21931' }] } }), 'application/json');
      if (url === installer && init?.method === 'HEAD') return head();
      throw new Error(`Unexpected request ${url}`);
    });
    const result = await discoverCandidate(app('acrobat-reader'), fetcher);
    expect(result.state === 'candidate' && result.candidate.installerUrl).toBe(installer);
    expect(head).toHaveBeenCalledOnce();
    head.mockReturnValueOnce(new Response(null, { status: 404 }));
    await expect(discoverCandidate(app('acrobat-reader'), fetcher)).rejects.toThrow(/no full installer/);
  });
  it('rejects ambiguous Adobe release metadata', () => {
    expect(() => candidateFromMetadata(app('acrobat-reader'), JSON.stringify({ products: { reader: [{ version: '26.002.21931' }, { version: '26.002.21932' }] } }))).toThrow(/exactly one/);
    expect(() => candidateFromMetadata(app('acrobat-reader'), JSON.stringify({ products: { reader: [] } }))).toThrow(/exactly one/);
  });
  it('finds the newest earlier stable GitHub release for the upgrade test', async () => {
    const release = (tag: string, extra: Record<string, unknown> = {}) => ({ tag_name: tag, draft: false, prerelease: false, html_url: `https://github.com/ip7z/7zip/releases/tag/${tag}`,
      assets: [{ name: `7z${tag.replace('.', '')}-x64.msi`, browser_download_url: `https://github.com/ip7z/7zip/releases/download/${tag}/7z${tag.replace('.', '')}-x64.msi`, digest: `sha256:${pin(tag.at(-1)!)}` }], ...extra });
    const fetcher = routed({ 'https://api.github.com/repos/ip7z/7zip/releases?per_page=10': () => text(JSON.stringify([
      release('26.04', { prerelease: true }), release('26.03'), release('26.01'), release('26.02'),
    ]), 'application/json') });
    const current = candidateFromMetadata(app('7zip'), JSON.stringify(release('26.03')));
    const previous = await discoverPreviousCandidate(app('7zip'), current, fetcher);
    expect(previous?.version).toBe('26.02');
    expect(previous?.vendorSha256).toBe(pin('2'));
  });
  it('steps PuTTY back one minor version in the official archive', async () => {
    const fetcher = routed({
      'https://the.earth.li/~sgtatham/putty/0.84/w64/': () => new Response('<h1>Index of /~sgtatham/putty/0.84/w64</h1><a href="putty-64bit-0.84-installer.msi">MSI</a>', { headers: { 'content-type': 'text/html' } }),
      'https://the.earth.li/~sgtatham/putty/0.84/sha256sums': () => text(`${pin('4')}  w64/putty-64bit-0.84-installer.msi\n`, null),
    });
    const current = candidateFromMetadata(app('putty'), '<a href="https://the.earth.li/~sgtatham/putty/0.85/w64/putty-64bit-0.85-installer.msi">x64</a>');
    const previous = await discoverPreviousCandidate(app('putty'), current, fetcher);
    expect(previous?.version).toBe('0.84');
    expect(previous?.vendorSha256).toBe(pin('4'));
  });
  it('offers no earlier installer for sources without immutable history', async () => {
    const fetcher = vi.fn();
    const current = candidateFromMetadata(app('firefox-esr'), JSON.stringify({ FIREFOX_ESR: '140.2.0esr' }));
    expect(await discoverPreviousCandidate(app('firefox-esr'), current, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
