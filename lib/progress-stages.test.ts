import { describe, expect, it } from 'vitest';
import { getCompletedStages, getCurrentStage } from './progress-stages';

describe('failed job progress stages', () => {
  it('completes no pipeline stage for a validation failure before dispatch', () => {
    expect(getCompletedStages(0, 'failed', 'validation')).toEqual([]);
    expect(getCurrentStage(0, 'failed', 'validation')).toBeNull();
  });

  it('completes no pipeline stage for any unrecognised failure stage', () => {
    expect(getCompletedStages(0, 'failed', 'duplicate_check')).toEqual([]);
  });

  it('keeps the stages before a pipeline failure complete', () => {
    expect(getCompletedStages(55, 'failed', 'authenticate')).toEqual(['queued', 'download', 'package']);
    expect(getCurrentStage(55, 'failed', 'authenticate')?.id).toBe('authenticate');
  });
});
