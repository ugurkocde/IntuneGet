import type { Json } from '@/types/database';

const MIN_DELAY_MS = 60_000;
const MAX_DELAY_MS = 65 * 60_000;
const MAX_DEFERRALS = 5;
const ATTEMPTS_KEY = 'workflow_dispatch_rate_limit_attempts';

export class WorkflowDispatchRateLimitError extends Error {
  readonly code = 'WORKFLOW_DISPATCH_RATE_LIMITED';
  constructor(readonly status: number, readonly retryAt: string) {
    super('GitHub temporarily refused to start packaging because its request limit was reached.');
    this.name = 'WorkflowDispatchRateLimitError';
  }
}

/** A response must explicitly reject dispatch before it may be sent again. */
export function dispatchRateLimitError(response: Response, detail: string, now = Date.now()) {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const retryAfter = response.headers.get('retry-after');
  if (response.status !== 429 && !(response.status === 403 &&
    (remaining === '0' || retryAfter !== null || /rate limit|abuse detection/i.test(detail)))) return null;

  const seconds = retryAfter !== null && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())
    ? Number(retryAfter) : NaN;
  const retryTime = Number.isFinite(seconds) ? now + seconds * 1000
    : retryAfter ? Date.parse(retryAfter) : NaN;
  const resetSeconds = remaining === '0' ? Number(response.headers.get('x-ratelimit-reset')) : NaN;
  const resetTime = resetSeconds > 0 && Number.isFinite(resetSeconds) ? resetSeconds * 1000 : NaN;
  const proposed = Math.max(now + MIN_DELAY_MS,
    Number.isFinite(retryTime) ? retryTime : 0, Number.isFinite(resetTime) ? resetTime : 0);
  // Never shorten a server supplied delay to fit a local retry budget.
  const retryAt = proposed <= 8.64e15 ? new Date(proposed).toISOString() : null;
  return retryAt ? new WorkflowDispatchRateLimitError(response.status, retryAt) : null;
}

/** Persist the bounded budget in existing job error metadata on both databases. */
export function dispatchRateLimitHold(error: WorkflowDispatchRateLimitError, details: Json | null, now = Date.now()) {
  if (details !== null && (typeof details !== 'object' || Array.isArray(details))) return null;
  const previous = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
  const count = previous[ATTEMPTS_KEY] ?? 0;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count >= MAX_DEFERRALS) return null;
  const requested = Date.parse(error.retryAt);
  const due = Math.max(requested, now + MIN_DELAY_MS * 2 ** count);
  if (!Number.isFinite(due) || due > now + MAX_DELAY_MS) return null;
  return {
    status: 'awaiting_qa',
    status_message: 'Waiting for GitHub capacity. Packaging will retry automatically.',
    qa_resume_due_at: new Date(due).toISOString(),
    packaging_started_at: null,
    completed_at: null,
    error_code: error.code,
    error_stage: 'authenticate',
    error_category: 'network',
    error_message: error.message,
    error_details: { ...previous, [ATTEMPTS_KEY]: count + 1 } as Json,
  };
}
