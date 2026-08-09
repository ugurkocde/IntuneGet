import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QaResultRow } from '@/types/qa';

const { getQaResultMock, getPackageResultMock } = vi.hoisted(() => ({
  getQaResultMock: vi.fn(),
  getPackageResultMock: vi.fn(),
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSource: () => ({ getQaResult: getQaResultMock }),
}));
vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: getPackageResultMock }),
      }),
    }),
  }),
}));

import { enforceQaGate, QaGateError, QaGateNotPassedError } from './gate';

const installerSha256 = 'A'.repeat(64);
const packageProfileSha256 = 'B'.repeat(64);

const failedRow = {
  winget_id: 'OpenJS.NodeJS',
  display_name: 'Node.js',
  publisher: 'OpenJS Foundation',
  tested_version: '26.7.0',
  architecture: 'x64',
  outcome: 'Failed',
  installer_sha256: installerSha256,
  tested_at_utc: '2026-08-07T12:00:00Z',
  overall_duration_seconds: 30,
  installer_type: 'msi',
  install_command: 'msiexec /i node.msi /qn',
  uninstall_command: 'msiexec /x {BAD-CODE} /qn',
  detection: { type: 'fileVersion', path: 'C:\\Program Files\\nodejs\\node.exe', minimumVersion: '26.7.0' },
  phase_results: {
    install: { exitCode: 0, durationSeconds: 1, timedOut: false },
    detectionAfterInstall: { exitCode: 0, durationSeconds: 1, timedOut: false },
    uninstall: { exitCode: 1605, durationSeconds: 1, timedOut: false },
    detectionAfterUninstall: null,
  },
  changes: null,
  relevant_event_count: 0,
  environment: null,
  effective_configuration: null,
  qa_schema_version: 1,
  synced_at: '2026-08-07T12:01:00Z',
  test_level: 'psadt-package',
  package_profile_sha256: packageProfileSha256,
  psadt_version: '4.1.8',
  psadt_template_sha256: 'C'.repeat(64),
  psadt_config_sha256: 'D'.repeat(64),
  detection_rules_sha256: 'E'.repeat(64),
  packager_commit: 'f'.repeat(40),
  package_content_sha256: 'F'.repeat(64),
} satisfies QaResultRow;

describe('enforceQaGate', () => {
  beforeEach(() => {
    getQaResultMock.mockReset();
    getPackageResultMock.mockReset();
  });

  it('blocks a failed exact version and architecture', async () => {
    getQaResultMock.mockResolvedValue(failedRow);
    await expect(
      enforceQaGate({ wingetId: 'OpenJS.NodeJS', version: '26.7.0', architecture: 'x64' })
    ).rejects.toBeInstanceOf(QaGateError);
  });

  it.each([
    { version: '26.8.0', architecture: 'x64' },
    { version: '26.7.0', architecture: 'arm64' },
  ])('allows stale or architecture-mismatched failures', async (input) => {
    getQaResultMock.mockResolvedValue(failedRow);
    await expect(enforceQaGate({ wingetId: 'OpenJS.NodeJS', ...input })).resolves.toBeUndefined();
  });

  it('allows an explicit override and missing data', async () => {
    getQaResultMock.mockResolvedValue(failedRow);
    await expect(
      enforceQaGate({ wingetId: 'OpenJS.NodeJS', version: '26.7.0', architecture: 'x64', qaOverride: true })
    ).resolves.toBeUndefined();
    getQaResultMock.mockResolvedValue(null);
    await expect(enforceQaGate({ wingetId: 'Unknown.App', version: '1.0' })).resolves.toBeUndefined();
  });

  it('allows only an exact passed candidate when requirePassed is enabled', async () => {
    getPackageResultMock.mockResolvedValue({
      data: { ...failedRow, outcome: 'Passed' },
      error: null,
    });
    await expect(
      enforceQaGate({
        wingetId: 'OpenJS.NodeJS',
        version: '26.7.0',
        architecture: 'x64',
        installerSha256: installerSha256.toLowerCase(),
        packageProfileSha256,
        requirePassed: true,
      })
    ).resolves.toBeUndefined();
  });

  it.each([
    ['missing', null, '26.7.0', 'x64', installerSha256],
    ['failed', failedRow, '26.7.0', 'x64', installerSha256],
    ['stale version', { ...failedRow, outcome: 'Passed' }, '26.8.0', 'x64', installerSha256],
    ['wrong architecture', { ...failedRow, outcome: 'Passed' }, '26.7.0', 'arm64', installerSha256],
    ['wrong SHA', { ...failedRow, outcome: 'Passed' }, '26.7.0', 'x64', 'B'.repeat(64)],
  ])('blocks a %s candidate in strict mode', async (_label, row, version, architecture, sha) => {
    getPackageResultMock.mockResolvedValue({ data: row, error: null });
    await expect(
      enforceQaGate({
        wingetId: 'OpenJS.NodeJS',
        version: String(version),
        architecture: String(architecture),
        installerSha256: String(sha),
        packageProfileSha256,
        requirePassed: true,
      })
    ).rejects.toBeInstanceOf(QaGateNotPassedError);
  });

  it('does not allow a manual override to bypass strict automatic QA', async () => {
    getPackageResultMock.mockResolvedValue({ data: null, error: null });
    await expect(
      enforceQaGate({
        wingetId: 'OpenJS.NodeJS',
        version: '26.7.0',
        architecture: 'x64',
        installerSha256,
        packageProfileSha256,
        requirePassed: true,
        qaOverride: true,
      })
    ).rejects.toBeInstanceOf(QaGateNotPassedError);
  });
});
