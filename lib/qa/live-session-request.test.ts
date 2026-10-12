import { describe, expect, it } from 'vitest';
import { parseQaLiveFrameCommand, parseQaLiveSessionCommand, readQaLiveBody } from './live-session-request';
const bytes = (data: unknown) => new TextEncoder().encode(JSON.stringify(data));
const begin = { action: 'begin', runId: '123', runAttempt: 1, appId: 'chrome', version: '1.0', architecture: 'x64', upgradePlanned: false, hostCustomConfig: false };
const frame = { runId: '123', runAttempt: 1, sessionId: '11111111-1111-4111-8111-111111111111', sequence: 1,
  capturedAt: '2026-10-08T18:00:00.000Z', width: 640, height: 480, jpegBase64: Buffer.from([255,216,255,217]).toString('base64') };
describe('bounded curated live requests', () => {
  it('accepts only catalogue architecture and rejects free-text display or tenant fields', () => {
    expect(parseQaLiveSessionCommand(bytes(begin))).toEqual(begin);
    for (const change of [{ architecture: 'arm64' }, { tenantId: 'private' }, { displayName: 'forged' }, { runId: 123 }, { hostCustomConfig: null }]) {
      expect(parseQaLiveSessionCommand(bytes({ ...begin, ...change }))).toBeNull();
    }
  });
  it('rejects unknown phase, malformed timestamps, ended-session frame input and noncanonical JPEG encoding', () => {
    expect(parseQaLiveFrameCommand(bytes(frame))?.jpeg.length).toBe(4);
    for (const change of [{ sequence: -1 }, { width: 63 }, { capturedAt: 'yesterday' }, { jpegBase64: frame.jpegBase64 + ' ' }, { tenantId: 'private' }]) {
      expect(parseQaLiveFrameCommand(bytes({ ...frame, ...change }))).toBeNull();
    }
    expect(parseQaLiveSessionCommand(bytes({ action: 'phase', runId: '123', runAttempt: 1, sessionId: frame.sessionId, phase: 'passed', observedAt: frame.capturedAt }))).toBeNull();
  });
  it('bounds a chunked request even when Content-Length is absent or dishonest', async () => {
    const request = new Request('https://intuneget.com', { method: 'POST', body: '12345' });
    expect(await readQaLiveBody(request, 4)).toBeNull();
    expect(await readQaLiveBody(new Request('https://intuneget.com', { method: 'POST', body: '123', headers: { 'Content-Length': '999' } }), 4)).toBeNull();
  });
});
