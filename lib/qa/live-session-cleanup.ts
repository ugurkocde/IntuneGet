import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isQaLiveSessionEnabled } from './live-session-auth';
const BUCKET = 'qa-live-session-frames';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function cleanupCuratedLiveSessions(db: SupabaseClient) {
  if (!isQaLiveSessionEnabled()) return { cleanedSessions: 0, skippedSessions: 0, removedObjects: 0 };
  const { error: expireError } = await db.rpc('expire_qa_live_curated_sessions');
  if (expireError) throw new Error('Could not expire curated live sessions');
  const { data: sessions, error } = await db.from('qa_live_sessions').select('id')
    .eq('state', 'ended').is('frames_cleaned_at', null).order('ended_at', { ascending: true }).limit(25);
  if (error) throw new Error('Could not load ended curated live sessions');
  let cleanedSessions = 0;
  let removedObjects = 0;
  for (const session of sessions ?? []) {
    if (typeof session.id !== 'string' || !UUID.test(session.id)) continue;
    const prefix = `sessions/${session.id}`;
    const bucket = db.storage.from(BUCKET);
    try {
      const { data: objects, error: listError } = await bucket.list(prefix, { limit: 100 });
      if (listError) continue;
      const paths = (objects ?? []).filter(object => /^frame-\d+\.jpg$/.test(object.name)).map(object => `${prefix}/${object.name}`);
      if (paths.length) {
        const { error: removeError } = await bucket.remove(paths);
        if (removeError) continue;
        removedObjects += paths.length;
      }
      const { data: remaining, error: remainingError } = await bucket.list(prefix, { limit: 1 });
      if (remainingError || remaining?.length) continue; // Another bounded cron pass handles overflow.
      const { error: frameError } = await db.from('qa_live_session_frames').delete().eq('session_id', session.id);
      if (frameError) continue;
      const { error: updateError } = await db.from('qa_live_sessions').update({ frames_cleaned_at: new Date().toISOString() })
        .eq('id', session.id).eq('state', 'ended');
      if (!updateError) cleanedSessions++;
    } catch { /* Storage outages remain retryable; no active owner is touched. */ }
  }
  return { cleanedSessions, skippedSessions: (sessions?.length ?? 0) - cleanedSessions, removedObjects };
}
