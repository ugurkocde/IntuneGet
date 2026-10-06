import { assertHttpsUrl, checksumSourceUrl, compareReleaseVersions, createCandidate, CuratedCatalogError } from './core.mjs';

const MAX_METADATA_BYTES = 2 * 1024 * 1024;
// Mozilla's per-release SHA256SUMS is the largest checksum file (about 720 KB).
const MAX_CHECKSUM_BYTES = 1024 * 1024;
const PUTTY_ARCHIVE_METADATA = 'https://the.earth.li/~sgtatham/putty/latest/w64/';
const ADOBE_INSTALLER_ROOT = 'https://ardownload2.adobe.com/pub/adobe/acrobat/win/AcrobatDC/';

// Shared Actions runner IPs exhaust GitHub's anonymous API limit, so the
// workflow token authenticates release metadata reads. It is read-only and
// sent only to the GitHub API origin.
function metadataHeaders(url, accept) {
  const headers = { Accept: accept, 'User-Agent': 'IntuneGet-Curated-Catalog/1' };
  if (new URL(url).origin === 'https://api.github.com' && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function fetchMetadata(url, fetcher) {
  assertHttpsUrl(url);
  let response = await fetcher(url, {
    headers: metadataHeaders(url, 'application/json, text/plain, text/html'),
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
  return readBoundedText(response, MAX_METADATA_BYTES);
}

async function readBoundedText(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw new CuratedCatalogError('Vendor metadata exceeds the discovery limit.');
  const reader = response.body?.getReader();
  if (!reader) throw new CuratedCatalogError('Vendor metadata is empty.');
  const chunks = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new CuratedCatalogError('Vendor metadata exceeds the discovery limit.');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchChecksums(url, fetcher) {
  const target = assertHttpsUrl(url);
  if (/\.(?:msi|exe|msix|appx|zip|7z)$/i.test(target.pathname)) throw new CuratedCatalogError('Discovery never requests installer paths.');
  const response = await fetcher(target.href, {
    headers: { Accept: 'text/plain', 'User-Agent': 'IntuneGet-Curated-Catalog/1' }, redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new CuratedCatalogError(`Vendor checksum file returned HTTP ${response.status}.`);
  // VideoLAN serves .sha256 files as application/octet-stream and the PuTTY
  // archive sends no content type. The URL comes from the reviewed definition,
  // the body is size bounded, and binary content is rejected below.
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!['', 'text/plain', 'application/octet-stream'].includes(contentType)) throw new CuratedCatalogError('Discovery accepts text checksum files only, never installer binaries.');
  const text = await readBoundedText(response, MAX_CHECKSUM_BYTES);
  if (text.includes('\0')) throw new CuratedCatalogError('The vendor checksum file is not text.');
  return text;
}

/** Reads the publisher SHA256 for exactly the candidate installer from a checksum file. */
export function vendorSha256FromChecksums(app, installerUrl, version, text) {
  const entry = app.checksumSource.entryTemplate.replaceAll('{version}', version);
  if (!decodeURIComponent(new URL(installerUrl).pathname).endsWith(`/${entry}`)) throw new CuratedCatalogError('The checksum entry does not name the candidate installer.');
  const lines = text.split(/\r?\n/);
  let hashes = [];
  if (app.checksumSource.format === 'sha256sums') {
    hashes = lines.map(line => /^([a-fA-F0-9]{64}) [ *](.+)$/.exec(line)).filter(match => match && match[2] === entry).map(match => match[1]);
  } else {
    // The WinSCP release ReadMe lists each file name followed by indented
    // " - MD5:", " - SHA-1:" and " - SHA-256:" lines.
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] !== entry) continue;
      for (let j = i + 1; j < lines.length && lines[j].startsWith(' - '); j++) {
        const match = /^ - SHA-256: ([a-fA-F0-9]{64})$/.exec(lines[j]);
        if (match) hashes.push(match[1]);
      }
    }
  }
  if (hashes.length !== 1) throw new CuratedCatalogError(`Expected one publisher SHA256 for ${entry}, found ${hashes.length}.`);
  return hashes[0].toLowerCase();
}

function githubRelease(app, release) {
  if (release.draft || release.prerelease) throw new CuratedCatalogError('Only stable published vendor releases are eligible.');
  const assets = (release.assets || []).filter(asset => new RegExp(app.assetPattern).test(asset.name));
  if (assets.length !== 1) throw new CuratedCatalogError(`Expected one reviewed ${app.architecture} installer asset, found ${assets.length}.`);
  const asset = assets[0];
  let tag = String(release.tag_name || '');
  if (app.releaseTagPrefix) {
    if (!tag.startsWith(app.releaseTagPrefix)) throw new CuratedCatalogError('Publisher release tag has an unexpected prefix.');
    tag = tag.slice(app.releaseTagPrefix.length);
  }
  tag = tag.replace(/^v/i, '');
  if (app.releaseVersionPattern && !new RegExp(app.releaseVersionPattern).test(tag)) throw new CuratedCatalogError('Release is outside the reviewed channel.');
  const gitVersion = /^(\d+(?:\.\d+){1,2})\.windows\.(\d+)$/.exec(tag);
  return {
    version: gitVersion ? (gitVersion[2] === '1' ? gitVersion[1] : `${gitVersion[1]}.${gitVersion[2]}`) : tag,
    installerUrl: asset.browser_download_url,
    vendorSha256: /^sha256:[a-f0-9]{64}$/i.test(asset.digest || '') ? asset.digest.slice(7) : null,
    releaseNotesUrl: release.html_url,
  };
}

/** Read only official release metadata, bounded to 200 releases in small pages. */
async function githubChannelReleases(app, fetcher, currentVersion = null) {
  const source = new URL(app.releaseSource);
  if (source.origin !== 'https://api.github.com' || !/^\/repos\/[^/]+\/[^/]+\/releases$/.test(source.pathname) || source.username || source.password) {
    throw new CuratedCatalogError('The reviewed channel must use the official GitHub releases endpoint.');
  }
  source.searchParams.set('per_page', '10');
  source.searchParams.delete('page');
  const eligible = new Map();
  for (let page = 1; page <= 20; page++) {
    if (page > 1) source.searchParams.set('page', String(page));
    const releases = JSON.parse(await fetchMetadata(source.href, fetcher));
    if (!Array.isArray(releases)) throw new CuratedCatalogError('Publisher release list is invalid.');
    for (const release of releases) {
      try {
        const parsed = githubRelease(app, release);
        if (/^\d+(?:\.\d+){1,3}$/.test(parsed.version)) eligible.set(parsed.version, parsed);
      } catch { /* Other channels and releases without the reviewed MSI are ineligible. */ }
    }
    const found = [...eligible.values()].sort((a, b) => compareReleaseVersions(b.version, a.version));
    if ((currentVersion ? found.some(release => compareReleaseVersions(release.version, currentVersion) < 0) : found.length >= 2) || releases.length < 10) return found;
  }
  throw new CuratedCatalogError('The reviewed release channel exceeds the bounded discovery limit.');
}

function releaseFromMetadata(app, text) {
  let version; let installerUrl; let vendorSha256 = null; let releaseNotesUrl = app.homepage;
  switch (app.discovery) {
    case 'github': return githubRelease(app, JSON.parse(text));
    case 'github-channel': {
      const releases = JSON.parse(text);
      if (!Array.isArray(releases)) throw new CuratedCatalogError('Publisher release list is invalid.');
      const eligible = releases.flatMap(release => { try { return [githubRelease(app, release)]; } catch { return []; } });
      if (!eligible.length) throw new CuratedCatalogError('No stable installer in the reviewed channel.');
      return eligible.sort((a,b) => compareReleaseVersions(b.version,a.version))[0];
    }
    case 'aws-cli': {
      const tags = JSON.parse(text);
      if (!Array.isArray(tags)) throw new CuratedCatalogError('AWS release tags are invalid.');
      const versions = tags.map(tag => tag.name).filter(value => typeof value === 'string' && /^2\.[0-9]+\.[0-9]+$/.test(value));
      if (!versions.length) throw new CuratedCatalogError('AWS did not report a stable v2 release.');
      version = versions.sort((a,b) => compareReleaseVersions(b,a))[0];
      installerUrl = `https://awscli.amazonaws.com/AWSCLIV2-${version}.msi`;
      break;
    }
    case 'zoom': {
      const metadata = JSON.parse(text);
      const release = metadata.result?.downloadVO?.zoomX64;
      if (metadata.status !== true || release?.archType !== 'x64' || !/^\d+\.\d+\.\d+\.\d+$/.test(release?.version || '') || release.packageNameForIT !== 'ZoomInstallerFull.msi') throw new CuratedCatalogError('Zoom did not report an exact x64 enterprise MSI.');
      const [major, minor, , build] = release.version.split('.');
      version = `${major}.${minor}.${build}`;
      installerUrl = `https://cdn.zoom.us/prod/${release.version}/x64/ZoomInstallerFull.msi`;
      break;
    }
    case 'firefox-stable': {
      const metadata = JSON.parse(text);
      version = metadata.LATEST_FIREFOX_VERSION;
      if (typeof version !== 'string' || !/^\d+(?:\.\d+){1,2}$/.test(version)) throw new CuratedCatalogError('Mozilla did not report an exact stable version.');
      installerUrl = `https://archive.mozilla.org/pub/firefox/releases/${version}/win64/en-US/Firefox%20Setup%20${version}.msi`;
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
    case 'adobe': {
      const metadata = JSON.parse(text);
      const versions = [...new Set((metadata?.products?.reader || []).map(product => product?.version))];
      if (versions.length !== 1 || typeof versions[0] !== 'string' || !/^\d+\.\d{3}\.\d+$/.test(versions[0])) throw new CuratedCatalogError('Adobe did not report exactly one Reader release version.');
      version = versions[0];
      const folder = version.replaceAll('.', '');
      // The full x64 en-US offline installer, never an MSP patch.
      installerUrl = `${ADOBE_INSTALLER_ROOT}${folder}/AcroRdrDCx64${folder}_en_US.exe`;
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
  return { version, installerUrl, vendorSha256, releaseNotesUrl };
}

export function candidateFromMetadata(app, text, now = new Date(), checksumText = null) {
  const release = releaseFromMetadata(app, text);
  if (checksumText !== null) {
    const published = vendorSha256FromChecksums(app, release.installerUrl, release.version, checksumText);
    if (release.vendorSha256 && release.vendorSha256.toLowerCase() !== published) throw new CuratedCatalogError('Vendor checksums disagree for the candidate installer.');
    release.vendorSha256 = published;
  }
  return createCandidate(app, release, now);
}

/**
 * Confirms a constructed installer URL exists without transferring the
 * installer. Adobe publishes full installers for most but not all versions.
 */
async function assertInstallerPublished(url, fetcher) {
  assertHttpsUrl(url);
  const response = await fetcher(url, {
    method: 'HEAD', headers: { 'User-Agent': 'IntuneGet-Curated-Catalog/1' }, redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new CuratedCatalogError(`The publisher has no full installer for this version (HTTP ${response.status}).`);
}

async function candidateFromSource(app, url, fetcher, now) {
  if (app.discovery === 'github-channel') {
    const releases = await githubChannelReleases(app, fetcher);
    if (!releases.length) throw new CuratedCatalogError('No stable installer in the reviewed channel.');
    return createCandidate(app, releases[0], now);
  }
  const metadata = await fetchMetadata(url, fetcher);
  const release = releaseFromMetadata(app, metadata);
  if (['adobe', 'zoom', 'aws-cli'].includes(app.discovery)) await assertInstallerPublished(release.installerUrl, fetcher);
  if (!app.checksumSource) return candidateFromMetadata(app, metadata, now);
  // The checksum file is a second bounded text fetch for the parsed version.
  const checksums = await fetchChecksums(checksumSourceUrl(app, release.version), fetcher);
  return candidateFromMetadata(app, metadata, now, checksums);
}

export async function discoverCandidate(app, fetcher = fetch, now = new Date()) {
  if (app.discovery === 'manual') return { appId: app.id, state: 'manual', releaseSource: app.releaseSource };
  return { appId: app.id, state: 'candidate', candidate: await candidateFromSource(app, app.releaseSource, fetcher, now) };
}

/**
 * Finds the newest official release older than the candidate so the upgrade
 * can be tested when no earlier release has been approved yet. Returns null
 * when the publisher offers no reachable historical installer.
 */
export async function discoverPreviousCandidate(app, current, fetcher = fetch, now = new Date()) {
  if (app.discovery === 'github-channel') {
    const releases = await githubChannelReleases(app, fetcher, current.version);
    const previous = releases.find(release => compareReleaseVersions(release.version, current.version) < 0);
    return previous ? createCandidate(app, previous, now) : null;
  }
  if (app.discovery === 'github') {
    const listUrl = app.releaseSource.replace(/\/releases\/latest$/, '/releases?per_page=10');
    if (listUrl === app.releaseSource) return null;
    const releases = JSON.parse(await fetchMetadata(listUrl, fetcher));
    if (!Array.isArray(releases)) throw new CuratedCatalogError('The publisher release list is invalid.');
    const older = [];
    for (const release of releases) {
      let parsed;
      try { parsed = githubRelease(app, release); } catch { continue; }
      if (/^\d+(?:\.\d+){1,3}$/.test(parsed.version) && compareReleaseVersions(parsed.version, current.version) < 0) older.push(parsed);
    }
    const previous = older.sort((a, b) => compareReleaseVersions(b.version, a.version))[0];
    return previous ? createCandidate(app, previous, now) : null;
  }
  if (app.discovery === 'firefox-stable') {
    const history = JSON.parse(await fetchMetadata('https://product-details.mozilla.org/1.0/firefox_history_major_releases.json', fetcher));
    const version = Object.keys(history).filter(version => /^\d+(?:\.\d+){1,2}$/.test(version) && compareReleaseVersions(version,current.version)<0).sort((a,b)=>compareReleaseVersions(b,a))[0];
    if (!version) return null;
    const checksums = await fetchChecksums(checksumSourceUrl(app, version),fetcher);
    return candidateFromMetadata(app, JSON.stringify({LATEST_FIREFOX_VERSION:version}), now, checksums);
  }
  if (app.discovery === 'aws-cli') {
    const tags = JSON.parse(await fetchMetadata(app.releaseSource,fetcher));
    if (!Array.isArray(tags)) throw new CuratedCatalogError('AWS release tags are invalid.');
    const version = tags.map(tag=>tag.name).filter(version=>typeof version==='string' && /^2\.[0-9]+\.[0-9]+$/.test(version) && compareReleaseVersions(version,current.version)<0).sort((a,b)=>compareReleaseVersions(b,a))[0];
    if (!version) return null;
    const installerUrl = `https://awscli.amazonaws.com/AWSCLIV2-${version}.msi`;
    await assertInstallerPublished(installerUrl,fetcher);
    return createCandidate(app,{version,installerUrl},now);
  }
  if (app.initialUpgradeBaseline && compareReleaseVersions(app.initialUpgradeBaseline.version,current.version)<0) {
    await assertInstallerPublished(app.initialUpgradeBaseline.installerUrl,fetcher);
    return createCandidate(app,app.initialUpgradeBaseline,now);
  }
  if (app.discovery === 'putty') {
    // The archive has no index; PuTTY releases step the minor version.
    const match = /^0\.(\d+)$/.exec(current.version);
    if (!match || Number(match[1]) < 2) return null;
    return candidateFromSource(app, `https://the.earth.li/~sgtatham/putty/0.${Number(match[1]) - 1}/w64/`, fetcher, now);
  }
  return null;
}
