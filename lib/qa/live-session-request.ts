import { curatedLivePhase, resolveCuratedAppForLive } from './live-curated';
import type { QaCuratedLivePhase } from '@/types/qa';
import type { QaLiveSignatureBinding } from './live-session-signature';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Base = { runId: string; runAttempt: number };
export type QaLiveSessionCommand =
  | (Base & { action: 'begin'; appId: string; version: string; architecture: string; upgradePlanned: boolean; hostCustomConfig: boolean })
  | (Base & { action: 'phase'; sessionId: string; phase: QaCuratedLivePhase; observedAt: string })
  | (Base & { action: 'end'; sessionId: string });

export async function readQaLiveBody(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) return null;
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally { reader.releaseLock(); }
}

export function qaLiveJson(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch { return null; }
}

function onlyKeys(data: Record<string, unknown>, keys: string[]) {
  return Object.keys(data).every(key => keys.includes(key)) && keys.every(key => Object.hasOwn(data, key));
}
export function qaLiveRunTuple(data: Record<string, unknown>): Base | null {
  return typeof data.runId === 'string' && /^[1-9][0-9]{0,17}$/.test(data.runId) &&
    typeof data.runAttempt === 'number' && Number.isInteger(data.runAttempt) && data.runAttempt >= 1 && data.runAttempt <= 100
    ? { runId: data.runId, runAttempt: data.runAttempt } : null;
}
export function qaLiveSessionId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
export function qaLiveTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export function parseQaLiveSessionCommand(bytes: Uint8Array): QaLiveSessionCommand | null {
  const data = qaLiveJson(bytes);
  if (!data || !qaLiveRunTuple(data)) return null;
  const common = ['action', 'runId', 'runAttempt'];
  if (data.action === 'begin') {
    if (!onlyKeys(data, [...common, 'appId', 'version', 'architecture', 'upgradePlanned', 'hostCustomConfig']) ||
      typeof data.appId !== 'string' || typeof data.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(data.version) ||
      typeof data.upgradePlanned !== 'boolean' || typeof data.hostCustomConfig !== 'boolean') return null;
    const app = resolveCuratedAppForLive(data.appId);
    if (!app || data.architecture !== app.architecture) return null;
  } else if (data.action === 'phase') {
    if (!onlyKeys(data, [...common, 'sessionId', 'phase', 'observedAt']) || !qaLiveSessionId(data.sessionId) ||
      !curatedLivePhase(data.phase) || !qaLiveTimestamp(data.observedAt)) return null;
  } else if (data.action === 'end') {
    if (!onlyKeys(data, [...common, 'sessionId']) || !qaLiveSessionId(data.sessionId)) return null;
  } else return null;
  return data as QaLiveSessionCommand;
}
export function qaLiveCommandBinding(command: QaLiveSessionCommand): QaLiveSignatureBinding {
  return { method: 'POST', pathname: '/api/qa/live/session', action: command.action,
    runId: command.runId, runAttempt: command.runAttempt, sessionId: command.action === 'begin' ? null : command.sessionId };
}

export function parseQaLiveFrameCommand(bytes: Uint8Array) {
  const data = qaLiveJson(bytes);
  if (!data || !qaLiveRunTuple(data) || !qaLiveSessionId(data.sessionId) ||
    !onlyKeys(data, ['runId', 'runAttempt', 'sessionId', 'sequence', 'capturedAt', 'width', 'height', 'jpegBase64']) ||
    !qaLiveTimestamp(data.capturedAt) || typeof data.sequence !== 'number' || !Number.isSafeInteger(data.sequence) || data.sequence < 0 ||
    typeof data.width !== 'number' || !Number.isInteger(data.width) || data.width < 64 || data.width > 1920 ||
    typeof data.height !== 'number' || !Number.isInteger(data.height) || data.height < 64 || data.height > 1200 ||
    typeof data.jpegBase64 !== 'string' || data.jpegBase64.length > 273068) return null;
  const jpeg = Buffer.from(data.jpegBase64, 'base64');
  if (jpeg.toString('base64') !== data.jpegBase64 || jpeg.length < 4 || jpeg.length > 204800 ||
    jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[jpeg.length - 2] !== 0xff || jpeg[jpeg.length - 1] !== 0xd9) return null;
  return { ...qaLiveRunTuple(data)!, sessionId: data.sessionId, sequence: data.sequence, capturedAt: data.capturedAt,
    width: data.width, height: data.height, jpeg };
}
