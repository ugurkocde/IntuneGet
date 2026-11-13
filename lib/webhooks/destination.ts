/**
 * Webhook destination guard
 * Webhook URLs are configured by signed-in users, so the server may only ever
 * post to public internet hosts. Every save and every delivery resolves the
 * hostname, requires all resolved addresses to be public, and connects to the
 * validated address itself. Redirects are never followed.
 */

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import * as https from 'node:https';
import { isLinkLocalAddress, isPublicIpAddress } from '@/lib/net/public-address';

const MAX_RESPONSE_EXCERPT_BYTES = 4096;
const DESTINATION_LOOKUP_TIMEOUT_MS = 5000;

// One message for unresolvable and non-public hosts, so the response does not
// reveal whether an internal name exists.
const NOT_PUBLIC_MESSAGE = 'Webhook URL must point to a host on the public internet';

// Framing headers are owned by the request itself. A configured custom header
// must not replace the host the address was validated for.
const RESERVED_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection']);

export type WebhookDestinationErrorCode = 'invalid' | 'not_public' | 'unresolved';

export class WebhookDestinationError extends Error {
  constructor(public readonly code: WebhookDestinationErrorCode, message: string) {
    super(message);
    this.name = 'WebhookDestinationError';
  }
}

export class WebhookRedirectError extends Error {
  constructor(public readonly statusCode: number) {
    super(`HTTP ${statusCode}: redirects are not followed`);
    this.name = 'WebhookRedirectError';
  }
}

export class WebhookTimeoutError extends Error {
  constructor() {
    super('Request timed out');
    this.name = 'WebhookTimeoutError';
  }
}

export interface WebhookDestination {
  url: URL;
  address: string;
  family: 4 | 6;
}

export interface WebhookResponse {
  status: number;
  /** At most the first 4096 bytes of the response body. */
  bodyExcerpt: string;
}

export interface WebhookFailure {
  message: string;
  retryable: boolean;
  statusCode?: number;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), timeoutMs);
  });
  return Promise.race([operation, expired]).finally(() => clearTimeout(timer));
}

/**
 * String level checks: HTTPS only and no embedded credentials.
 * Any port is accepted, as before this guard existed.
 */
export function parseWebhookUrl(value: string): URL {
  let url: URL;
  try {
    if (typeof value !== 'string') throw new TypeError('Webhook URL must be a string');
    url = new URL(value);
  } catch {
    throw new WebhookDestinationError('invalid', 'Invalid URL format');
  }

  if (url.protocol !== 'https:') {
    throw new WebhookDestinationError('invalid', 'URL must use HTTPS');
  }
  if (url.username || url.password) {
    throw new WebhookDestinationError('invalid', 'URL must not contain credentials');
  }
  return url;
}

/**
 * Self-hosted installations may run their webhook receiver on the local
 * network. The operator can allow that with
 * WEBHOOK_ALLOW_PRIVATE_DESTINATIONS=true. It is off by default and must stay
 * off on any deployment that serves users the operator does not trust with
 * the server's network. HTTPS, the pinned address and the redirect rule still
 * apply.
 */
function privateDestinationsAllowed(): boolean {
  return process.env.WEBHOOK_ALLOW_PRIVATE_DESTINATIONS === 'true';
}

function isAllowedAddress(address: string): boolean {
  if (!privateDestinationsAllowed()) return isPublicIpAddress(address);
  // Local receivers are allowed, link-local addresses never are: that range
  // holds the cloud metadata endpoints.
  return isIP(address.split('%')[0]) !== 0 && !isLinkLocalAddress(address);
}

/**
 * Resolve the webhook host and require every resolved address to be public.
 * Returns the address the request must be sent to.
 */
export async function resolveWebhookDestination(value: string): Promise<WebhookDestination> {
  const url = parseWebhookUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  const literalFamily = isIP(hostname);
  if (literalFamily) {
    if (!isAllowedAddress(hostname)) {
      throw new WebhookDestinationError('not_public', NOT_PUBLIC_MESSAGE);
    }
    return { url, address: hostname, family: literalFamily as 4 | 6 };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await withTimeout(
      lookup(hostname, { all: true, verbatim: true }),
      DESTINATION_LOOKUP_TIMEOUT_MS,
      () => new Error('Webhook host lookup timed out'),
    );
  } catch {
    throw new WebhookDestinationError('unresolved', NOT_PUBLIC_MESSAGE);
  }
  if (addresses.length === 0) {
    throw new WebhookDestinationError('unresolved', NOT_PUBLIC_MESSAGE);
  }
  // A single private record is enough to refuse: the connection could be
  // steered to it.
  if (addresses.some((entry) => !isAllowedAddress(entry.address))) {
    throw new WebhookDestinationError('not_public', NOT_PUBLIC_MESSAGE);
  }

  return { url, address: addresses[0].address, family: addresses[0].family as 4 | 6 };
}

/**
 * Save time validation for webhook URLs.
 */
export async function validateWebhookDestination(
  value: string
): Promise<{ valid: boolean; error?: string }> {
  try {
    await resolveWebhookDestination(value);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof WebhookDestinationError ? error.message : 'Invalid webhook URL',
    };
  }
}

function requestHeaders(headers: Record<string, string>, url: URL, body: string): Record<string, string> {
  const result: Record<string, string> = { Accept: '*/*' };
  for (const [name, headerValue] of Object.entries(headers)) {
    if (!RESERVED_HEADERS.has(name.toLowerCase())) result[name] = String(headerValue);
  }
  result.Host = url.host;
  result['Content-Length'] = String(Buffer.byteLength(body));
  return result;
}

/**
 * POST a payload to a webhook URL.
 *
 * The hostname is resolved and checked immediately before the request, and
 * the request connects to that validated address (TLS still verifies the
 * certificate against the hostname). A DNS answer that changes between the
 * check and the connection therefore cannot move the request to a private
 * address. A 3xx response is an error and is never followed.
 */
export async function postWebhook(
  value: string,
  options: { headers: Record<string, string>; body: string; timeoutMs: number }
): Promise<WebhookResponse> {
  const startedAt = Date.now();
  const { url, address, family } = await resolveWebhookDestination(value);
  const remainingMs = Math.max(1, options.timeoutMs - (Date.now() - startedAt));
  const hostIsLiteral = isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0;

  return new Promise<WebhookResponse>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expire = () => reject(new WebhookTimeoutError());
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      settle();
    };

    const request = https.request(
      {
        protocol: 'https:',
        hostname: address,
        family,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: requestHeaders(options.headers, url, options.body),
        ...(hostIsLiteral ? {} : { servername: url.hostname }),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          finish(() => reject(new WebhookRedirectError(status)));
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;
        // Once the status line arrived the delivery has a result, even when
        // the body is cut short by the size cap, the deadline or the peer.
        const deliver = () => resolve({ status, bodyExcerpt: Buffer.concat(chunks).toString('utf8') });
        const complete = () => finish(deliver);
        expire = deliver;

        response.on('data', (chunk: Buffer) => {
          if (bytes < MAX_RESPONSE_EXCERPT_BYTES) {
            chunks.push(chunk.subarray(0, MAX_RESPONSE_EXCERPT_BYTES - bytes));
          }
          bytes += chunk.length;
          if (bytes >= MAX_RESPONSE_EXCERPT_BYTES) {
            complete();
            response.destroy();
          }
        });
        response.on('end', complete);
        response.on('error', complete);
        response.on('close', complete);
      }
    );

    timer = setTimeout(() => {
      finish(() => expire());
      request.destroy();
    }, remainingMs);
    request.on('error', (error) => finish(() => reject(error)));
    request.end(options.body);
  });
}

/**
 * Turn a delivery error into a short, server authored description. It never
 * contains text received from the destination.
 */
export function describeWebhookFailure(error: unknown): WebhookFailure {
  if (error instanceof WebhookDestinationError) {
    // A failed lookup can be transient; a refused address is not.
    return { message: error.message, retryable: error.code === 'unresolved' };
  }
  if (error instanceof WebhookRedirectError) {
    return { message: error.message, retryable: false, statusCode: error.statusCode };
  }
  if (error instanceof WebhookTimeoutError) {
    return { message: error.message, retryable: true };
  }

  const code = (error as NodeJS.ErrnoException | null)?.code;
  return {
    message: typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
      ? `Connection failed (${code})`
      : 'Connection failed',
    retryable: true,
  };
}
