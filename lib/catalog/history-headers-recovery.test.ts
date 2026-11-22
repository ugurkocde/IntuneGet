import { afterEach, expect, it, vi } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { isolatedHistoryFetch } from './history-transport';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanup.splice(0)) await close(); });
async function fixture(handle: (socket: Socket, number: number, data: string) => void) {
  let connections = 0;
  const sockets = new Set<Socket>();
  const server = createServer(socket => {
    const number = ++connections; sockets.add(socket); socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', data => handle(socket, number, data.toString()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }));
  return { url: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/rpc`, connections: () => connections };
}
const recover = (url: string, init: RequestInit, phases: string[] = []) => Reflect.apply(isolatedHistoryFetch, undefined, [url, init, (phase: string) => phases.push(phase), true]) as Promise<Response>;
it('recovers a fully written read that never receives headers on one fresh connection inside the caller deadline', async () => {
  const bytes: string[] = [];
  const f = await fixture((socket, number, data) => { bytes.push(data); if (number === 2) socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]'); });
  const phases: string[] = [];
  const response = await recover(f.url, { method: 'POST', body: '{"page_number":2}', headers: { apikey: 'fixture', 'x-client-info': 'fixture.1.v2' }, signal: AbortSignal.timeout(5000) }, phases);
  expect(await response.json()).toEqual([]); expect(f.connections()).toBe(2);
  expect(phases).toContain('headersRetry');
  expect(bytes).toHaveLength(2);
  expect(bytes[1]).toBe(bytes[0]);
}, 10000);
it('never retries an HTTP error or a body that stalls after headers', async () => {
  const f = await fixture(socket => socket.write('HTTP/1.1 500 Error\r\nContent-Length: 20\r\n\r\n['));
  const controller = new AbortController();
  const response = await recover(f.url, { signal: controller.signal });
  expect(response.status).toBe(500);
  const body = response.text(); controller.abort(new DOMException('fixture', 'TimeoutError'));
  await expect(body).rejects.toThrow();expect(f.connections()).toBe(1);
});
it('does not retry after a caller abort or a transport error', async () => {
  const f = await fixture(socket => socket.destroy());
  await expect(recover(f.url, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
  expect(f.connections()).toBe(1);
  const reason = new DOMException('fixture', 'TimeoutError');
  await expect(recover(f.url, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  expect(f.connections()).toBe(1);
});
it('cancels the recovery timer when the caller aborts a sent request', async () => {
  vi.useFakeTimers();
  let sent!: () => void;
  const received = new Promise<void>(resolve => { sent = resolve; });
  const f = await fixture(() => sent());
  const controller = new AbortController();
  const read = recover(f.url, { method: 'POST', body: '{}', signal: controller.signal });
  await received;
  const reason = new DOMException('fixture', 'TimeoutError'); controller.abort(reason);
  await expect(read).rejects.toBe(reason);
  await vi.advanceTimersByTimeAsync(5000);
  expect(f.connections()).toBe(1);
});
it('stops after one recovery attempt and keeps the existing total deadline', async () => {
  const f = await fixture(() => {});const signal = AbortSignal.timeout(8000);
  const began = performance.now();
  const error = await recover(f.url, { method: 'POST', body: '{}', signal }).catch(error => error);
  expect(error).toBe(signal.reason);
  expect(f.connections()).toBe(2);expect(performance.now()-began).toBeLessThan(9000);
}, 10000);
