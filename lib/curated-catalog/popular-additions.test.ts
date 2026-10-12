import { describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from './definitions';
import { validateDefinitions } from './core.mjs';
import { candidateFromMetadata, discoverCandidate, discoverPreviousCandidate, vendorSha256FromChecksums } from './discovery.mjs';

const app = (id: string) => CURATED_APPS.find(value => value.id === id)!;
const pin = 'a'.repeat(64);
const metadata = (body: string) => new Response(body, { headers: { 'content-type': 'text/plain' } });
const pythonPage = (versions = ['3.14.8', '3.14.7']) => versions.map(version => `<a href="https://www.python.org/ftp/python/${version}/python-${version}-amd64.exe">Windows installer</a>`).join('\n');
const nodeIndex = JSON.stringify([
  { version: 'v26.10.0', lts: false, files: ['win-x64-msi'] },
  { version: 'v24.21.0', lts: 'Krypton', files: ['win-x64-msi'] },
  { version: 'v24.20.0', lts: 'Krypton', files: ['win-x64-msi'] },
  { version: 'v22.23.0', lts: 'Jod', files: ['win-x64-msi'] },
]);
const wiresharkPage = ['4.7.3', '4.6.9', '4.6.8', '4.4.19'].map(version => `<a href="https://2.na.dl.wireshark.org/win64/Wireshark-${version}-x64.exe">Download</a>`).join('\n');
const teamviewerPage = (filename = 'TeamViewer_Setup_x64.exe', url = 'https://download.teamviewer.com/download/TeamViewer_Setup_x64.exe') =>
  JSON.stringify({ operatingSystem: 'win', bitRate: '64-bit', versionNumber: '15.82.6', assetFileName: filename, downloadLink: url }).replaceAll('"', '&quot;');

describe('popular publisher-sourced curated additions', () => {
  it('selects the TeamViewer full x64 client from encoded publisher metadata', () => {
    const result = candidateFromMetadata(app('teamviewer'), teamviewerPage() + teamviewerPage('TeamViewerQS_x64.exe'));
    expect(result.version).toBe('15.82.6');
    expect(result.installerUrl).toContain('/TeamViewer_Setup_x64.exe');
    expect(result.vendorSha256).toBeNull();
  });

  it('rejects QuickSupport and a forged TeamViewer installer origin', () => {
    expect(() => candidateFromMetadata(app('teamviewer'), teamviewerPage('TeamViewerQS_x64.exe'))).toThrow(/no reviewed/);
    expect(() => candidateFromMetadata(app('teamviewer'), teamviewerPage('TeamViewer_Setup_x64.exe', 'https://attacker.test/setup.exe'))).toThrow(/not approved/);
  });

  it('rejects conflicting TeamViewer URLs for the advertised release', () => {
    expect(() => candidateFromMetadata(app('teamviewer'), teamviewerPage() + teamviewerPage('TeamViewer_Setup_x64.exe', 'https://dl.teamviewer.com/download/TeamViewer_Setup_x64.exe'))).toThrow(/conflicting/);
  });

  it('selects only a stable Python 3.14 x64 offline installer', () => {
    const page = pythonPage(['3.15.0', '3.14.8rc1', '3.14.8', '3.14.7']) + '<a href="https://www.python.org/ftp/python/3.14.9/python-3.14.9-arm64.exe">ARM</a>';
    const result = candidateFromMetadata(app('python-314'), page);
    expect(result.version).toBe('3.14.8');
    expect(result.installerUrl).toBe('https://www.python.org/ftp/python/3.14.8/python-3.14.8-amd64.exe');
  });

  it('rejects a Python filename whose release differs from its directory', () => {
    expect(() => candidateFromMetadata(app('python-314'), '<a href="https://www.python.org/ftp/python/3.14.8/python-3.14.7-amd64.exe">Download</a>')).toThrow(/no reviewed/);
  });

  it('finds an earlier Python installer and confirms it exists using HEAD only', async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (url === app('python-314').releaseSource) return metadata(pythonPage());
      expect(url).toBe('https://www.python.org/ftp/python/3.14.7/python-3.14.7-amd64.exe');
      expect(options.method).toBe('HEAD');
      return new Response(null, { status: 200 });
    });
    const current = candidateFromMetadata(app('python-314'), pythonPage());
    expect((await discoverPreviousCandidate(app('python-314'), current, fetcher))?.version).toBe('3.14.7');
  });

  it('fails closed when a published Python page points at a missing installer', async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => options.method === 'HEAD' ? new Response(null, { status: 404 }) : metadata(pythonPage()));
    await expect(discoverCandidate(app('python-314'), fetcher)).rejects.toThrow(/no full installer/);
  });

  it('restricts the Python version format to a reviewed Python definition', () => {
    expect(validateDefinitions([app('python-314')])).toHaveLength(1);
    expect(() => validateDefinitions([{ ...app('winrar'), installedIdentity: { ...app('winrar').installedIdentity, versionFormat: 'python-msi' } }])).toThrow(/Python/);
    expect(() => validateDefinitions([{ ...app('python-314'), installedIdentity: { ...app('python-314').installedIdentity, versionComponents: 3 } }])).toThrow(/exact release/);
  });

  it('selects stable English WinRAR and excludes beta and localized installers', () => {
    const page = ['730b1', '723fr', '723', '722'].map(version => `<a href="/rar/winrar-x64-${version}.exe">Download</a>`).join('\n');
    expect(candidateFromMetadata(app('winrar'), page).version).toBe('7.23');
  });

  it('requires the WinRAR upgrade baseline to remain reachable', async () => {
    const current = candidateFromMetadata(app('winrar'), '<a href="/rar/winrar-x64-723.exe">Download</a>');
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.method).toBe('HEAD');
      return new Response(null, { status: 404 });
    });
    await expect(discoverPreviousCandidate(app('winrar'), current, fetcher)).rejects.toThrow(/no full installer/);
  });

  it('pins Node.js to major-24 LTS and the x64 MSI despite newer Current releases', () => {
    const result = candidateFromMetadata(app('nodejs-lts'), nodeIndex, new Date(), `${pin}  node-v24.21.0-x64.msi`);
    expect(result.version).toBe('24.21.0');
    expect(result.vendorSha256).toBe(pin);
  });

  it('does not accept a non-LTS or ZIP-only Node.js release', () => {
    for (const row of [{ version: 'v24.21.0', lts: false, files: ['win-x64-msi'] }, { version: 'v24.21.0', lts: 'Krypton', files: ['win-x64-zip'] }]) {
      expect(() => candidateFromMetadata(app('nodejs-lts'), JSON.stringify([row]))).toThrow(/no reviewed/);
    }
  });

  it('hash-pins the earlier Node.js LTS installer used for upgrade QA', async () => {
    const current = candidateFromMetadata(app('nodejs-lts'), nodeIndex);
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (url === app('nodejs-lts').releaseSource) return metadata(nodeIndex);
      if (options.method === 'HEAD') return new Response(null, { status: 200 });
      expect(url).toBe('https://nodejs.org/dist/v24.20.0/SHASUMS256.txt');
      return metadata(`${pin}  node-v24.20.0-x64.msi`);
    });
    const previous = await discoverPreviousCandidate(app('nodejs-lts'), current, fetcher);
    expect(previous?.version).toBe('24.20.0');
    expect(previous?.vendorSha256).toBe(pin);
  });

  it('excludes Wireshark development builds and selects the stable x64 MSI hash', () => {
    const checksums = `SHA256(Wireshark-4.6.9-x64.exe)=${'b'.repeat(64)}\nSHA256(Wireshark-4.6.9-x64.msi)=${pin}`;
    const result = candidateFromMetadata(app('wireshark'), wiresharkPage, new Date(), checksums);
    expect(result.version).toBe('4.6.9');
    expect(result.installerUrl).toBe('https://www.wireshark.org/download/win64/Wireshark-4.6.9-x64.msi');
    expect(result.vendorSha256).toBe(pin);
  });

  it('rejects missing and ambiguous Wireshark MSI checksums', () => {
    const installer = 'https://www.wireshark.org/download/win64/Wireshark-4.6.9-x64.msi';
    for (const checksums of [`SHA256(Wireshark-4.6.9-arm64.msi)=${pin}`, `SHA256(Wireshark-4.6.9-x64.msi)=${pin}\nSHA256(Wireshark-4.6.9-x64.msi)=${pin}`]) {
      expect(() => vendorSha256FromChecksums(app('wireshark'), installer, '4.6.9', checksums)).toThrow(/Expected one/);
    }
  });

  it('pins the earlier stable Wireshark MSI without transferring an installer', async () => {
    const current = candidateFromMetadata(app('wireshark'), wiresharkPage, new Date(), `SHA256(Wireshark-4.6.9-x64.msi)=${pin}`);
    const fetcher = vi.fn(async (url: string) => {
      if (url === app('wireshark').releaseSource) return metadata(wiresharkPage);
      expect(url).toBe('https://www.wireshark.org/download/SIGNATURES-4.6.8.txt');
      return metadata(`SHA256(Wireshark-4.6.8-x64.msi)=${pin}`);
    });
    const previous = await discoverPreviousCandidate(app('wireshark'), current, fetcher);
    expect(previous?.version).toBe('4.6.8');
    expect(previous?.vendorSha256).toBe(pin);
  });

  it('requires the publisher hash for the reviewed Wireshark initial baseline', async () => {
    const page = '<a href="https://www.wireshark.org/download/win64/Wireshark-4.6.9-x64.exe">Download</a>';
    const current = candidateFromMetadata(app('wireshark'), page, new Date(), `SHA256(Wireshark-4.6.9-x64.msi)=${pin}`);
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      if (url === app('wireshark').releaseSource) return metadata(page);
      if (options.method === 'HEAD') return new Response(null, { status: 200 });
      expect(url).toBe('https://www.wireshark.org/download/SIGNATURES-4.6.8.txt');
      return metadata(`SHA256(Wireshark-4.6.8-x64.msi)=${pin}`);
    });
    const previous = await discoverPreviousCandidate(app('wireshark'), current, fetcher);
    expect(previous?.version).toBe('4.6.8');
    expect(previous?.vendorSha256).toBe(pin);
  });
});
