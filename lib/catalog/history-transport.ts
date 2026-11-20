import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';

/** History already shares and caches reads above this transport. A fresh socket
 * prevents a refresh from reusing a connection left idle across an invocation. */
export const isolatedHistoryFetch: typeof fetch = async (input, init = {}) => {
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
    const abort = () => {
      const error = signal!.reason instanceof Error ? signal!.reason : new DOMException('History aborted', 'AbortError');
      response?.destroy(error);
      request.destroy(error);
      reject(signal!.reason);
    };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    request.once('error', error => { cleanup(); reject(signal?.aborted ? signal.reason : error); });
    request.once('close', () => { if (!response) cleanup(); });
    request.once('response', incoming => {
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
};
