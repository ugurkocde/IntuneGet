import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QaResultRow } from '@/types/qa';

const { getQaResultMock, getPackageResultMock, packageEqMock } = vi.hoisted(() => ({
  getQaResultMock: vi.fn(),
  getPackageResultMock: vi.fn(),
  packageEqMock: vi.fn(),
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSource: () => ({ getQaResult: getQaResultMock }),
}));
vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = vi.fn(() => builder);
      builder.eq = vi.fn((...args: unknown[]) => {
        packageEqMock(...args);
        return builder;
      });
      builder.gte = vi.fn(() => builder);
      builder.order = vi.fn(() => builder);
      builder.limit = vi.fn(() => builder);
      builder.maybeSingle = getPackageResultMock;
      return builder;
    },
  }),
}));

import { enforceQaGate, QaGateError, QaGateNotPassedError, QaSecurityGateError } from './gate';

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
    packageEqMock.mockReset();
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

  it('reuses a passed app version regardless of the requested PSADT profile', async () => {
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
        packageProfileSha256: 'C'.repeat(64),
        requirePassed: true,
      })
    ).resolves.toBeUndefined();
    expect(packageEqMock).toHaveBeenCalledWith('winget_id', 'OpenJS.NodeJS');
    expect(packageEqMock).toHaveBeenCalledWith('tested_version', '26.7.0');
    expect(packageEqMock).toHaveBeenCalledWith('architecture', 'x64');
    expect(packageEqMock).toHaveBeenCalledWith('installer_sha256', installerSha256);
    expect(packageEqMock).toHaveBeenCalledWith('outcome', 'Passed');
  });

  it('blocks when the app payload has no successful QA result', async () => {
    getPackageResultMock.mockResolvedValue({ data: null, error: null });
    await expect(
      enforceQaGate({
        wingetId: 'OpenJS.NodeJS',
        version: '26.7.0',
        architecture: 'x64',
        installerSha256,
        packageProfileSha256,
        requirePassed: true,
      })
    ).rejects.toBeInstanceOf(QaGateNotPassedError);
  });

  it('blocks packaging when VirusTotal reported a malicious verdict for the exact installer', async () => {
    getPackageResultMock.mockResolvedValueOnce({
      data: { virustotal_malicious: 1, virustotal_total_engines: 72 },
      error: null,
    });
    await expect(
      enforceQaGate({
        wingetId: 'OpenJS.NodeJS',
        version: '26.7.0',
        architecture: 'x64',
        installerSha256,
        packageProfileSha256,
        requirePassed: true,
      })
    ).rejects.toBeInstanceOf(QaSecurityGateError);
  });

  it('does not allow a manual QA override to bypass the security gate', async () => {
    getPackageResultMock.mockResolvedValueOnce({
      data: { virustotal_malicious: 4, virustotal_total_engines: 70 },
      error: null,
    });
    await expect(
      enforceQaGate({
        wingetId: 'OpenJS.NodeJS',
        version: '26.7.0',
        architecture: 'x64',
        installerSha256,
        qaOverride: true,
      })
    ).rejects.toBeInstanceOf(QaSecurityGateError);
  });

  it('blocks a flagged current version even when its installation test passed', async () => {
    getQaResultMock.mockResolvedValue({
      ...failedRow,
      outcome: 'Passed',
      virustotal_status: 'flagged',
      virustotal_malicious: 2,
      virustotal_total_engines: 72,
    });
    await expect(
      enforceQaGate({ wingetId: 'OpenJS.NodeJS', version: '26.7.0', architecture: 'x64' })
    ).rejects.toBeInstanceOf(QaSecurityGateError);
  });

  it('does not block on suspicious-only or missing VirusTotal verdicts', async () => {
    getQaResultMock.mockResolvedValue({
      ...failedRow,
      outcome: 'Passed',
      virustotal_status: 'suspicious',
      virustotal_malicious: 0,
      virustotal_suspicious: 3,
      virustotal_total_engines: 72,
    });
    await expect(
      enforceQaGate({ wingetId: 'OpenJS.NodeJS', version: '26.7.0', architecture: 'x64' })
    ).resolves.toBeUndefined();
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
