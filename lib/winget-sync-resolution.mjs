import YAML from 'yaml';

const DEFAULT_RAW_BASE = 'https://raw.githubusercontent.com/microsoft/winget-pkgs/master/manifests';
const DEFAULT_API_BASE = 'https://api.github.com/repos/microsoft/winget-pkgs/contents/manifests';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export class WingetSyncOperationalError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'WingetSyncOperationalError';
    this.code = code;
  }
}

export function manifestBasePath(wingetId) {
  const parts = String(wingetId || '').split('.');
  if (parts.length < 2 || parts.some((part) => !part)) return null;
  return `${parts[0].charAt(0).toLowerCase()}/${parts.map(encodeURIComponent).join('/')}`;
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number.parseInt(response.headers.get('retry-after') || '', 10);
  if (Number.isFinite(retryAfter)) return Math.min(retryAfter, 30) * 1000;
  return Math.min(1000 * (attempt + 1), 5000);
}

function operationalError(code, message, cause) {
  return new WingetSyncOperationalError(code, message, cause ? { cause } : undefined);
}

export function createWingetManifestClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const sleepImpl = options.sleepImpl || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const token = options.token || '';
  const rawBase = options.rawBase || DEFAULT_RAW_BASE;
  const apiBase = options.apiBase || DEFAULT_API_BASE;
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const maxRetries = options.maxRetries ?? 5;

  if (typeof fetchImpl !== 'function') {
    throw operationalError('FETCH_UNAVAILABLE', 'A fetch implementation is required for WinGet manifest sync');
  }

  async function requestText(url, { accept = 'text/plain', allowNotFound = true } = {}) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let response;
      try {
        const headers = {
          Accept: accept,
          'User-Agent': 'IntuneGet-Manifest-Sync',
        };
        if (token && url.startsWith('https://api.github.com/')) {
          headers.Authorization = `Bearer ${token}`;
        }
        response = await fetchImpl(url, { headers, cache: 'no-store' });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleepImpl(Math.min(1000 * (attempt + 1), 5000));
          continue;
        }
        throw operationalError('NETWORK_ERROR', `Network request failed for ${url}`, error);
      }

      if (response.status === 404 && allowNotFound) return null;

      const retryable = response.status === 403 || response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        await sleepImpl(retryDelayMs(response, attempt));
        continue;
      }

      if (!response.ok) {
        throw operationalError(`HTTP_${response.status}`, `GitHub request failed with HTTP ${response.status} for ${url}`);
      }

      const declaredLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
      if (declaredLength > maxBytes) {
        throw operationalError('RESPONSE_TOO_LARGE', `GitHub response exceeded ${maxBytes} bytes for ${url}`);
      }

      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        throw operationalError('RESPONSE_TOO_LARGE', `GitHub response exceeded ${maxBytes} bytes for ${url}`);
      }
      return text;
    }

    throw operationalError('RETRY_EXHAUSTED', `GitHub retries were exhausted for ${url}`);
  }

  async function fetchContentsFile(relativePath) {
    const url = `${apiBase}/${relativePath}`;
    const text = await requestText(url, { accept: 'application/vnd.github+json' });
    if (text === null) return null;

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw operationalError('INVALID_GITHUB_RESPONSE', `GitHub returned invalid JSON for ${relativePath}`, error);
    }

    if (!payload || typeof payload !== 'object' || payload.encoding !== 'base64' || typeof payload.content !== 'string') {
      throw operationalError('INVALID_GITHUB_RESPONSE', `GitHub returned malformed file content for ${relativePath}`);
    }

    try {
      return Buffer.from(payload.content.replace(/\s/g, ''), 'base64').toString('utf8');
    } catch (error) {
      throw operationalError('INVALID_GITHUB_RESPONSE', `GitHub returned invalid base64 content for ${relativePath}`, error);
    }
  }

  async function fetchYamlFile(relativePath) {
    let text = await requestText(`${rawBase}/${relativePath}`);
    if (text === null) {
      text = await fetchContentsFile(relativePath);
    }
    if (text === null) return null;

    try {
      const manifest = YAML.parse(text);
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('Manifest root must be an object');
      }
      return manifest;
    } catch (error) {
      throw operationalError('INVALID_YAML', `WinGet manifest contains invalid YAML at ${relativePath}`, error);
    }
  }

  async function fetchVersions(wingetId) {
    const basePath = manifestBasePath(wingetId);
    if (!basePath) return [];
    const text = await requestText(`${apiBase}/${basePath}`, { accept: 'application/vnd.github+json' });
    if (text === null) return [];

    let entries;
    try {
      entries = JSON.parse(text);
    } catch (error) {
      throw operationalError('INVALID_GITHUB_RESPONSE', `GitHub returned invalid version data for ${wingetId}`, error);
    }
    if (!Array.isArray(entries)) {
      throw operationalError('INVALID_GITHUB_RESPONSE', `GitHub returned malformed version data for ${wingetId}`);
    }

    return entries
      .filter((entry) => entry && entry.type === 'dir' && typeof entry.name === 'string')
      .map((entry) => entry.name)
      .filter((name) => /^\d/.test(name))
      .filter((name) => /^\d+[\d._-]*\d*$/.test(name) || name.includes('.'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }

  async function fetchInstallerManifest(wingetId, version) {
    const basePath = manifestBasePath(wingetId);
    if (!basePath || !version) return null;
    const versionPath = `${basePath}/${encodeURIComponent(version)}`;
    const installer = await fetchYamlFile(`${versionPath}/${wingetId}.installer.yaml`);
    if (installer) return installer;

    const singleton = await fetchYamlFile(`${versionPath}/${wingetId}.yaml`);
    if (singleton && Array.isArray(singleton.Installers) && singleton.Installers.length > 0) {
      return singleton;
    }
    return null;
  }

  async function fetchLocaleManifest(wingetId, version) {
    const basePath = manifestBasePath(wingetId);
    if (!basePath || !version) return null;
    const versionPath = `${basePath}/${encodeURIComponent(version)}`;
    const localeText = (value) => typeof value === 'string' ? value.trim() : '';
    const hasDescription = (manifest) => Boolean(
      manifest && (localeText(manifest.ShortDescription) || localeText(manifest.Description))
    );

    const enUS = await fetchYamlFile(`${versionPath}/${wingetId}.locale.en-US.yaml`);
    if (hasDescription(enUS)) return enUS;

    const versionManifest = await fetchYamlFile(`${versionPath}/${wingetId}.yaml`);
    if (hasDescription(versionManifest)) return versionManifest;

    const defaultLocale = localeText(versionManifest?.DefaultLocale);
    if (defaultLocale && defaultLocale.toLowerCase() !== 'en-us') {
      const fallback = await fetchYamlFile(`${versionPath}/${wingetId}.locale.${defaultLocale}.yaml`);
      if (hasDescription(fallback) || (fallback && !enUS)) return fallback;
    }
    return enUS;
  }

  return {
    fetchInstallerManifest,
    fetchLocaleManifest,
    fetchVersions,
  };
}

export async function resolveWingetManifest({ client, wingetId, storedVersion, preferLive = false }) {
  if (!client || typeof client.fetchInstallerManifest !== 'function' || typeof client.fetchVersions !== 'function') {
    throw operationalError('INVALID_CLIENT', 'A WinGet manifest client is required');
  }

  if (!preferLive && storedVersion) {
    const storedManifest = await client.fetchInstallerManifest(wingetId, storedVersion);
    if (storedManifest) {
      return { status: 'resolved', version: storedVersion, manifest: storedManifest, source: 'stored' };
    }
  }

  const versions = await client.fetchVersions(wingetId);
  if (versions.length === 0) {
    return { status: 'unavailable', reason: 'package_or_version_missing' };
  }

  const liveVersion = versions[0];
  if (!preferLive && storedVersion === liveVersion) {
    return { status: 'unavailable', reason: 'installer_manifest_missing', version: liveVersion };
  }

  const liveManifest = await client.fetchInstallerManifest(wingetId, liveVersion);
  if (!liveManifest) {
    return { status: 'unavailable', reason: 'installer_manifest_missing', version: liveVersion };
  }

  return { status: 'resolved', version: liveVersion, manifest: liveManifest, source: 'live' };
}

export function classifyWingetSyncRun({ complete, failed = 0, unavailable = 0 }) {
  const shouldFail = !complete || failed > 0;
  return {
    shouldFail,
    status: shouldFail ? 'failed' : unavailable > 0 ? 'partial' : 'success',
  };
}
