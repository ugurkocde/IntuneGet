import 'server-only';
import { decodeQaLiveSessionKey, verifyQaLiveSessionSignature, type QaLiveSignatureBinding } from './live-session-signature';

function sessionKeys(): Buffer[] {
  const current = decodeQaLiveSessionKey(process.env.QA_LIVE_CURATED_HMAC_KEY);
  // A previous key never enables the feature on its own.
  if (!current) return [];
  const previous = decodeQaLiveSessionKey(process.env.QA_LIVE_CURATED_HMAC_KEY_PREVIOUS);
  return previous ? [current, previous] : [current];
}

export function isQaLiveSessionEnabled(): boolean {
  return sessionKeys().length > 0;
}

export function authorizeQaLiveSession(request: Request, body: Uint8Array, binding: QaLiveSignatureBinding, now = new Date()): boolean {
  const url = new URL(request.url);
  if (request.method !== binding.method || url.pathname !== binding.pathname || url.search !== '') return false;
  return verifyQaLiveSessionSignature({ authorization: request.headers.get('authorization'), binding, body, keys: sessionKeys(), now });
}
