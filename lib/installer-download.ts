import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 240_000;
const MAX_REDIRECTS = 5;
const DEFAULT_RANGE_CHUNK_BYTES = 1024 * 1024;
const RANGE_DOWNLOAD_CONCURRENCY = 4;
const RANGE_DOWNLOAD_ATTEMPTS = 3;
const RANGED_HASH_HOSTS = new Set(['repo.postgrespro.ru']);
const PUBLISHER_CHECKSUM_HOSTS = new Set(['repo.postgrespro.com']);
const PUBLISHER_CHECKSUM_MAX_BYTES = 4 * 1024;
const PUBLISHER_CHECKSUM_TIMEOUT_MS = 15_000;
const PUBLISHER_CHECKSUM_PROBE_BYTES = 64 * 1024;

export interface InstallerHashResult {
  sha256: string;
  bytes: number;
  finalUrl: string;
  verificationMethod?: 'content-hash' | 'publisher-checksum';
}

export class InstallerDownloadSizeLimitError extends Error {
  constructor(public readonly maxBytes: number, public readonly observedBytes?: number) {
    super(`The installer is larger than the ${maxBytes} byte limit IntuneGet can verify before packaging.`);
    this.name = 'InstallerDownloadSizeLimitError';
  }
}

export class InstallerRedirectUrlError extends Error {
  constructor(public readonly sourceHost: string) {
    super(`Installer source ${sourceHost} returned an invalid redirect URL.`);
    this.name = 'InstallerRedirectUrlError';
  }
}

export class InstallerDownloadDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`Installer verification exceeded the ${timeoutMs}ms wall-clock deadline`);
    this.name = 'InstallerDownloadDeadlineError';
  }
}

export async function withInstallerDownloadDeadline<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('Installer verification deadline must be a positive number');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error instanceof InstallerDownloadSizeLimitError) {
      throw error;
    }
    if (controller.signal.aborted) {
      throw new InstallerDownloadDeadlineError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

function resolveRedirectUrl(location: string, source: URL): URL {
  let redirect: URL;
  try {
    redirect = new URL(location, source);
  } catch {
    // Node's URL error includes the raw Location and source URL. Retain only
    // the source hostname so signed URLs and embedded credentials stay private.
    throw new InstallerRedirectUrlError(source.hostname);
  }
  return validateUrl(redirect.toString());
}

export function shouldUseRangedInstallerHash(installerUrl: string): boolean {
  try {
    const url = new URL(installerUrl);
    return url.protocol === 'https:' && RANGED_HASH_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function publisherChecksumUrlForInstaller(installerUrl: string): string | null {
  try {
    const url = new URL(installerUrl);
    const filename = url.pathname.split('/').at(-1) || '';
    if (
      url.protocol !== 'https:' ||
      !PUBLISHER_CHECKSUM_HOSTS.has(url.hostname.toLowerCase()) ||
      (url.port && url.port !== '443') ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^PostgreSQL_[A-Za-z0-9._-]+_64bit_Setup\.exe$/.test(filename) ||
      url.pathname !== `/win/64/${filename}`
    ) return null;
    return `${url.origin}${url.pathname}.sha256sum`;
  } catch {
    return null;
  }
}

export function parsePublisherChecksum(
  content: string,
  expectedFilename: string,
): string | null {
  const match = content.match(/^([A-Fa-f0-9]{64})[ \t]+\*?([^\r\n]+)\r?\n?$/);
  if (!match || match[2] !== expectedFilename) return null;
  return match[1].toUpperCase();
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
  signal: AbortSignal,
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
          redirectUrl = resolveRedirectUrl(location, url);
        } catch (error) {
          reject(error);
          return;
        }

        readRangeMetadata(
          redirectUrl,
          redirectsRemaining - 1,
          maxBytes,
          timeoutMs,
          signal,
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
        reject(new InstallerDownloadSizeLimitError(maxBytes, totalBytes));
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
      signal,
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
  signal: AbortSignal,
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
      signal,
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
  signal: AbortSignal,
): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= RANGE_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await downloadInstallerRange(url, range, totalBytes, validator, timeoutMs, signal);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Installer range download failed');
}

async function readPublisherChecksum(
  url: URL,
  redirectsRemaining: number,
  trustedHostname: string,
  signal: AbortSignal,
): Promise<string> {
  const resolved = await resolvePublicAddress(url.hostname);
  const headers = {
    Accept: 'text/plain,application/octet-stream',
    'Accept-Encoding': 'identity',
    Host: url.host,
    'User-Agent': 'IntuneGet-Installer-Preflight/1.0',
  };

  return new Promise<string>((resolve, reject) => {
    const onResponse = (response: http.IncomingMessage) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        response.resume();
        if (!location || redirectsRemaining <= 0) {
          reject(new Error('Publisher checksum exceeded the redirect limit'));
          return;
        }

        let redirectUrl: URL;
        try {
          redirectUrl = resolveRedirectUrl(location, url);
          if (
            redirectUrl.protocol !== 'https:' ||
            redirectUrl.hostname.toLowerCase() !== trustedHostname ||
            (redirectUrl.port && redirectUrl.port !== '443')
          ) {
            throw new Error('Publisher checksum redirected outside the reviewed origin');
          }
        } catch (error) {
          reject(error);
          return;
        }

        readPublisherChecksum(
          redirectUrl,
          redirectsRemaining - 1,
          trustedHostname,
          signal,
        ).then(resolve, reject);
        return;
      }

      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Publisher checksum returned HTTP ${status}`));
        return;
      }

      const contentLength = Number(response.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > PUBLISHER_CHECKSUM_MAX_BYTES) {
        response.destroy();
        reject(new Error('Publisher checksum exceeded the size limit'));
        return;
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > PUBLISHER_CHECKSUM_MAX_BYTES) {
          response.destroy(new Error('Publisher checksum exceeded the size limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks, bytes).toString('utf8')));
      response.on('error', reject);
    };

    const request = https.request({
      protocol: 'https:',
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
      servername: url.hostname,
      signal,
    }, onResponse);
    request.setTimeout(PUBLISHER_CHECKSUM_TIMEOUT_MS, () => {
      request.destroy(new Error(
        `Publisher checksum timed out after ${PUBLISHER_CHECKSUM_TIMEOUT_MS}ms`,
      ));
    });
    request.on('error', reject);
    request.end();
  });
}

async function attestInstallerWithPublisherChecksum(
  installerUrl: URL,
  checksumUrl: URL,
  maxBytes: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<InstallerHashResult> {
  const trustedHostname = installerUrl.hostname.toLowerCase();
  const metadata = await readRangeMetadata(
    installerUrl,
    MAX_REDIRECTS,
    maxBytes,
    timeoutMs,
    signal,
  );
  if (
    metadata.finalUrl.hostname.toLowerCase() !== trustedHostname ||
    metadata.finalUrl.protocol !== 'https:' ||
    (metadata.finalUrl.port && metadata.finalUrl.port !== '443') ||
    metadata.finalUrl.pathname !== installerUrl.pathname ||
    !metadata.acceptsRanges ||
    metadata.totalBytes === null ||
    metadata.totalBytes < PUBLISHER_CHECKSUM_PROBE_BYTES * 2 ||
    !metadata.validator
  ) {
    throw new Error('Publisher-checksum installer metadata was incomplete or changed origin');
  }

  const checksumContent = await readPublisherChecksum(
    checksumUrl,
    MAX_REDIRECTS,
    trustedHostname,
    signal,
  );
  const filename = installerUrl.pathname.split('/').at(-1) || '';
  const sha256 = parsePublisherChecksum(checksumContent, filename);
  if (!sha256) {
    throw new Error('Publisher checksum did not contain the exact installer filename and SHA256');
  }

  const totalBytes = metadata.totalBytes;
  await Promise.all([
    downloadInstallerRangeWithRetry(
      metadata.finalUrl,
      { start: 0, end: PUBLISHER_CHECKSUM_PROBE_BYTES - 1 },
      totalBytes,
      metadata.validator,
      timeoutMs,
      signal,
    ),
    downloadInstallerRangeWithRetry(
      metadata.finalUrl,
      {
        start: totalBytes - PUBLISHER_CHECKSUM_PROBE_BYTES,
        end: totalBytes - 1,
      },
      totalBytes,
      metadata.validator,
      timeoutMs,
      signal,
    ),
  ]);

  return {
    sha256,
    bytes: totalBytes,
    finalUrl: metadata.finalUrl.toString(),
    verificationMethod: 'publisher-checksum',
  };
}

async function hashUrlInRanges(
  url: URL,
  redirectsRemaining: number,
  maxBytes: number,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<InstallerHashResult> {
  const metadata = await readRangeMetadata(
    url,
    redirectsRemaining,
    maxBytes,
    timeoutMs,
    signal,
  );
  if (
    !metadata.acceptsRanges ||
    metadata.totalBytes === null ||
    !metadata.validator ||
    metadata.totalBytes <= DEFAULT_RANGE_CHUNK_BYTES
  ) {
    return hashUrl(metadata.finalUrl, redirectsRemaining, maxBytes, timeoutMs, signal);
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
          signal,
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
    verificationMethod: 'content-hash',
  };
}

export interface InstallerSourceHop {
  hop: number;
  status: number;
  target: { scheme: string; host: string; pathSegments: number };
  location?: ReturnType<typeof redirectLocationShape>;
  next?: ReturnType<typeof sourceUrlShape>;
}
export interface InstallerSourceDiagnostic {
  outcome: 'reachable' | 'failed';
  hops: InstallerSourceHop[];
  errorCode?: string;
  networkCode?: string;
  addressFamily?: 4 | 6;
}
function sourceUrlShape(url: URL) {
  // Even short path segments can contain credentials. Never return path text.
  return { scheme: url.protocol.replace(':', ''), host: isIP(url.hostname.replace(/^\[|\]$/g, '')) ? '[address]' : url.hostname, pathSegments: Math.min(100, url.pathname.split('/').filter(Boolean).length) };
}
function redirectLocationShape(value: string) {
  return {
    form: /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ? 'absolute' : value.startsWith('//') ? 'scheme-relative' : value.startsWith('/') ? 'path-absolute' : value ? 'path-relative' : 'empty',
    length: Math.min(4096, value.length),
    hasBracket: /[\[\]]/.test(value),
    invalidPercentEscape: /%(?![a-fA-F0-9]{2})/.test(value),
    hasWhitespace: /\s/.test(value),
    hasControl: /[\x00-\x1f\x7f]/.test(value),
    hasBackslash: value.includes('\\'),
  };
}
function sourceProbeError(error: unknown): string {
  if (error instanceof InstallerRedirectUrlError) return 'REDIRECT_URL_INVALID';
  if (error instanceof InstallerDownloadDeadlineError) return 'DEADLINE';
  const message = error instanceof Error ? error.message : '';
  if (/private or reserved/.test(message)) return 'PRIVATE_ADDRESS';
  if (/HTTP or HTTPS|credentials|disallowed port/.test(message)) return 'REDIRECT_DISALLOWED';
  if (/redirect limit/.test(message)) return 'REDIRECT_LIMIT';
  if (/timed out/.test(message)) return 'TIMEOUT';
  return 'NETWORK';
}
const SOURCE_NETWORK_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL', 'ECONNREFUSED', 'ECONNRESET',
  'ENETUNREACH', 'EHOSTUNREACH', 'EADDRNOTAVAIL', 'ETIMEDOUT', 'EPIPE',
  'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_INVALID_URL', 'ERR_INVALID_PROTOCOL', 'ERR_INVALID_CHAR',
]);
function sourceNetworkCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (typeof code !== 'string') return 'OTHER';
  if (SOURCE_NETWORK_CODES.has(code)) return code;
  if (/^ERR_(SSL|TLS)_[A-Z0-9_]+$/.test(code)) return 'TLS_OTHER';
  if (/^HPE_[A-Z0-9_]+$/.test(code)) return 'HTTP_PARSE';
  return 'OTHER';
}
/** Observe source HTTP headers only. This never hashes or accepts payload bytes. */
export async function probeInstallerSource(installerUrl: string): Promise<InstallerSourceDiagnostic> {
  const hops: InstallerSourceHop[] = [];
  const attempted: { family?: 4 | 6 } = {};
  let url: URL;
  try { url = validateUrl(installerUrl); } catch { return { outcome: 'failed', hops, errorCode: 'INITIAL_URL_INVALID' }; }
  try {
    return await withInstallerDownloadDeadline(30_000, async signal => {
      const { response } = await openInstallerResponse(url, MAX_REDIRECTS, 15_000, signal, hops, attempted);
      const status = response.statusCode ?? 0;
      response.destroy();
      return status >= 200 && status < 300
        ? { outcome: 'reachable', hops }
        : { outcome: 'failed', hops, errorCode: 'HTTP_STATUS' };
    });
  } catch (error) {
    const errorCode = sourceProbeError(error);
    return { outcome: 'failed', hops, errorCode, ...(errorCode === 'NETWORK' ? {
      networkCode: sourceNetworkCode(error),
      ...(attempted.family === undefined ? {} : { addressFamily: attempted.family }),
    } : {}) };
  }
}

async function openInstallerResponse(
  url: URL,
  redirectsRemaining: number,
  timeoutMs: number,
  signal: AbortSignal,
  trace?: InstallerSourceHop[],
  attempted?: { family?: 4 | 6 },
): Promise<{ response: http.IncomingMessage; url: URL }> {
  if (attempted) delete attempted.family;
  const resolved = await resolvePublicAddress(url.hostname);
  if (attempted) attempted.family = resolved.family;
  const headers = {
    Accept: 'application/octet-stream,*/*',
    'Accept-Encoding': 'identity',
    Host: url.host,
    'User-Agent': 'IntuneGet-Installer-Preflight/1.0',
  };

  return new Promise<{ response: http.IncomingMessage; url: URL }>((resolve, reject) => {
    const onResponse = (response: http.IncomingMessage) => {
      const status = response.statusCode ?? 0;
      const hop = { hop: MAX_REDIRECTS - redirectsRemaining + 1, status, target: sourceUrlShape(url) } as InstallerSourceHop;
      trace?.push(hop);
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        if (trace) response.destroy(); else response.resume();
        if (!location || redirectsRemaining <= 0) {
          reject(new Error('Installer download exceeded the redirect limit'));
          return;
        }

        if (trace) hop.location = redirectLocationShape(location);
        let redirectUrl: URL;
        try {
          redirectUrl = resolveRedirectUrl(location, url);
          if (trace) hop.next = sourceUrlShape(redirectUrl);
        } catch (error) {
          reject(error);
          return;
        }

        openInstallerResponse(
          redirectUrl,
          redirectsRemaining - 1,
          timeoutMs,
          signal,
          trace,
          attempted,
        ).then(resolve, reject);
        return;
      }

      resolve({ response, url });

    };

    const commonOptions = {
      protocol: url.protocol,
      hostname: resolved.address,
      family: resolved.family,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
      signal,
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

async function hashUrl(
  url: URL, redirectsRemaining: number, maxBytes: number, timeoutMs: number, signal: AbortSignal,
): Promise<InstallerHashResult> {
  const opened = await openInstallerResponse(url, redirectsRemaining, timeoutMs, signal);
  url = opened.url;
  const response = opened.response;
  const status = response.statusCode ?? 0;
  return new Promise<InstallerHashResult>((resolve, reject) => {
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Installer download returned HTTP ${status}`));
        return;
      }

      const contentLength = Number(response.headers['content-length']);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        response.destroy();
        reject(new InstallerDownloadSizeLimitError(maxBytes, contentLength));
        return;
      }

      const hash = createHash('sha256');
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(new InstallerDownloadSizeLimitError(maxBytes, bytes));
          return;
        }
        hash.update(chunk);
      });
      response.on('end', () => {
        resolve({
          sha256: hash.digest('hex').toUpperCase(),
          bytes,
          finalUrl: url.toString(),
          verificationMethod: 'content-hash',
        });
      });
      response.on('error', reject);
  });
}

export async function hashRemoteInstaller(
  installerUrl: string,
  options?: { maxBytes?: number; timeoutMs?: number; totalTimeoutMs?: number },
): Promise<InstallerHashResult> {
  const url = validateUrl(installerUrl);
  const maxBytes = options?.maxBytes ?? parseMaximumBytes();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const totalTimeoutMs = options?.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const publisherChecksumUrl = publisherChecksumUrlForInstaller(installerUrl);
  return withInstallerDownloadDeadline(totalTimeoutMs, (signal) => {
    if (publisherChecksumUrl) {
      return attestInstallerWithPublisherChecksum(
        url,
        validateUrl(publisherChecksumUrl),
        maxBytes,
        timeoutMs,
        signal,
      );
    }
    return shouldUseRangedInstallerHash(installerUrl)
      ? hashUrlInRanges(url, MAX_REDIRECTS, maxBytes, timeoutMs, signal)
      : hashUrl(url, MAX_REDIRECTS, maxBytes, timeoutMs, signal);
  });
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
