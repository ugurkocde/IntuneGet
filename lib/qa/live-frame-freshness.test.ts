import { describe, expect, it } from 'vitest';
import { isQaFrameFresh } from './live-frame-freshness';
const now = Date.parse('2026-10-08T18:00:00Z');
const started = '2026-10-08T17:59:55Z';
const frame = { captured_at: '2026-10-08T17:59:58Z', updated_at: '2026-10-08T17:59:59Z' };
describe('attempt-bound live frames', () => {
  it('accepts current evidence and rejects another attempt, delayed uploads, invalid and future clocks', () => {
    expect(isQaFrameFresh(frame, started, now)).toBe(true);
    expect(isQaFrameFresh(frame, '2026-10-08T18:00:00Z', now)).toBe(false);
    for (const changed of [{ captured_at: '2026-10-08T17:59:40Z' }, { updated_at: 'invalid' }, { captured_at: '2026-10-08T18:00:06Z' }]) {
      expect(isQaFrameFresh({ ...frame, ...changed }, started, now)).toBe(false);
    }
  });
});
