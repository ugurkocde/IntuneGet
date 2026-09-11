import { describe, expect, it } from 'vitest';
import { evidenceTargetName, getEvidencePhaseStatus, getEvidenceSummary } from './evidence-presentation';
import type { QaPhaseResults } from '@/types/qa';

const passed = { exitCode: 0, durationSeconds: 4, timedOut: false };
const complete: QaPhaseResults = {
  install: passed,
  detectionAfterInstall: passed,
  uninstall: passed,
  detectionAfterUninstall: { ...passed, exitCode: 1 },
};

describe('QA evidence wording', () => {
  it('only describes a fully recorded passing lifecycle as passed', () => {
    expect(getEvidenceSummary('Passed', complete)).toContain('all passed');
    expect(getEvidenceSummary('Failed', complete)).toContain('reported a failure');
    expect(getEvidenceSummary('Passed', { ...complete, detectionAfterUninstall: null })).toContain('not recorded');
  });

  it('distinguishes a stopped lifecycle from one that continued after failure', () => {
    const install = { ...passed, exitCode: 1603 };
    expect(getEvidenceSummary('Failed', { install, detectionAfterInstall: null, uninstall: null, detectionAfterUninstall: null }))
      .toBe('Install failed. Later checks were not run.');
    expect(getEvidenceSummary('Failed', { ...complete, install })).toBe('Install failed. Review the recorded checks below.');
  });

  it('does not treat a timed-out removal check as successful non-detection', () => {
    const timedOut = { ...passed, exitCode: 1, timedOut: true };
    expect(getEvidencePhaseStatus('detectionAfterUninstall', timedOut).passed).toBe(false);
    expect(getEvidenceSummary('Failed', { ...complete, detectionAfterUninstall: timedOut })).toContain('timed out');
    expect(getEvidencePhaseStatus('detectionAfterUninstall', passed).label).toBe('Still detected');
  });

  it('accepts reboot success for installation but not detection', () => {
    for (const exitCode of [3010, 1641]) {
      expect(getEvidencePhaseStatus('install', { ...passed, exitCode }).passed).toBe(true);
      expect(getEvidencePhaseStatus('detectionAfterInstall', { ...passed, exitCode }).passed).toBe(false);
    }
    expect(getEvidencePhaseStatus('uninstall', null).label).toBe('Not run');
  });

  it('extracts a readable leaf while preserving root-only targets', () => {
    expect(evidenceTargetName('%PROGRAMFILES%\\Example\\app.exe')).toBe('app.exe');
    expect(evidenceTargetName('HKLM\\Software\\Example\\')).toBe('Example');
    expect(evidenceTargetName('HKLM')).toBe('HKLM');
    expect(evidenceTargetName('/')).toBe('/');
  });
});
