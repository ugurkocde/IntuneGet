import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase';
import { isQaMaintenanceMode } from '@/lib/qa/maintenance';
import { isQaLivePublicEnabled } from '@/lib/qa/public-access';
import { authorizeQaLiveSession, isQaLiveSessionEnabled } from '@/lib/qa/live-session-auth';
import { loadQaLiveCuratedSnapshot } from '@/lib/qa/live-session-data';
import { projectQaLiveCurated } from '@/lib/qa/live-curated';
import { parseQaLiveFrameCommand, qaLiveJson, qaLiveRunTuple, qaLiveSessionId, readQaLiveBody } from '@/lib/qa/live-session-request';
import { applyRateLimit, applyStrictRateLimit, getIpKey, QA_LIVE_FRAME_RATE_LIMIT, QA_LIVE_INGEST_RATE_LIMIT } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
const BUCKET = 'qa-live-session-frames';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const reply = (data: object, status = 200) => NextResponse.json(data, { status, headers });
const absent = () => new NextResponse(null, { status: 404, headers });
function enabled(request: Request) {
  return isQaLivePublicEnabled(new URL(request.url).hostname) && isQaLiveSessionEnabled();
}
async function currentFrame(db: SupabaseClient, id: string) {
  const snapshot = await loadQaLiveCuratedSnapshot(db);
  const projected = projectQaLiveCurated({ ...snapshot, now: new Date() });
  if (!projected?.viewer.available || projected.viewer.sessionId !== id) return null;
  const { data, error } = await db.from('qa_live_session_frames')
    .select('object_path, sequence, byte_size').eq('session_id', id).maybeSingle();
  if (error || !data || data.sequence !== projected.viewer.sequence ||
    data.object_path !== `sessions/${id}/frame-${data.sequence}.jpg` || data.byte_size < 4 || data.byte_size > 204800) return null;
  return data as { object_path: string; sequence: number; byte_size: number };
}

export async function GET(request: Request) {
  if (!enabled(request)) return absent();
  if (isQaMaintenanceMode()) return new NextResponse(null, { status: 204, headers });
  const limited = await applyRateLimit(`qa-session-frame:${getIpKey(request)}`, QA_LIVE_FRAME_RATE_LIMIT);
  if (limited) return limited;
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('session');
    const sequence = url.searchParams.get('sequence');
    if (!qaLiveSessionId(id) || !sequence || !/^\d{1,16}$/.test(sequence) || !Number.isSafeInteger(Number(sequence))) return reply({ error: 'Invalid request' }, 400);
    const db: SupabaseClient = createServerClient();
    const frame = await currentFrame(db, id);
    if (!frame) return absent();
    const { data: image, error } = await db.storage.from(BUCKET).download(frame.object_path);
    if (error || !image || image.size !== frame.byte_size || image.size > 204800) return absent();
    const bytes = new Uint8Array(await image.arrayBuffer());
    // Re-check owner, privacy and freshness after Storage I/O. Never redirect to a public URL.
    const latest = await currentFrame(db, id);
    if (!latest || latest.object_path !== frame.object_path || bytes[0] !== 255 || bytes[1] !== 216 ||
      bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return absent();
    return new NextResponse(bytes, { headers: { ...headers, 'Content-Type': 'image/jpeg',
      'Content-Length': String(bytes.length), 'X-QA-Frame-Sequence': String(frame.sequence) } });
  } catch { return reply({ error: 'Live frame unavailable' }, 503); }
}

export async function POST(request: Request) {
  if (!enabled(request)) return absent();
  const limited = await applyStrictRateLimit(`qa-session-frame-ingest:${getIpKey(request)}`, QA_LIVE_INGEST_RATE_LIMIT);
  if (limited) return limited;
  try {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply({ error: 'Invalid request' }, 400);
    // The signed envelope binds all frame metadata as well as the JPEG bytes.
    const body = await readQaLiveBody(request, 275000);
    const command = body && parseQaLiveFrameCommand(body);
    if (!body || !command) return reply({ error: 'Invalid request' }, 400);
    const binding = { method: 'POST' as const, pathname: '/api/qa/live/session/frame' as const, action: 'frame' as const,
      runId: command.runId, runAttempt: command.runAttempt, sessionId: command.sessionId };
    if (!authorizeQaLiveSession(request, body, binding)) return reply({ error: 'Unauthorized' }, 401);
    const db: SupabaseClient = createServerClient();
    const tuple = { p_session_id: command.sessionId, p_run_id: command.runId, p_run_attempt: command.runAttempt };
    const { data: authorized, error: authError } = await db.rpc('authorize_qa_live_curated_frame', { ...tuple, p_captured_at: command.capturedAt });
    if (authError) return reply({ error: 'Live frame unavailable' }, 503);
    if (authorized !== true) return reply({ error: 'Unauthorized' }, 401);
    const { data: previous } = await db.from('qa_live_session_frames').select('object_path, sequence').eq('session_id', command.sessionId).maybeSingle();
    if (previous && previous.sequence >= command.sequence) return reply({ error: 'Stale frame' }, 409);
    const path = `sessions/${command.sessionId}/frame-${command.sequence}.jpg`;
    const { error: uploadError } = await db.storage.from(BUCKET).upload(path, command.jpeg, { contentType: 'image/jpeg', upsert: false, cacheControl: '0' });
    if (uploadError) return reply({ error: 'Live frame unavailable' }, 503);
    const { data: accepted, error: publishError } = await db.rpc('publish_qa_live_curated_frame_metadata', {
      ...tuple, p_object_path: path, p_sequence: command.sequence, p_captured_at: command.capturedAt,
      p_width: command.width, p_height: command.height, p_byte_size: command.jpeg.length,
    });
    if (publishError || accepted !== true) {
      await db.storage.from(BUCKET).remove([path]);
      return reply({ error: 'Stale frame' }, publishError ? 503 : 409);
    }
    if (previous?.object_path && /^sessions\/[0-9a-f-]+\/frame-\d+\.jpg$/i.test(previous.object_path) && previous.object_path.startsWith(`sessions/${command.sessionId}/`)) {
      await db.storage.from(BUCKET).remove([previous.object_path]);
    }
    return reply({ accepted: true, sequence: command.sequence });
  } catch { return reply({ error: 'Live frame unavailable' }, 503); }
}

export async function DELETE(request: Request) {
  if (!enabled(request)) return absent();
  const limited = await applyStrictRateLimit(`qa-session-frame-cleanup:${getIpKey(request)}`, QA_LIVE_INGEST_RATE_LIMIT);
  if (limited) return limited;
  try {
    const body = await readQaLiveBody(request, 2048);
    const data = body && qaLiveJson(body);
    if (!body || !data || !qaLiveRunTuple(data) || !qaLiveSessionId(data.sessionId) ||
      Object.keys(data).sort().join(',') !== 'runAttempt,runId,sessionId') return reply({ error: 'Invalid request' }, 400);
    if (!authorizeQaLiveSession(request, body, { method: 'DELETE', pathname: '/api/qa/live/session/frame', action: 'frame-cleanup',
      ...qaLiveRunTuple(data)!, sessionId: data.sessionId })) return reply({ error: 'Unauthorized' }, 401);
    const db: SupabaseClient = createServerClient();
    const { data: ended, error } = await db.rpc('end_qa_live_curated_session', { p_session_id: data.sessionId, p_run_id: data.runId, p_run_attempt: data.runAttempt });
    if (error || ended?.status !== 'ended') return reply({ error: 'Cleanup unavailable' }, error ? 503 : 409);
    const { data: objects } = await db.storage.from(BUCKET).list(`sessions/${data.sessionId}`, { limit: 100 });
    const paths = (objects ?? []).filter(object => /^frame-\d+\.jpg$/.test(object.name)).map(object => `sessions/${data.sessionId}/${object.name}`);
    if (paths.length) await db.storage.from(BUCKET).remove(paths);
    return reply({ cleared: true });
  } catch { return reply({ error: 'Cleanup unavailable' }, 503); }
}
