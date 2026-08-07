import { describe, expect, it } from 'vitest';
import {
  assertCompleteQaListing,
  toQaResultRow,
  validateQaDefinition,
} from './sync-qa-results.mjs';

function validDefinition() {
  const counts = Object.fromEntries([
    'uninstallEntries', 'registryValues', 'fileSystemItems', 'operatingSystem',
    'drivers', 'windowsFeatures', 'services', 'scheduledTasks', 'shortcuts',
  ].map((key) => [key, { added: 0, removed: 0, changed: 0 }]));
  return {
    schemaVersion: 1,
    id: 'Notepad++.Notepad++',
    displayName: 'Notepad++',
    publisher: 'Notepad++',
    version: '8.9.7',
    architecture: 'x64',
    installer: { type: 'exe' },
    commands: { install: 'installer.exe /S', uninstall: 'uninstall.exe /S' },
    detection: { type: 'fileVersion', path: 'C:\\Program Files\\Notepad++\\notepad++.exe', minimumVersion: '8.9.7' },
    qaResult: {
      schemaVersion: 1,
      testId: 'github-1-1',
      outcome: 'Passed',
      testedAtUtc: '2026-08-07T12:00:00Z',
      overallDurationSeconds: 10,
      environment: { computerName: 'INTUNE-QA', executedAs: 'SYSTEM' },
      results: {
        install: { exitCode: 0, durationSeconds: 1, timedOut: false },
        detectionAfterInstall: { exitCode: 0, durationSeconds: 1, timedOut: false },
        uninstall: { exitCode: 0, durationSeconds: 1, timedOut: false },
        detectionAfterUninstall: { exitCode: 1, durationSeconds: 1, timedOut: false },
      },
      changes: { afterInstall: counts, residualAfterUninstall: counts },
      relevantEventCount: 0,
      github: { runId: '1', runAttempt: 1 },
    },
  };
}

describe('QA synchronization validation', () => {
  it('accepts real-world IDs whose filename slug cannot be derived safely', () => {
    const definition = validDefinition();
    expect(validateQaDefinition(definition)).toEqual([]);
    expect(toQaResultRow(definition, '2026-08-07T12:01:00Z')?.winget_id).toBe('Notepad++.Notepad++');
  });

  it('rejects malformed aggregate counts', () => {
    const definition = validDefinition();
    definition.qaResult.changes.afterInstall.registryValues.added = -1;
    expect(validateQaDefinition(definition)).toContain(
      'qaResult.changes.afterInstall.registryValues.added must be a non-negative integer'
    );
  });

  it('keeps an untested definition valid but produces no mirror row', () => {
    const definition = validDefinition();
    delete (definition as Partial<ReturnType<typeof validDefinition>>).qaResult;
    expect(validateQaDefinition(definition)).toEqual([]);
    expect(toQaResultRow(definition)).toBeNull();
  });

  it('refuses a contents API listing at the silent truncation limit', () => {
    expect(() => assertCompleteQaListing(Array.from({ length: 999 }))).not.toThrow();
    expect(() => assertCompleteQaListing(Array.from({ length: 1000 }))).toThrow(
      'potentially truncated reconciliation'
    );
  });
});
