import { describe, expect, it } from 'vitest';
import { deriveQaBadgeState } from './status';
import type { QaStatus } from '@/types/qa';

const passed: QaStatus = {
  outcome: 'Passed',
  testedVersion: '8.9.7',
  architecture: 'x64',
  testedAtUtc: '2026-08-07T12:48:35Z',
};

describe('deriveQaBadgeState', () => {
  it('models missing results as untested', () => {
    expect(deriveQaBadgeState(null, '8.9.7')).toBe('untested');
  });

  it('returns passed and failed for an exact version', () => {
    expect(deriveQaBadgeState(passed, '8.9.7')).toBe('passed');
    expect(deriveQaBadgeState({ ...passed, outcome: 'Failed' }, '8.9.7')).toBe('failed');
  });

  it('uses exact strings when deriving stale results', () => {
    expect(deriveQaBadgeState(passed, '8.9.70')).toBe('stale_passed');
    expect(deriveQaBadgeState({ ...passed, outcome: 'Failed' }, '8.9.8')).toBe('stale_failed');
  });
});
