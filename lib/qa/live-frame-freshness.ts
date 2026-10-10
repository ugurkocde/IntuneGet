import { QA_LIVE_FRAME_MAX_AGE_MS } from './constants';

export function isQaFrameFresh(frame: { captured_at: string; updated_at: string } | null, startedAt: string | null, now = Date.now()): boolean {
  if (!frame || !startedAt) return false;
  const started = Date.parse(startedAt);
  const captured = Date.parse(frame.captured_at);
  const updated = Date.parse(frame.updated_at);
  return [started, captured, updated, now].every(Number.isFinite) &&
    captured >= started && updated >= started && captured <= updated + 5_000 &&
    captured <= now + 5_000 && updated <= now + 5_000 &&
    now - captured <= QA_LIVE_FRAME_MAX_AGE_MS && now - updated <= QA_LIVE_FRAME_MAX_AGE_MS;
}
