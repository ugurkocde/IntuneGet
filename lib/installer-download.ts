import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_REDIRECTS = 5;
const DEFAULT_RANGE_CHUNK_BYTES = 1024 * 1024;
const RANGE_DOWNLOAD_CONCURRENCY = 4;
const RANGE_DOWNLOAD_ATTEMPTS = 3;
const RANGED_HASH_HOSTS = new Set(['repo.postgrespro.ru']);

export interface InstallerHashResult {
  sha256: string;
  bytes: number;
  finalUrl: string;
}

interface ByteRange {
  start: number;
  end: number;
}

interface RangeMetadata {
  finalUrl: URL;
  totalBytes: number | null;
  acceptsRanges: boolean;
  validator: string | null;
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

export function shouldUseRangedInstallerHash(installerUrl: string): boolean {
  try {
    const url = new URL(installerUrl);
    return url.protocol === 'https:' && RANGED_HASH_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function buildByteRanges(
  totalBytes: number,
  chunkBytes = DEFAULT_RANGE_CHUNK_BYTES,
): ByteRange[] {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new Error('Installer byte length is invalid');
  }
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) {
    throw new Error('Installer range chunk size is invalid');
  }

  const ranges: ByteRange[] = [];
  for (let start = 0; start < totalBytes; start += chunkBytes) {
    ranges.push({ start, end: Math.min(start + chunkBytes - 1, totalBytes - 1) });
  }
  return ranges;
}

export function parseByteContentRange(value: string | undefined): {
  start: number;
  end: number;
  total: number;
} | null {
  const match = value?.trim().match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    end < start ||
    total <= end
  ) return null;
  return { start, end, total };
}

async function readRangeMetadata(
  url: URL,
  redirectsRemaining: number,
  maxBytes: number,
  timeoutMs: number,
): Promise<RangeMetadata> {
  const resolved = await resolvePublicAddress(url.hostname);
  const headers = {
    Accept: 'application/octet-stream,*/*',
    'Accept-Encoding': 'identity',
    Host: url.host,
    'User-Agent': 'IntuneGet-Installer-Preflight/1.0',
  };

  return new Promise<RangeMetadata>((resolve, reject) => {
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

        readRangeMetadata(
          redirectUrl,
          redirectsRemaining - 1,
          maxBytes,
          timeoutMs,
        ).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Installer metadata returned HTTP ${status}`));
        return;
      }

      const contentLength = Number(response.headers['content-length']);
      const totalBytes = Number.isSafeInteger(contentLength) && contentLength >= 0
        ? contentLength
        : null;
      if (totalBytes !== null && totalBytes > maxBytes) {
        response.resume();
        reject(new Error(`Installer exceeds the ${maxBytes}-byte preflight limit`));
        return;
      }

      const etag = response.headers.etag;
      const lastModified = response.headers['last-modified'];
      const validator = etag && !etag.startsWith('W/')
        ? etag
        : lastModified || null;
      response.on('error', reject);
      response.resume();
      resolve({
        finalUrl: url,
        totalBytes,
        acceptsRanges: response.headers['accept-ranges']?.toLowerCase() === 'bytes',
        validator,
      });
    };

    const commonOptions = {
      protocol: url.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'HEAD',
      headers,
    };
    const request = url.protocol === 'https:'
      ? https.request({ ...commonOptions, servername: url.hostname }, onResponse)
      : http.request(commonOptions, onResponse);

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Installer metadata timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    request.end();
  });
}

async function downloadInstallerRange(
  url: URL,
  range: ByteRange,
  totalBytes: number,
  validator: string,
  timeoutMs: number,
): Promise<Buffer> {
  const resolved = await resolvePublicAddress(url.hostname);
  const expectedBytes = range.end - range.start + 1;
  const headers = {
    Accept: 'application/octet-stream,*/*',
    'Accept-Encoding': 'identity',
    Host: url.host,
    'If-Range': validator,
    Range: `bytes=${range.start}-${range.end}`,
    'User-Agent': 'IntuneGet-Installer-Preflight/1.0',
  };

  return new Promise<Buffer>((resolve, reject) => {
    const onResponse = (response: http.IncomingMessage) => {
      const status = response.statusCode ?? 0;
      if (status !== 206) {
        response.resume();
        reject(new Error(`Installer range download returned HTTP ${status}`));
        return;
      }

      const contentRange = parseByteContentRange(response.headers['content-range']);
      const contentLength = Number(response.headers['content-length']);
      if (
        !contentRange ||
        contentRange.start !== range.start ||
        contentRange.end !== range.end ||
        contentRange.total !== totalBytes ||
        contentLength !== expectedBytes
      ) {
        response.resume();
        reject(new Error('Installer range response did not match the requested bytes'));
        return;
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > expectedBytes) {
          response.destroy(new Error('Installer range exceeded the requested byte count'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (bytes !== expectedBytes) {
          reject(new Error('Installer range ended before all requested bytes arrived'));
          return;
        }
        resolve(Buffer.concat(chunks, bytes));
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
      request.destroy(new Error(`Installer range timed out after ${timeoutMs}ms`));
    });
    request.on('error', reject);
    request.end();
  });
}

async function downloadInstallerRangeWithRetry(
  url: URL,
  range: ByteRange,
  totalBytes: number,
  validator: string,
  timeoutMs: number,
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RANGE_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await downloadInstallerRange(url, range, totalBytes, validator, timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Installer range download failed');
}

async function hashUrlInRanges(
  url: URL,
  redirectsRemaining: number,
  maxBytes: number,
  timeoutMs: number,
): Promise<InstallerHashResult> {
  const metadata = await readRangeMetadata(url, redirectsRemaining, maxBytes, timeoutMs);
  if (
    !metadata.acceptsRanges ||
    metadata.totalBytes === null ||
    !metadata.validator ||
    metadata.totalBytes <= DEFAULT_RANGE_CHUNK_BYTES
  ) {
    return hashUrl(metadata.finalUrl, redirectsRemaining, maxBytes, timeoutMs);
  }

  const totalBytes = metadata.totalBytes;
  const validator = metadata.validator;
  const hash = createHash('sha256');
  let bytes = 0;
  const ranges = buildByteRanges(totalBytes);
  for (let index = 0; index < ranges.length; index += RANGE_DOWNLOAD_CONCURRENCY) {
    const chunks = await Promise.all(
      ranges.slice(index, index + RANGE_DOWNLOAD_CONCURRENCY).map((range) =>
        downloadInstallerRangeWithRetry(
          metadata.finalUrl,
          range,
          totalBytes,
          validator,
          timeoutMs,
        )
      ),
    );
    for (const chunk of chunks) {
      hash.update(chunk);
      bytes += chunk.length;
    }
  }

  return {
    sha256: hash.digest('hex').toUpperCase(),
    bytes,
    finalUrl: metadata.finalUrl.toString(),
  };
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
  const maxBytes = options?.maxBytes ?? parseMaximumBytes();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return shouldUseRangedInstallerHash(installerUrl)
    ? hashUrlInRanges(url, MAX_REDIRECTS, maxBytes, timeoutMs)
    : hashUrl(url, MAX_REDIRECTS, maxBytes, timeoutMs);
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
