import { describe, expect, it } from 'vitest';
import {
  formatQaDuration,
  formatRelativeTime,
  getQaFrameState,
  getQaPhasePresentation,
} from './presentation';

describe('QA presentation helpers', () => {
  it('maps an active phase to a compact step presentation', () => {
    expect(getQaPhasePresentation('installing')).toEqual({
      label: 'Installing',
      step: 4,
      totalSteps: 8,
      progressPercent: 50,
    });
  });

  it('presents the VirusTotal reputation lookup as the first execution step', () => {
    expect(getQaPhasePresentation('scanning_installer')).toEqual({
      label: 'Checking installer reputation',
      step: 1,
      totalSteps: 8,
      progressPercent: 13,
    });
  });

  it('treats queued work as before the first execution step', () => {
    expect(getQaPhasePresentation('queued')).toEqual({
      label: 'Queued',
      step: 0,
      totalSteps: 8,
      progressPercent: 0,
    });
  });

  it('only labels a recently captured available frame as live', () => {
    const serverTime = '2026-08-09T12:00:20.000Z';
    expect(getQaFrameState({ available: false, capturedAt: null, serverTime })).toBe('waiting');
    expect(getQaFrameState({ available: true, capturedAt: null, serverTime })).toBe('paused');
    expect(getQaFrameState({ available: true, capturedAt: '2026-08-09T12:00:06.000Z', serverTime })).toBe('live');
    expect(getQaFrameState({ available: true, capturedAt: '2026-08-09T12:00:04.000Z', serverTime })).toBe('paused');
  });

  it('calculates relative times against the server clock', () => {
    expect(formatRelativeTime('2026-08-09T11:58:20.000Z', '2026-08-09T12:00:20.000Z')).toBe('2m ago');
    expect(formatRelativeTime(null, '2026-08-09T12:00:20.000Z')).toBeNull();
  });

  it('formats seconds, minutes, and hours consistently', () => {
    expect(formatQaDuration(null)).toBe('—');
    expect(formatQaDuration(42.4)).toBe('42s');
    expect(formatQaDuration(98.9)).toBe('1m 39s');
    expect(formatQaDuration(3_720)).toBe('1h 2m');
  });
});
