import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isQaLiveSessionEnabled } from './live-session-auth';
import { curatedBindingAllowsPublicFrames, type QaCuratedLiveBinding, type QaCuratedLiveFrameRow, type QaCuratedLiveSessionRow } from './live-curated';

export async function loadQaLiveCuratedSnapshot(supabase: SupabaseClient): Promise<{
  binding: QaCuratedLiveBinding | null;
  session: QaCuratedLiveSessionRow | null;
  frame: QaCuratedLiveFrameRow | null;
}> {
  const empty = { binding: null, session: null, frame: null };
  let binding: QaCuratedLiveBinding | null = null;
  try {
    const queue = await supabase.from('curated_verification_queue')
      .select('id, app_id, version, kind, status, inputs, dispatched_at, github_run_id').eq('status', 'dispatched').limit(2);
    // Missing or contradictory telemetry must not break the ordinary feed.
    if (queue.error || !Array.isArray(queue.data) || queue.data.length !== 1) return empty;
    binding = queue.data[0] as QaCuratedLiveBinding;
    if (!isQaLiveSessionEnabled()) return { ...empty, binding };
    const sessionResult = await supabase.from('qa_live_sessions')
      .select('id, queue_id, app_id, version, architecture, verification, public_frames, upgrade_planned, github_run_id, state, phase, phase_started_at, started_at, heartbeat_at')
      .eq('state', 'active').eq('queue_id', binding.id).limit(2);
    if (sessionResult.error || !Array.isArray(sessionResult.data) || sessionResult.data.length !== 1) return { ...empty, binding };
    const session = sessionResult.data[0] as QaCuratedLiveSessionRow;
    if (!session.public_frames || session.verification !== 'release' || !curatedBindingAllowsPublicFrames(binding)) return { binding, session, frame: null };
    const frameResult = await supabase.from('qa_live_session_frames')
      .select('session_id, sequence, captured_at, updated_at, width, height').eq('session_id', session.id).maybeSingle();
    return { binding, session, frame: frameResult.error ? null : frameResult.data as QaCuratedLiveFrameRow | null };
  } catch {
    // Optional telemetry transport failure cannot take the ordinary feed down.
    return { ...empty, binding };
  }
}
