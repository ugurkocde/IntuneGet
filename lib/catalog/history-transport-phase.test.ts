import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Socket } from 'node:net';
import { isolatedHistoryFetch } from './history-transport';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function server(onData: (socket: Socket, data: string) => void) {
  const sockets = new Set<Socket>();
  const listener = createServer(socket => {
    sockets.add(socket); socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', data => onData(socket, data.toString()));
  });
  await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => { for (const socket of sockets) socket.destroy(); listener.close(() => resolve()); }));
  return (listener.address() as import('node:net').AddressInfo).port;
}
const observe = (url: string, init: RequestInit, phase: (value: string) => void) =>
  Reflect.apply(isolatedHistoryFetch, undefined, [url, init, phase]) as Promise<Response>;

describe('history transport phase discrimination', () => {
  it('distinguishes an unanswered TLS handshake from a sent request', async () => {
    const phases: string[] = [];
    const port = await server(() => {});
    const signal = AbortSignal.timeout(250);
    const reason = await observe(`https://127.0.0.1:${port}/rpc`, { method: 'POST', body: '{}', signal }, p => phases.push(p)).catch(error => error);
    expect(reason).toBe(signal.reason);
    expect(phases).toContain('connect');
    expect(phases).toContain('abort');
    expect(phases).not.toContain('secureConnect');
    expect(phases).not.toContain('requestFinish');
    expect(phases).not.toContain('headers');
  });
  it('identifies a sent request waiting for headers without sending again', async () => {
    const phases: string[] = []; let requests = 0; let sent!: () => void;
    const received = new Promise<void>(resolve => { sent = resolve; });
    const port = await server((_socket, data) => { if (data.includes('POST /rpc')) requests++; sent(); });
    const controller = new AbortController();
    const response = observe(`http://127.0.0.1:${port}/rpc`, { method: 'POST', body: '{}', signal: controller.signal }, p => phases.push(p));
    await received; const reason = new DOMException('fixture', 'TimeoutError'); controller.abort(reason);
    await expect(response).rejects.toBe(reason);
    expect(phases).toContain('requestFinish');
    expect(phases).toContain('abort');
    expect(phases).not.toContain('headers');
    expect(requests).toBe(1);
    expect(phases.every(p => ['socket','lookup','connect','secureConnect','requestFinish','headers','abort','error','close'].includes(p))).toBe(true);
  });
  it('keeps observer failures outside the transport result', async () => {
    const port = await server(socket => socket.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]'));
    const response = await observe(`http://127.0.0.1:${port}/rpc`, {}, () => { throw new Error('fixture observer'); });
    expect(await response.text()).toBe('[]');
  });
});
