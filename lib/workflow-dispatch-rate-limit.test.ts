import { describe, expect, it } from 'vitest';
import type { Json } from '@/types/database';
import { dispatchRateLimitError, dispatchRateLimitHold, WorkflowDispatchRateLimitError } from './workflow-dispatch-rate-limit';

const now = Date.parse('2026-11-10T10:00:00Z');
describe('explicit GitHub dispatch rejection', () => {
  it.each([
    [429, {}, ''], [403, { 'x-ratelimit-remaining': '0' }, ''],
    [403, { 'retry-after': '120' }, ''], [403, {}, 'secondary rate limit exceeded'],
  ])('classifies an explicit rate limit %s %j', (status, headers, body) => {
    const error = dispatchRateLimitError(new Response(body, { status, headers }), body, now);
    expect(error).toBeInstanceOf(WorkflowDispatchRateLimitError);
    expect(error?.message).not.toContain(body || 'synthetic secret');
    expect(Date.parse(error!.retryAt)).toBeGreaterThanOrEqual(now + 60_000);
  });
  it.each([401, 404, 422, 500, 502, 503, 504])('does not retry ambiguous or permanent status %s', status => {
    expect(dispatchRateLimitError(new Response('', { status }), 'rate limit', now)).toBeNull();
  });
  it('does not classify a permission denial as a rate limit', () => {
    expect(dispatchRateLimitError(new Response('', { status: 403 }), 'Resource not accessible by integration', now)).toBeNull();
  });
  it('respects the latest server delay and never truncates a long reset', () => {
    const error = dispatchRateLimitError(new Response('', { status: 403, headers: {
      'retry-after': '120', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((now + 7_200_000) / 1000),
    } }), '', now)!;
    expect(error.retryAt).toBe(new Date(now + 7_200_000).toISOString());
    expect(dispatchRateLimitHold(error, null, now)).toBeNull();
  });
  it('parses HTTP date Retry After', () => {
    const error = dispatchRateLimitError(new Response('', { status: 429, headers: { 'retry-after': new Date(now + 180_000).toUTCString() } }), '', now)!;
    expect(error.retryAt).toBe(new Date(now + 180_000).toISOString());
  });
  it('persists five increasing deferrals and then exhausts the budget', () => {
    const error = new WorkflowDispatchRateLimitError(429, new Date(now + 60_000).toISOString());
    let details: Json | null = null;
    for (let n = 0; n < 5; n++) {
      const held = dispatchRateLimitHold(error, details, now)!;
      expect(held.qa_resume_due_at).toBe(new Date(now + 60_000 * 2 ** n).toISOString());
      expect(held.completed_at).toBeNull();
      details = held.error_details;
    }
    expect(dispatchRateLimitHold(error, details, now)).toBeNull();
  });
  it.each([-1, 0.5, '0', 999])('fails closed on invalid or exhausted metadata %s', count => {
    expect(dispatchRateLimitHold(new WorkflowDispatchRateLimitError(429, new Date(now).toISOString()),
      { workflow_dispatch_rate_limit_attempts: count }, now)).toBeNull();
  });
});
