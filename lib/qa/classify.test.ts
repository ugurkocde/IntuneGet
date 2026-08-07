import { describe, expect, it } from 'vitest';
import { classifyQaFailure } from './classify';
import { QA_CHANGE_CATEGORIES, type QaChanges, type QaPhaseResults } from '@/types/qa';

function changes(filesAdded = 0): QaChanges {
  const makeSet = () => Object.fromEntries(
    QA_CHANGE_CATEGORIES.map((category) => [category, { added: 0, removed: 0, changed: 0 }])
  ) as QaChanges['afterInstall'];
  const afterInstall = makeSet();
  afterInstall.fileSystemItems.added = filesAdded;
  return { afterInstall, residualAfterUninstall: makeSet() };
}

function phases(overrides: Partial<QaPhaseResults> = {}): QaPhaseResults {
  return {
    install: { exitCode: 0, durationSeconds: 1, timedOut: false },
    detectionAfterInstall: { exitCode: 0, durationSeconds: 1, timedOut: false },
    uninstall: { exitCode: 0, durationSeconds: 1, timedOut: false },
    detectionAfterUninstall: { exitCode: 1, durationSeconds: 1, timedOut: false },
    ...overrides,
  };
}

describe('classifyQaFailure', () => {
  it('classifies MSI 1605 as a high-confidence package-definition issue', () => {
    const result = classifyQaFailure(
      phases({ uninstall: { exitCode: 1605, durationSeconds: 1, timedOut: false } }),
      changes()
    );
    expect(result).toMatchObject({
      signal: 'uninstall_unknown_product',
      bucket: 'package_definition',
      confidence: 'high',
      source: 'heuristic',
    });
  });

  it('distinguishes a likely bad detection rule from a silent no-op', () => {
    const missed = phases({ detectionAfterInstall: { exitCode: 1, durationSeconds: 1, timedOut: false } });
    expect(classifyQaFailure(missed, changes(20)).signal).toBe('detection_missed_after_install');
    expect(classifyQaFailure(missed, changes(1)).signal).toBe('silent_install_noop');
  });

  it('does not treat expected post-uninstall detection exit 1 as a failure signal', () => {
    expect(classifyQaFailure(phases(), changes()).signal).toBe('unclassified');
  });
});
