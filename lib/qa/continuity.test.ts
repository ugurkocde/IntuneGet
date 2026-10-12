import { describe, expect, it } from 'vitest';
import { isDeferredCustomerQaEnabled } from './continuity';

describe('isDeferredCustomerQaEnabled', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');

  it('enables an explicitly bounded future window', () => {
    expect(isDeferredCustomerQaEnabled(now, '2026-09-08T11:59:59.000Z')).toBe(true);
  });

  it.each([
    undefined,
    '',
    'not-a-date',
    '2026-09-01T12:00:00.000Z',
    '2026-09-10T12:00:00.000Z',
  ])('fails closed for missing, invalid, expired, or excessive values: %s', (value) => {
    expect(isDeferredCustomerQaEnabled(now, value)).toBe(false);
  });
});
