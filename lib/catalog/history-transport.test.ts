import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { isolatedHistoryFetch } from './history-transport';

const shutdown: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of shutdown.splice(0)) await close(); });
async function fixture(handle: (socket: Socket, data: string, first: boolean) => void) {
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    connections++; sockets.add(socket); let first = true;
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', bytes => { handle(socket, bytes.toString(), first); first = false; });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  shutdown.push(() => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }));
  return { url: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/rpc`, connections: () => connections, sockets };
}
const answer = (socket: Socket, body = '[]', status = '200 OK') => socket.write(`HTTP/1.1 ${status}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: keep-alive\r\nContent-Type: application/json\r\n\r\n${body}`);

describe('isolated history transport', () => {
  it('avoids a pooled connection that silently drops its second request', async () => {
    const f = await fixture((socket, _data, first) => { if (first) answer(socket); });
    expect(await (await isolatedHistoryFetch(f.url)).text()).toBe('[]');
    expect(await (await isolatedHistoryFetch(f.url, { signal: AbortSignal.timeout(500) })).text()).toBe('[]');
    expect(f.connections()).toBe(2);
  });
  it('forwards exact POST bytes, authentication and correlation headers', async () => {
    let received = '';
    const f = await fixture((socket, data) => { received += data; if (received.endsWith('{"x":"ä"}')) answer(socket); });
    const response = await isolatedHistoryFetch(f.url, { method: 'POST', body: '{"x":"ä"}', headers: {
      apikey: 'fixture', authorization: 'Bearer fixture', 'x-client-info': 'ig-hist=fixture.1.v2',
    } });
    expect(await response.text()).toBe('[]');
    expect(received).toContain('POST /rpc HTTP/1.1');
    expect(received.toLowerCase()).toContain('content-length: 10');
    for (const text of ['apikey: fixture', 'authorization: Bearer fixture', 'x-client-info: ig-hist=fixture.1.v2', 'connection: close', 'accept-encoding: identity']) expect(received).toContain(text);
  });
  it('aborts before headers and closes the socket', async () => {
    const f = await fixture(() => {}); const controller = new AbortController();
    const read = isolatedHistoryFetch(f.url, { signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 25));
    const reason = new DOMException('fixture', 'TimeoutError'); controller.abort(reason);
    await expect(read).rejects.toBe(reason);
  });
  it('aborts a response body after headers', async () => {
    const f = await fixture(socket => socket.write('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n['));
    const controller = new AbortController();
    const response = await isolatedHistoryFetch(f.url, { signal: controller.signal });
    const body = response.text(); controller.abort(new DOMException('fixture', 'TimeoutError'));
    await expect(body).rejects.toThrow();
  });
  it('preserves PostgREST errors without retry', async () => {
    const f = await fixture((socket, _data, first) => { if (first) answer(socket, '{"code":"fixture"}', '400 Bad Request'); });
    const response = await isolatedHistoryFetch(f.url);
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ code: 'fixture' }); expect(f.connections()).toBe(1);
  });
  it('rejects unsupported inputs and respects an already aborted signal', async () => {
    await expect(isolatedHistoryFetch(new Request('https://fixture.invalid'))).rejects.toBeInstanceOf(TypeError);
    await expect(isolatedHistoryFetch('https://fixture.invalid', { method: 'POST', body: new ReadableStream() })).rejects.toBeInstanceOf(TypeError);
    const reason = new DOMException('fixture', 'TimeoutError');
    await expect(isolatedHistoryFetch('https://fixture.invalid', { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });
});
