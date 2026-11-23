import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

export type HistoryTransportPhase = 'socket' | 'lookup' | 'connect' | 'secureConnect' | 'requestFinish' | 'headers' | 'abort' | 'error' | 'close' | 'headersRetry';

/** Only the known read-only history RPC opts in. A sent request with no headers
 * gets one fresh connection after four seconds; both attempts keep the caller's
 * original deadline. This does not prove cancellation of server-side work. */
export async function isolatedHistoryFetch(input: Parameters<typeof fetch>[0], init: RequestInit = {}, onPhase?: (phase: HistoryTransportPhase) => void, recoverMissingHeaders = false): Promise<Response> {
  if (!recoverMissingHeaders || !init.signal) return isolatedHistoryAttempt(input, init, onPhase);
  init.signal.throwIfAborted();
  const abandoned = new AbortController();
  const reason = new DOMException('History response headers deadline', 'AbortError');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let headers = false;
  let retrySelected = false;
  let selectRetry!: (value: { kind: 'retry' }) => void;
  const retry = new Promise<{ kind: 'retry' }>(resolve => { selectRetry = resolve; });
  const emit = (phase: HistoryTransportPhase) => { try { onPhase?.(phase); } catch { /* Best effort observer. */ } };
  const first = isolatedHistoryAttempt(input, { ...init, signal: AbortSignal.any([init.signal, abandoned.signal]) }, phase => {
    emit(phase);
    if (phase === 'headers') { headers = true; clearTimeout(timer); }
    if (phase === 'requestFinish' && !headers) timer = setTimeout(() => {
      if (headers || init.signal!.aborted) return;
      retrySelected = true;
      // Select recovery before rejecting the abandoned attempt.
      selectRetry({ kind: 'retry' });
      abandoned.abort(reason);
    }, 4000);
  });
  try {
    const result = await Promise.race([first.then(response => ({ kind: 'headers' as const, response })), retry]);
    if (result.kind === 'headers') return result.response;
    await first.catch(error => { if (!retrySelected || error !== reason) throw error; });
    init.signal.throwIfAborted();
    emit('headersRetry');
    // The second attempt cannot schedule another recovery.
    return await isolatedHistoryAttempt(input, init, emit);
  } finally { clearTimeout(timer); }
}

/** History already shares and caches reads above this transport. A fresh socket
 * prevents a refresh from reusing a connection left idle across an invocation. */
async function isolatedHistoryAttempt(input: Parameters<typeof fetch>[0], init: RequestInit = {}, onPhase?: (phase: HistoryTransportPhase) => void): Promise<Response> {
  // Fixed phase names only. Observability cannot change request settlement.
  const phase = (value: HistoryTransportPhase) => { try { onPhase?.(value); } catch { /* Best effort observer. */ } };
  if (input instanceof Request) throw new TypeError('History transport requires a URL');
  const url = new URL(String(input));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('Unsupported history protocol');
  if (init.body != null && typeof init.body !== 'string') throw new TypeError('History transport requires a string body');
  const body = init.body as string | null | undefined;
  const headers = new Headers(init.headers);
  headers.set('connection', 'close');
  headers.set('accept-encoding', 'identity');
  if (body != null) headers.set('content-length', String(Buffer.byteLength(body)));
  const signal = init.signal;
  signal?.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    let response: import('node:http').IncomingMessage | undefined;
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: init.method ?? 'GET', headers: Object.fromEntries(headers), agent: false,
    });
    request.once('socket', socket => {
      phase('socket');
      socket.once('lookup', () => phase('lookup'));
      socket.once('connect', () => phase('connect'));
      socket.once('secureConnect', () => phase('secureConnect'));
    });
    request.once('finish', () => phase('requestFinish'));
    const abort = () => {
      phase('abort');
      const error = signal!.reason instanceof Error ? signal!.reason : new DOMException('History aborted', 'AbortError');
      response?.destroy(error);
      request.destroy(error);
      reject(signal!.reason);
    };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    request.once('error', error => { phase('error'); cleanup(); reject(signal?.aborted ? signal.reason : error); });
    request.once('close', () => { phase('close'); if (!response) cleanup(); });
    request.once('response', incoming => {
      phase('headers');
      response = incoming;
      incoming.once('close', cleanup);
      const responseHeaders = new Headers();
      for (let i = 0; i < incoming.rawHeaders.length; i += 2) responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
      const status = incoming.statusCode ?? 500;
      const noBody = [204, 205, 304].includes(status) || init.method === 'HEAD';
      resolve(new Response(noBody ? null : Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
        status, statusText: incoming.statusMessage, headers: responseHeaders,
      }));
      if (noBody) incoming.resume();
    });
    // Close the race between the initial check and listener registration.
    if (signal?.aborted) { abort(); return; }
    request.end(body);
  });
}
