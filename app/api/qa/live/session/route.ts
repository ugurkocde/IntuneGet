import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerClient } from '@/lib/supabase';
import { isQaLivePublicEnabled } from '@/lib/qa/public-access';
import { authorizeQaLiveSession, isQaLiveSessionEnabled } from '@/lib/qa/live-session-auth';
import { parseQaLiveSessionCommand, qaLiveCommandBinding, readQaLiveBody } from '@/lib/qa/live-session-request';
import { applyStrictRateLimit, getIpKey, QA_LIVE_INGEST_RATE_LIMIT } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const reply = (data: object, status = 200) => NextResponse.json(data, { status, headers });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function removeEndedFrames(db: SupabaseClient, ids: unknown) {
  if (!Array.isArray(ids)) return;
  for (const id of ids.slice(0, 2)) {
    if (typeof id !== 'string' || !UUID.test(id)) continue;
    const { data: objects, error } = await db.storage.from('qa-live-session-frames').list(`sessions/${id}`, { limit: 100 });
    if (error) continue;
    const paths = (objects ?? []).filter(object => /^frame-\d+\.jpg$/.test(object.name)).map(object => `sessions/${id}/${object.name}`);
    if (paths.length) await db.storage.from('qa-live-session-frames').remove(paths);
    await db.from('qa_live_session_frames').delete().eq('session_id', id);
  }
}

export async function POST(request: Request) {
  if (!isQaLivePublicEnabled(new URL(request.url).hostname) || !isQaLiveSessionEnabled()) return reply({ error: 'Not found' }, 404);
  const limited = await applyStrictRateLimit(`qa-session:${getIpKey(request)}`, QA_LIVE_INGEST_RATE_LIMIT);
  if (limited) return limited;
  try {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return reply({ error: 'Invalid request' }, 400);
    const bytes = await readQaLiveBody(request, 2048);
    const command = bytes && parseQaLiveSessionCommand(bytes);
    if (!bytes || !command) return reply({ error: 'Invalid request' }, 400);
    if (!authorizeQaLiveSession(request, bytes, qaLiveCommandBinding(command))) return reply({ error: 'Unauthorized' }, 401);
    const db: SupabaseClient = createServerClient();
    if (command.action === 'begin') {
      const { data, error } = await db.rpc('begin_qa_live_curated_session', {
        p_app_id: command.appId, p_version: command.version, p_architecture: command.architecture,
        p_upgrade_planned: command.upgradePlanned, p_host_custom_config: command.hostCustomConfig,
        p_run_id: command.runId, p_run_attempt: command.runAttempt,
      });
      if (error) return reply({ error: 'Progress unavailable' }, 503);
      if (!data || !['started', 'resumed'].includes(data.status) || !UUID.test(data.sessionId)) return reply({ status: 'refused' }, 409);
      // The session already started. Cleanup failure must not make the runner retry begin.
      try { await removeEndedFrames(db, data.endedSessionIds); } catch { /* Leftover objects stay private and are never served. */ }
      return reply({ status: data.status, sessionId: data.sessionId, publicFrames: data.publicFrames === true });
    }
    const tuple = { p_session_id: command.sessionId, p_run_id: command.runId, p_run_attempt: command.runAttempt };
    if (command.action === 'phase') {
      const { data, error } = await db.rpc('publish_qa_live_curated_phase', { ...tuple, p_phase: command.phase, p_observed_at: command.observedAt });
      return error ? reply({ error: 'Progress unavailable' }, 503) : reply({ accepted: data === true }, data === true ? 200 : 409);
    }
    const { data, error } = await db.rpc('end_qa_live_curated_session', tuple);
    if (error) return reply({ error: 'Progress unavailable' }, 503);
    if (data?.status !== 'ended') return reply({ status: 'refused' }, 409);
    await removeEndedFrames(db, [command.sessionId]);
    return reply({ status: 'ended' });
  } catch { return reply({ error: 'Progress unavailable' }, 503); }
}
