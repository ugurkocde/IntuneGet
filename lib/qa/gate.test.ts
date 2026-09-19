import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QaResultRow } from '@/types/qa';

const {
  getQaResultMock,
  getPackageCompatibilityBlockMock,
  getPackageResultMock,
  packageEqMock,
} = vi.hoisted(() => ({
  getQaResultMock: vi.fn(),
  getPackageCompatibilityBlockMock: vi.fn(),
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
vi.mock('@/lib/package-eligibility', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/package-eligibility')>();
  return {
    ...original,
    getPackageCompatibilityBlock: getPackageCompatibilityBlockMock,
  };
});

import {
  enforceQaGate,
  QaCompatibilityGateError,
  QaGateError,
  QaGateNotPassedError,
  QaSecurityGateError,
} from './gate';

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
    getPackageCompatibilityBlockMock.mockReset();
    getPackageCompatibilityBlockMock.mockResolvedValue(null);
    getPackageResultMock.mockReset();
    packageEqMock.mockReset();
  });

  it.each([false, true])('blocks the failed SQL Server payload with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Microsoft.SQLServer.2025.Developer', version: '17.0.1000.7', architecture: 'x64',
      installerSha256: 'F2FDCEA621E29B2DD09E3802FD6FE7664A2037BED02349854CCAE96C4A03BBF1',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'SSEI install returned -1; exact registration absent.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the failed Zoom MSI payload with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Zoom.Zoom', version: '7.2.48358', architecture: 'x64',
      installerSha256: '132A59637FCFF4F0F01891F163A7726976D72A4DD7199EC4C0A224CB8E28D5D1',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'MSI uninstall returned 1601.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the failed TubeDigger payload with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'TubeDigger.TubeDigger', version: '8.2.5.0', architecture: 'x86',
      installerSha256: 'D34F1AFFD65BCF99F5762F5FC1A13C0B2585546BDC89D99AA045364DA6215BC8',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact Inno registration remained.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
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

  it.each(['expired_signing_certificate', 'failed_managed_lifecycle', 'unverified_file_reputation'])(
    'does not allow a QA override to bypass an exact %s block', async (code) => {
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      wingetId: 'r12f.DivoomGateway',
      version: '0.1.42.0',
      architecture: 'x64',
      installerSha256,
      code,
      detail: 'The signing certificate is expired.',
    });

    await expect(enforceQaGate({
      wingetId: 'r12f.DivoomGateway',
      version: '0.1.42.0',
      architecture: 'x64',
      installerSha256,
      qaOverride: true,
    })).rejects.toBeInstanceOf(QaCompatibilityGateError);

    expect(getPackageResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the stalled WebView2 payload with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Microsoft.EdgeWebView2Runtime', version: '153.0.4234.46', architecture: 'x64',
      installerSha256: '493AE586FF07EF3696DA3BDE3AEB73D6CACA8A1C00E779DA899FF16A159CF36E',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Install stalled and post-install detection failed.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the stalled WeType payload with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Tencent.WeType', version: '2.1.4.6', architecture: 'x64',
      installerSha256: 'D8D487B0C3F9319B7C0A4736851701503CC662B101016CC2B62F7D657A1A41EC',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Install stalled; no exact uninstall identity.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the missing T3Code uninstaller payload with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'T3Tools.T3Code', version: '0.0.42', architecture: 'x64',
      installerSha256: '9BD4A00AE9B4880F85E81376844E4FC1DBC9F719120958D7445B4C2B281E267F',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registered uninstaller was absent; reputation unverified.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the failed Thunder payload with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Thunder.Thunder', version: '25.1.13.1637', architecture: 'x64',
      installerSha256: 'B2C7A5269B267E7390BED95975FF9BA56088B26A945B6A2BA4B35B3B15FE8EC6',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact thunder_is1 registration remained; reputation unverified.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the exact Twinkstar release with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Twinkstar.TwinkstarBrowser', version: '11.4.1000.2609',
      architecture: 'x64',
      installerSha256: '3671D4C0693240501854274692724B9A98C35B1E869066CF40985F43D4738668',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registration remained.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the exact failed SSIS release with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Microsoft.DataTools.IntegrationServices', version: '17.0.1010.2',
      architecture: 'x86',
      installerSha256: '75D8444333303D5B449660A669AF07862289E5F2BBDEF0AE7520C5BA3E47D65B',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Install failed with exit 1626.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the exact Pithflow release with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Pithflow.Pithflow', version: '1.37.0', architecture: 'x64',
      installerSha256: '536AD9787092DFBD9F23C9F5FD4EA1ED81B1A363736AE68B3B3BFCED627028D4',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Registered uninstaller was absent.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the exact RadioMaximus release with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Raimersoft.RadioMaximus', version: '2.33.15', architecture: 'x86',
      installerSha256: '8D64DD8FCA0C7CD042CD3028496B7085BEDF22364908D056A9795BCCB821A4A8',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact RadioMaximus_is1 registration remained.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the exact Tencent ima release with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Tencent.ima-copilot', version: '2.6.10.5128', architecture: 'x64',
      installerSha256: '37E79B29536B79F0DB0F203CD9135A196F5A9791D446F7B16E2A3C1FE75F9EB9',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact ima.copilot registration remained.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('contains GreenTunnel despite a nonqualifying user pass with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'SadeghHayeri.GreenTunnel', version: '3.0.5', architecture: 'x86',
      installerSha256: '77CD4E08ABF2E7A0FC235821AE49BBFDD032616A9A0407902F907C96547D2659',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'LocalSystem removal failed; user-scope pass is not strict evidence.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks UniFi Network missing-uninstaller payload even with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'Ubiquiti.UniFiNetworkServer', version: '10.6.106', architecture: 'x64',
      installerSha256: '984FEFAA18AA38D90928F9159D2F2C8286202F19B0E038E3C2A8F7192DFC1C91',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registered uninstaller was absent.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks NateOn failed uninstall payload even with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'SKCommunications.NateOn', version: '7.0.41.0', architecture: 'x86',
      installerSha256: '1DCA7E3230CDB6BEC7374DEE2D226D62C73919B6119D870DD6BC29D19915AE2F',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registration remained after silent uninstall.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the missing SJMCL uninstaller payload with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'SJMC.SJMCL', version: '1.3.1', architecture: 'x64',
      installerSha256: 'D736C896A039A9AFB8B7D4339A79293FAAAC6EF3F164DAF2DD44F8702997178A',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registered uninstaller was absent.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks TimeScribe with its missing registered uninstaller even with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'WINBIGFOX.TimeScribe', version: '1.16.0', architecture: 'x64',
      installerSha256: '7F8A4729661150B7A1A9E4E3F3FE347BFA17507AED3096806DABD0A1F34A706B',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registered uninstaller was absent.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the exact XplicitTrust release with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'XplicitTrust.Agent', version: '1.065', architecture: 'x64',
      installerSha256: '9015EEE906A0B84F2B5B0471E6F7C88C5BCF50DE6B6F32C5EB252D385D7FDBD2',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Captured MSI registration disappeared.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([
    ['1.4.203', 'DC347211CE31DC1D37BD6522B2BB96169747F626A19754C57F6868769E878A7C', false],
    ['1.4.203', 'DC347211CE31DC1D37BD6522B2BB96169747F626A19754C57F6868769E878A7C', true],
    ['1.4.204', '87B877EC7472F664E5264DC5367A5F18F4484AEA67A08B4ECA76F9A65729206C', false],
    ['1.4.204', '87B877EC7472F664E5264DC5367A5F18F4484AEA67A08B4ECA76F9A65729206C', true],
  ] as const)('blocks Orca %s (%s) with override=%s', async (version, installerSha256, qaOverride) => {
    const tuple = {
      wingetId: 'StablyAI.Orca', version, architecture: 'x64', installerSha256,
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Registered uninstaller was absent.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('blocks the mismatched MTGA Launcher release with override=%s', async (qaOverride) => {
    const tuple = {
      wingetId: 'WizardsoftheCoast.MTGALauncher', version: '1.0.124', architecture: 'x64',
      installerSha256: '96C64E5E0CD4D5758F3C9AE1AF7A2C6FFCF4782E273AEDE28FA92B8E63FFC368',
    };
    getPackageCompatibilityBlockMock.mockResolvedValueOnce({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Manifest launcher identity was absent.',
    });
    await expect(enforceQaGate({ ...tuple, qaOverride })).rejects.toBeInstanceOf(QaCompatibilityGateError);
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(expect.anything(), tuple);
    expect(getPackageResultMock).not.toHaveBeenCalled();
    expect(getQaResultMock).not.toHaveBeenCalled();
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
