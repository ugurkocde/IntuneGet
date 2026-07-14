import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_REDIRECTS = 5;

export interface InstallerHashResult {
  sha256: string;
  bytes: number;
  finalUrl: string;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPublicIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  const family = isIP(normalized);
  if (family === 4) return !isPrivateIpv4(normalized);
  if (family !== 6) return false;

  if (normalized === '::' || normalized === '::1') return false;
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return false;
  }

  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? !isPrivateIpv4(mappedIpv4) : true;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isPublicIpAddress(hostname)) {
      throw new Error('Installer URL resolves to a private or reserved address');
    }
    return { address: hostname, family: literalFamily as 4 | 6 };
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) {
    throw new Error('Installer hostname did not resolve');
  }
  if (addresses.some((entry) => !isPublicIpAddress(entry.address))) {
    throw new Error('Installer hostname resolves to a private or reserved address');
  }

  return addresses[0] as { address: string; family: 4 | 6 };
}

function parseMaximumBytes(): number {
  const configured = Number(process.env.INSTALLER_PREFLIGHT_MAX_BYTES);
  return Number.isSafeInteger(configured) && configured >= 1_000_000
    ? configured
    : DEFAULT_MAX_BYTES;
}

function validateUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Installer URL must use HTTP or HTTPS');
  }
  if (url.username || url.password) {
    throw new Error('Installer URL must not contain credentials');
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error('Installer URL uses a disallowed port');
  }
  return url;
}

async function hashUrl(
  url: URL,
  redirectsRemaining: number,
  maxBytes: number,
  timeoutMs: number,
): Promise<InstallerHashResult> {
  const resolved = await resolvePublicAddress(url.hostname);
  const headers = {
    Accept: 'application/octet-stream,*/*',
    'Accept-Encoding': 'identity',
    Host: url.host,
    'User-Agent': 'IntuneGet-Installer-Preflight/1.0',
  };

  return new Promise<InstallerHashResult>((resolve, reject) => {
    const onResponse = (response: http.IncomingMessage) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirectsRemaining <= 0) {
          reject(new Error('Installer download exceeded the redirect limit'));
          return;
        }

        let redirectUrl: URL;
        try {
          redirectUrl = validateUrl(new URL(location, url).toString());
        } catch (error) {
          reject(error);
          return;
        }

        hashUrl(redirectUrl, redirectsRemaining - 1, maxBytes, timeoutMs).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Installer download returned HTTP ${status}`));
        return;
      }

      const contentLength = Number(response.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        response.destroy();
        reject(new Error(`Installer exceeds the ${maxBytes}-byte preflight limit`));
        return;
      }

      const hash = createHash('sha256');
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(new Error(`Installer exceeds the ${maxBytes}-byte preflight limit`));
          return;
        }
        hash.update(chunk);
      });
      response.on('end', () => {
        resolve({
          sha256: hash.digest('hex').toUpperCase(),
          bytes,
          finalUrl: url.toString(),
        });
      });
      response.on('error', reject);
    };

    const commonOptions = {
      protocol: url.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
    };

    const request = url.protocol === 'https:'
      ? https.request({ ...commonOptions, servername: url.hostname }, onResponse)
      : http.request(commonOptions, onResponse);

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Installer download timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    request.end();
  });
}

export async function hashRemoteInstaller(
  installerUrl: string,
  options?: { maxBytes?: number; timeoutMs?: number },
): Promise<InstallerHashResult> {
  const url = validateUrl(installerUrl);
  return hashUrl(
    url,
    MAX_REDIRECTS,
    options?.maxBytes ?? parseMaximumBytes(),
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
}

export function hashesEqual(left: string, right: string): boolean {
  const normalizedLeft = left.trim().toUpperCase();
  const normalizedRight = right.trim().toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalizedLeft) || !/^[A-F0-9]{64}$/.test(normalizedRight)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(normalizedLeft, 'hex'), Buffer.from(normalizedRight, 'hex'));
}

export function isLikelyMutableInstallerUrl(installerUrl: string, version: string): boolean {
  let normalizedUrl = installerUrl.toLowerCase();
  try {
    normalizedUrl = decodeURIComponent(installerUrl).toLowerCase();
  } catch {
    // A malformed escape sequence should shorten the trust window, not crash dispatch.
  }
  const normalizedVersion = version.trim().toLowerCase();
  if (!normalizedVersion || !normalizedUrl.includes(normalizedVersion)) return true;
  return /(?:latest|stable|current)(?:[/?&_.=-]|$)/i.test(normalizedUrl);
}
