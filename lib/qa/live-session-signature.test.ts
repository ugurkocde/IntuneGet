import { describe, expect, it } from 'vitest';
import { decodeQaLiveSessionKey, qaLiveSessionMessage, signQaLiveSessionMessage, verifyQaLiveSessionSignature, type QaLiveSignatureBinding } from './live-session-signature';

const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
const timestamp = 1_700_000_000;
const body = Buffer.from('{"action":"begin"}');
const binding: QaLiveSignatureBinding = { method: 'POST', pathname: '/api/qa/live/session', action: 'begin', runId: '123456789', runAttempt: 1, sessionId: null };
const canonical = 'intuneget-qa-live-curated-v1\nPOST\n/api/qa/live/session\nbegin\n123456789\n1\n-\n1700000000\n' +
  'dc3b5bfad658f1c5394a7344d6cb44056726cb86445ca2cc4f1b3956f451596d';
function verify(overrides: Partial<Parameters<typeof verifyQaLiveSessionSignature>[0]> = {}) {
  return verifyQaLiveSessionSignature({ authorization: `IntuneQA-HMAC-SHA256 kid=curated-v1,ts=${timestamp},sig=${signQaLiveSessionMessage(key, binding, timestamp, body)}`, binding, body, keys: [key], now: new Date(timestamp * 1000), ...overrides });
}

describe('curated live HMAC', () => {
  it('binds the request bytes, path, action, run and attempt', () => {
    const message = qaLiveSessionMessage(binding, timestamp, body);
    expect(message).toBe(canonical);
    // Independently computed with .NET HMACSHA256; shared by the host test.
    expect(signQaLiveSessionMessage(key, binding, timestamp, body)).toBe('c05ed58a89920511ae5dc38654a0cd534ce40f8da9daffca691a9f30ff61e562');
    expect(verify()).toBe(true);
    expect(verify({ body: Buffer.from('{"action":"end"}') })).toBe(false);
    expect(verify({ binding: { ...binding, runAttempt: 2 } })).toBe(false);
    expect(verify({ binding: { ...binding, runId: '123456788' } })).toBe(false);
    expect(verify({ keys: [Buffer.alloc(32, 1)] })).toBe(false);
  });

  it('rejects missing keys and signatures and stale or malformed timestamps', () => {
    expect(verify({ keys: [] })).toBe(false);
    expect(verify({ authorization: null })).toBe(false);
    expect(verify({ now: new Date((timestamp + 121) * 1000) })).toBe(false);
    expect(verify({ now: new Date((timestamp - 121) * 1000) })).toBe(false);
    expect(verify({ now: new Date('invalid') })).toBe(false);
    expect(verify({ authorization: 'Bearer ordinary-sync-secret' })).toBe(false);
  });

  it('allows the exact rotation key and window boundary', () => {
    expect(verify({ keys: [Buffer.alloc(32, 1), key] })).toBe(true);
    expect(verify({ now: new Date((timestamp + 120) * 1000) })).toBe(true);
  });

  it('refuses ambiguous or invalid request bindings', () => {
    for (const altered of [{ runId: '1\nbegin' }, { runId: '0' }, { runAttempt: 0 }, { runAttempt: 1.5 }, { sessionId: 'bad' }, { method: 'DELETE' }, { action: 'end' }]) {
      expect(qaLiveSessionMessage({ ...binding, ...altered } as QaLiveSignatureBinding, timestamp, body)).toBeNull();
    }
  });

  it('requires canonical base64 with a full size key', () => {
    expect(decodeQaLiveSessionKey(key.toString('base64'))).toEqual(key);
    for (const value of [undefined, '', 'not a key', Buffer.alloc(31).toString('base64'), key.toString('base64') + '\n', Buffer.alloc(129).toString('base64')]) {
      expect(decodeQaLiveSessionKey(value)).toBeNull();
    }
  });
});
