import { assertHttpsUrl, createCandidate, CuratedCatalogError } from './core.mjs';

const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const PUTTY_ARCHIVE_METADATA = 'https://the.earth.li/~sgtatham/putty/latest/w64/';

async function fetchMetadata(url, fetcher) {
  assertHttpsUrl(url);
  let response = await fetcher(url, {
    headers: { Accept: 'application/json, text/plain, text/html', 'User-Agent': 'IntuneGet-Curated-Catalog/1' },
    redirect: url === PUTTY_ARCHIVE_METADATA ? 'manual' : 'error', signal: AbortSignal.timeout(30_000),
  });
  // The publisher's archive resolves "latest" to a versioned HTML directory.
  // Allow only that exact metadata redirect, never an installer or mirror.
  if ([301, 302, 307, 308].includes(response.status) && url === PUTTY_ARCHIVE_METADATA) {
    const target = new URL(response.headers.get('location') || '', url);
    assertHttpsUrl(target.href);
    if (target.origin !== 'https://the.earth.li' || !/^\/~sgtatham\/putty\/\d+(?:\.\d+){1,2}\/w64\/$/.test(target.pathname) || target.search) throw new CuratedCatalogError('The PuTTY metadata redirect left the official versioned archive.');
    response = await fetcher(target.href, { headers: { Accept: 'text/html', 'User-Agent': 'IntuneGet-Curated-Catalog/1' }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  }
  if (!response.ok) throw new CuratedCatalogError(`Vendor metadata returned HTTP ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  // VLC's documented text release feed uses application/octet-stream. Only
  // this exact metadata endpoint may use that MIME type; installer paths are
  // never requested by discovery.
  if (!/json|text|xml/i.test(contentType) && !(url === 'https://update.videolan.org/vlc/status-win-x64' && contentType === 'application/octet-stream')) throw new CuratedCatalogError('Discovery accepts text metadata only, never installer binaries.');
  if (Number(response.headers.get('content-length')) > MAX_METADATA_BYTES) throw new CuratedCatalogError('Vendor metadata exceeds the discovery limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new CuratedCatalogError('Vendor metadata is empty.');
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_METADATA_BYTES) throw new CuratedCatalogError('Vendor metadata exceeds the discovery limit.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

export function candidateFromMetadata(app, text, now = new Date()) {
  let version; let installerUrl; let vendorSha256 = null; let releaseNotesUrl = app.homepage;
  switch (app.discovery) {
    case 'github': {
      const release = JSON.parse(text);
      if (release.draft || release.prerelease) throw new CuratedCatalogError('Only stable published vendor releases are eligible.');
      const assets = (release.assets || []).filter(asset => new RegExp(app.assetPattern).test(asset.name));
      if (assets.length !== 1) throw new CuratedCatalogError(`Expected one reviewed ${app.architecture} installer asset, found ${assets.length}.`);
      const asset = assets[0];
      installerUrl = asset.browser_download_url;
      const tag = String(release.tag_name || '').replace(/^v/i, '');
      const gitVersion = /^(\d+(?:\.\d+){1,2})\.windows\.(\d+)$/.exec(tag);
      version = gitVersion ? (gitVersion[2] === '1' ? gitVersion[1] : `${gitVersion[1]}.${gitVersion[2]}`) : tag;
      vendorSha256 = /^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') ? asset.digest.slice(7) : null;
      releaseNotesUrl = release.html_url;
      break;
    }
    case 'chrome': {
      const metadata = JSON.parse(text);
      if (metadata.nextPageToken) throw new CuratedCatalogError('Chrome release metadata spans more than one page.');
      // The mutable enterprise MSI serves the fully rolled out release, not a
      // staged cohort, so only currently serving releases at fraction 1 qualify.
      const serving = (metadata.releases || [])
        .filter(release => release.fraction === 1 && typeof release.version === 'string' && /^\d+(?:\.\d+){3}$/.test(release.version))
        .map(release => release.version);
      if (serving.length === 0) throw new CuratedCatalogError('Chrome reported no fully rolled out stable release.');
      version = serving.sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0];
      installerUrl = 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi';
      break;
    }
    case 'firefox': {
      const metadata = JSON.parse(text);
      const esr = metadata.FIREFOX_ESR;
      if (typeof esr !== 'string' || !/^\d+(?:\.\d+){1,2}esr$/.test(esr)) throw new CuratedCatalogError('The vendor did not return an exact ESR version.');
      version = esr.replace(/esr$/, '');
      installerUrl = `https://archive.mozilla.org/pub/firefox/releases/${esr}/win64/en-US/Firefox%20Setup%20${esr}.msi`;
      break;
    }
    case 'vscode': {
      const metadata = JSON.parse(text);
      version = metadata.productVersion;
      installerUrl = metadata.url;
      vendorSha256 = metadata.sha256hash || null;
      break;
    }
    case 'vlc': {
      version = text.trim().split(/\r?\n/)[0].trim();
      if (!/^\d+(?:\.\d+){1,2}$/.test(version)) throw new CuratedCatalogError('The VLC release feed did not return a stable version.');
      installerUrl = `https://downloads.videolan.org/pub/videolan/vlc/${version}/win64/vlc-${version}-win64.exe`;
      break;
    }
    case 'putty': {
      const match = /href=["'](https:\/\/the\.earth\.li\/~sgtatham\/putty\/(latest|\d+(?:\.\d+){1,2})\/w64\/putty-(?:(\d+(?:\.\d+){1,2})-64bit|64bit-(\d+(?:\.\d+){1,2}))-installer\.msi)["']/i.exec(text);
      if (!match) {
        const asset = /href=["'](putty-(?:64bit-(\d+(?:\.\d+){1,2})|(\d+(?:\.\d+){1,2})-64bit)-installer\.msi)["']/i.exec(text);
        const directory = /Index of \/~sgtatham\/putty\/(\d+(?:\.\d+){1,2})\/w64/i.exec(text);
        if (!asset || !directory || directory[1] !== (asset[2] || asset[3])) throw new CuratedCatalogError('The official archive has no matching versioned Windows x64 MSI link.');
        version = directory[1]; installerUrl = `https://the.earth.li/~sgtatham/putty/${version}/w64/${asset[1]}`;
        break;
      }
      installerUrl = match[1]; version = match[3] || match[4];
      if (match[2] !== 'latest' && match[2] !== version) throw new CuratedCatalogError('The PuTTY archive version differs from the installer filename.');
      break;
    }
    case 'winscp': {
      const match = /^version=(\d+\.\d+\.\d+)(?:\.\d+)?\s*$/m.exec(text);
      if (!match) throw new CuratedCatalogError('The WinSCP feed did not return a stable version.');
      version = match[1];
      installerUrl = `https://downloads.sourceforge.net/project/winscp/WinSCP/${version}/WinSCP-${version}-Setup.exe`;
      break;
    }
    default: throw new CuratedCatalogError(`${app.name} requires a reviewed manual full-installer candidate.`);
  }
  return createCandidate(app, { version, installerUrl, vendorSha256, releaseNotesUrl }, now);
}

export async function discoverCandidate(app, fetcher = fetch, now = new Date()) {
  if (app.discovery === 'manual') return { appId: app.id, state: 'manual', releaseSource: app.releaseSource };
  const metadata = await fetchMetadata(app.releaseSource, fetcher);
  return { appId: app.id, state: 'candidate', candidate: candidateFromMetadata(app, metadata, now) };
}
