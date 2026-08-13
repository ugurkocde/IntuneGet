import { describe, expect, it } from 'vitest';
import { QA_PSADT_TOOLCHAIN } from './package-profile';
import { shouldRetryTerminalToolchainCandidate } from './toolchain-backfill';

describe('QA toolchain targeted retries', () => {
  it.each([
    'Microsoft.OfficeDeploymentTool',
    'Microsoft.VisualStudio.BuildTools',
  ])('keeps the managed lifecycle retry scoped to its release for %s', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      '2e68a941d3410e4eb7c6ed1e73fbc0eff290c807',
      { wingetId, status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(false);
  });

  it.each([
    'Microsoft.SQLServerManagementStudio.21',
    'Microsoft.SQLServerManagementStudio.22',
    'Microsoft.SQLServerManagementStudio.22.Preview',
  ])('keeps the SSMS retry scoped to its historical toolchain release for %s', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      '072dc26c5c25369bf01f265af5af17c47c0e50e5',
      { wingetId, status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(false);
  });

  it('does not replay the already-resolved xTool failure on the current pin', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'b3b2729bab6959a554c0e6d41af0a841d6177386',
      { wingetId: 'Makeblock.xToolStudio', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '93321ef6f7abd287f0fd6f37e37c5f4c199f3c4e',
      { wingetId: 'Makeblock.xToolStudio', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '7d389dbd6e55b719e3d71772717cda0c8f724469',
      { wingetId: 'Makeblock.xToolStudio', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Makeblock.xToolStudio', status: 'failed' }
    )).toBe(false);
  });

  it('does not replay the already-resolved LTspice failure on the current pin', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '93321ef6f7abd287f0fd6f37e37c5f4c199f3c4e',
      { wingetId: 'AnalogDevices.LTspice', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '7d389dbd6e55b719e3d71772717cda0c8f724469',
      { wingetId: 'AnalogDevices.LTspice', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'AnalogDevices.LTspice', status: 'failed' }
    )).toBe(false);
  });

  it('retries Opera once on the reviewed immediate-uninstall release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '681b7510f7f30bec92c17581213c9ebc7f72765a',
      { wingetId: 'Opera.Opera', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '9ff409ddabd3b1b4f8c65ad03b1f9e37778589fc',
      { wingetId: 'Opera.Opera', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Opera.Opera', status: 'failed' }
    )).toBe(true);
  });

  it('keeps WebView2 replay scoped to its shared-runtime lifecycle releases', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'f4bc37886e490ece525c701562869734a7e366d5',
      { wingetId: 'Microsoft.EdgeWebView2Runtime', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '7d389dbd6e55b719e3d71772717cda0c8f724469',
      { wingetId: 'Microsoft.EdgeWebView2Runtime', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Microsoft.EdgeWebView2Runtime', status: 'failed' }
    )).toBe(false);
  });

  it('keeps the Granola diagnostics replay scoped to its historical releases', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '7d389dbd6e55b719e3d71772717cda0c8f724469',
      { wingetId: 'Granola.Granola', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'f4bc37886e490ece525c701562869734a7e366d5',
      { wingetId: 'Granola.Granola', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Granola.Granola', status: 'failed' }
    )).toBe(false);
  });

  it.each([
    'Microsoft.VisualStudio.Community',
    'Microsoft.VisualStudio.Enterprise',
    'Microsoft.VisualStudio.Professional',
    'Microsoft.VisualStudio.2019.BuildTools',
    'Microsoft.VisualStudio.2019.Community',
    'Microsoft.VisualStudio.2019.Enterprise',
    'Microsoft.VisualStudio.2019.Professional',
    'Microsoft.VisualStudio.2022.BuildTools',
    'Microsoft.VisualStudio.2022.Community',
    'Microsoft.VisualStudio.2022.Enterprise',
    'Microsoft.VisualStudio.2022.Professional',
    'Mozilla.Firefox.de',
  ])(
    'keeps the terminal %s retry scoped to its historical toolchain release',
    (wingetId) => {
      expect(shouldRetryTerminalToolchainCandidate(
        'bbd8948f2bbefeaba9caf51f6e36ce5d26fdff35',
        { wingetId, status: 'failed' }
      )).toBe(true);
      expect(shouldRetryTerminalToolchainCandidate(
        QA_PSADT_TOOLCHAIN.packagerCommit,
        { wingetId, status: 'failed' }
      )).toBe(false);
    }
  );

  it('keeps the VirtualBox retry scoped to its historical toolchain release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'bafea79a8dde42be074c385c35b4887fb5833aa0',
      { wingetId: 'Oracle.VirtualBox', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Oracle.VirtualBox', status: 'failed' }
    )).toBe(false);
  });

  it('keeps the resolved Greenshot retry on its tool-cache release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'acfe2d8692cc2b910281236ff47d3ee5b2ce2b99',
      { wingetId: 'Greenshot.Greenshot', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '681b7510f7f30bec92c17581213c9ebc7f72765a',
      { wingetId: 'Greenshot.Greenshot', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Greenshot.Greenshot', status: 'failed' }
    )).toBe(false);
  });

  it('retries Qfinder Pro once with its runtime and process lifecycle fix', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '7e83c363bcbafca153f00113b12ede2e332b2d2d',
      { wingetId: 'QNAP.QfinderPro', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'QNAP.QfinderPro', status: 'failed' }
    )).toBe(false);
    expect(shouldRetryTerminalToolchainCandidate(
      '681b7510f7f30bec92c17581213c9ebc7f72765a',
      { wingetId: 'QNAP.QfinderPro', status: 'failed' }
    )).toBe(false);
  });

  it('retries VisualCppRedist once with reviewed multi-product evidence', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '670357c92fefa433036d8667dd5f382731d8326e',
      { wingetId: 'ABBODI1406.VCREDIST', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '7e83c363bcbafca153f00113b12ede2e332b2d2d',
      { wingetId: 'abbodi1406.vcredist', status: 'failed' }
    )).toBe(false);
  });

  it('retries PostgreSQL 13 once with the family unattended lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '2c40f49e2cb0b5a1f7a1c27996f5aee72553a074',
      { wingetId: 'postgresql.postgresql.13', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '670357c92fefa433036d8667dd5f382731d8326e',
      { wingetId: 'PostgreSQL.PostgreSQL.13', status: 'failed' }
    )).toBe(false);
  });

  it('retries EA Desktop once with the registered Burn helper lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'e6a4ae2f4f9a3a672c6912ab8e309483f53003b7',
      { wingetId: 'electronicarts.eadesktop', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      '2c40f49e2cb0b5a1f7a1c27996f5aee72553a074',
      { wingetId: 'ElectronicArts.EADesktop', status: 'failed' }
    )).toBe(false);
  });

  it('retries EA Desktop once after adding its process-close lifecycle', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '2dca138ee2fe27dc45166dba536511aa80d8937e',
      { wingetId: 'ELECTRONICARTS.EADESKTOP', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      'e6a4ae2f4f9a3a672c6912ab8e309483f53003b7',
      { wingetId: 'ElectronicArts.EADesktop', status: 'failed' }
    )).toBe(true);
  });

  it('retries MPC-BE once after strengthening Inno quiet uninstall arguments', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '54515b6566ff4e7c9040fa24a8eba6b6347ef09e',
      { wingetId: 'mpc-be.mpc-be', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'MPC-BE.MPC-BE', status: 'failed' }
    )).toBe(false);
  });

  it('retries Camera Hub once after guarding its MSI pre-uninstall helper', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'cf24633576b6c5efcca5fbde8ffe7fb4f0f57272',
      { wingetId: 'elgato.camerahub', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'elgato.camerahub', status: 'failed' }
    )).toBe(false);
  });

  it('retries VSTO once with its reviewed external-installer removal switches', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      '54515b6566ff4e7c9040fa24a8eba6b6347ef09e',
      { wingetId: 'microsoft.vstor', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Microsoft.VSTOR', status: 'failed' }
    )).toBe(false);
  });

  it.each(['Autodesk.DesktopApp'])('does not replay retired %s on the current pin', (wingetId) => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId, status: 'failed' }
    )).toBe(false);
  });

  it('keeps the OCS retry scoped to its historical toolchain release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'fc18fffd40f6d362be251e05e2bc784373dfc735',
      { wingetId: 'OCSInventoryNG.WindowsAgent', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'OCSInventoryNG.WindowsAgent', status: 'failed' }
    )).toBe(false);
  });

  it('does not replay an unrelated terminal failure', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Unrelated.App', status: 'failed' }
    )).toBe(false);
  });

  it('still rebuilds a non-terminal stale candidate', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Unrelated.App', status: 'superseded' }
    )).toBe(true);
  });
});
