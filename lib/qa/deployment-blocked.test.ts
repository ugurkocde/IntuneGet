import { describe, expect, it } from 'vitest';
import { markBlockedQaResults } from './deployment-blocked';
import type { QaStatusRow } from '@/types/qa';

const row: QaStatusRow = {
  winget_id: 'Example.App', tested_version: '1', architecture: 'x64', outcome: 'Passed',
  tested_at_utc: '2026-10-11T00:00:00Z', test_level: 'psadt-package',
  package_profile_sha256: 'B'.repeat(64), installer_sha256: 'a'.repeat(64),
};
const block = { winget_id: row.winget_id, version: row.tested_version,
  architecture: row.architecture, installer_sha256: 'A'.repeat(64) };

describe('deployment availability', () => {
  it('marks only the exact immutable installer and leaves outcome truthful', () => {
    const rows = [row, { ...row, architecture: 'arm64' }, { ...row, tested_version: '2' },
      { ...row, installer_sha256: 'C'.repeat(64) }, { ...row, winget_id: 'Other.App' }];
    const result = markBlockedQaResults(rows, [block]);
    expect(result.map(r => r.deployment_blocked)).toEqual([true, false, false, false, false]);
    expect(result.every(r => r.outcome === 'Passed')).toBe(true);
    expect(row.deployment_blocked).toBeUndefined();
  });
});
