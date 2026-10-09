import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type QaLiveSessionAction = 'begin' | 'phase' | 'end' | 'frame' | 'frame-cleanup';
export interface QaLiveSignatureBinding {
  method: 'POST' | 'DELETE';
  pathname: '/api/qa/live/session' | '/api/qa/live/session/frame';
  action: QaLiveSessionAction;
  runId: string;
  runAttempt: number;
  sessionId: string | null;
}

const PURPOSE = 'intuneget-qa-live-curated-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SKEW_SECONDS = 120;

function validBinding(binding: QaLiveSignatureBinding): boolean {
  if (!/^[1-9][0-9]{0,17}$/.test(binding.runId) ||
      !Number.isSafeInteger(binding.runAttempt) || binding.runAttempt < 1 || binding.runAttempt > 100 ||
      (binding.sessionId !== null && !UUID.test(binding.sessionId))) return false;
  if (binding.pathname === '/api/qa/live/session') {
    return binding.method === 'POST' &&
      (binding.action === 'begin' ? binding.sessionId === null :
        (binding.action === 'phase' || binding.action === 'end') && binding.sessionId !== null);
  }
  return binding.pathname === '/api/qa/live/session/frame' && binding.sessionId !== null &&
    ((binding.method === 'POST' && binding.action === 'frame') ||
     (binding.method === 'DELETE' && binding.action === 'frame-cleanup'));
}

/** Strict base64 avoids accidentally accepting a different or truncated key. */
export function decodeQaLiveSessionKey(value: string | undefined): Buffer | null {
  if (!value || value.length > 172 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.length >= 32 && decoded.length <= 128 && decoded.toString('base64') === value ? decoded : null;
}

export function qaLiveSessionMessage(binding: QaLiveSignatureBinding, timestamp: number, body: Uint8Array): string | null {
  if (!validBinding(binding) || !Number.isSafeInteger(timestamp) || timestamp < 1) return null;
  return [PURPOSE, binding.method, binding.pathname, binding.action, binding.runId,
    String(binding.runAttempt), binding.sessionId ?? '-', String(timestamp),
    createHash('sha256').update(body).digest('hex')].join('\n');
}

export function signQaLiveSessionMessage(key: Uint8Array, binding: QaLiveSignatureBinding, timestamp: number, body: Uint8Array): string | null {
  const message = qaLiveSessionMessage(binding, timestamp, body);
  if (!message || key.length < 32 || key.length > 128) return null;
  return createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

export function verifyQaLiveSessionSignature(input: {
  authorization: string | null;
  binding: QaLiveSignatureBinding;
  body: Uint8Array;
  keys: readonly Uint8Array[];
  now: Date;
}): boolean {
  const match = input.authorization?.match(/^IntuneQA-HMAC-SHA256 kid=curated-v1,ts=([1-9][0-9]{0,11}),sig=([0-9a-f]{64})$/);
  if (!match || !Number.isFinite(input.now.getTime())) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(Math.floor(input.now.getTime() / 1000) - timestamp) > SKEW_SECONDS) return false;
  const supplied = Buffer.from(match[2], 'hex');
  return input.keys.some(key => {
    const expected = signQaLiveSessionMessage(key, input.binding, timestamp, input.body);
    return expected !== null && timingSafeEqual(supplied, Buffer.from(expected, 'hex'));
  });
}
