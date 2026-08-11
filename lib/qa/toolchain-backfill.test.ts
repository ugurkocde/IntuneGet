import { describe, expect, it } from 'vitest';
import { QA_PSADT_TOOLCHAIN } from './package-profile';
import { shouldRetryTerminalToolchainCandidate } from './toolchain-backfill';

describe('QA toolchain targeted retries', () => {
  it.each(['Oracle.VirtualBox'])(
    'retries the terminal %s failure changed by the current toolchain release',
    (wingetId) => {
      expect(shouldRetryTerminalToolchainCandidate(
        QA_PSADT_TOOLCHAIN.packagerCommit,
        { wingetId, status: 'failed' }
      )).toBe(true);
    }
  );

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
