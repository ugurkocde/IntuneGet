import { describe, expect, it } from 'vitest';
import { QA_PSADT_TOOLCHAIN } from './package-profile';
import { shouldRetryTerminalToolchainCandidate } from './toolchain-backfill';

describe('QA toolchain targeted retries', () => {
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

  it('carries the superseded xTool retry into the current toolchain release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'b3b2729bab6959a554c0e6d41af0a841d6177386',
      { wingetId: 'Makeblock.xToolStudio', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Makeblock.xToolStudio', status: 'failed' }
    )).toBe(true);
  });

  it('retries LTspice for the current enterprise-mode correction', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'AnalogDevices.LTspice', status: 'failed' }
    )).toBe(true);
  });

  it.each([
    'Microsoft.VisualStudio.BuildTools',
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

  it('keeps the Greenshot retry scoped to its historical toolchain release', () => {
    expect(shouldRetryTerminalToolchainCandidate(
      'acfe2d8692cc2b910281236ff47d3ee5b2ce2b99',
      { wingetId: 'Greenshot.Greenshot', status: 'failed' }
    )).toBe(true);
    expect(shouldRetryTerminalToolchainCandidate(
      QA_PSADT_TOOLCHAIN.packagerCommit,
      { wingetId: 'Greenshot.Greenshot', status: 'failed' }
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
