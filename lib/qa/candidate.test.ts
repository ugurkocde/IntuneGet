import { describe, expect, it } from 'vitest';
import {
  isQaRunnerArchitectureSupported,
  normalizeInstallerSha256,
  normalizeQaArchitecture,
  normalizeQaInstallerType,
  qaInstallerFileName,
  selectQaVmInstaller,
  selectWingetInstaller,
} from './candidate';

describe('QA candidate normalization', () => {
  const installers = [
    { Architecture: 'x86', InstallerUrl: 'https://example.test/x86.exe' },
    { Architecture: 'x64', InstallerUrl: 'https://example.test/x64.exe' },
  ];

  it('selects the exact requested architecture', () => {
    expect(selectWingetInstaller(installers, 'x86')?.InstallerUrl).toContain('x86');
    expect(selectWingetInstaller(installers, 'x64')?.InstallerUrl).toContain('x64');
  });

  it('does not silently substitute a different architecture', () => {
    expect(selectWingetInstaller(installers, 'arm64')).toBeNull();
    expect(normalizeQaArchitecture(undefined)).toBe('x64');
  });

  it('only sends architectures executable by the current x64 VM to QA', () => {
    expect(isQaRunnerArchitectureSupported('x64')).toBe(true);
    expect(isQaRunnerArchitectureSupported('x86')).toBe(true);
    expect(isQaRunnerArchitectureSupported('arm64')).toBe(false);
  });

  it('uses x86 only as an explicit fallback supported by the x64 QA VM', () => {
    expect(selectQaVmInstaller(installers)).toMatchObject({ architecture: 'x64' });
    expect(selectQaVmInstaller([installers[0]])).toMatchObject({ architecture: 'x86' });
    expect(selectQaVmInstaller([{ Architecture: 'arm64' }])).toBeNull();
  });

  it('prefers a machine-scope installer within the selected architecture', () => {
    const scopedInstallers = [
      {
        Architecture: 'x64',
        Scope: 'user',
        InstallerUrl: 'https://example.test/current-user.exe',
      },
      {
        Architecture: 'x64',
        Scope: 'machine',
        InstallerUrl: 'https://example.test/all-users.exe',
      },
    ];

    expect(selectQaVmInstaller(scopedInstallers)?.installer.InstallerUrl).toContain('all-users');
    expect(selectWingetInstaller(scopedInstallers, 'x64')?.InstallerUrl).toContain('all-users');
  });

  it('prefers an admin MSI over a bootstrapper for machine-scope QA', () => {
    const ringCentralInstallers = [
      {
        Architecture: 'x64',
        Scope: 'machine',
        InstallerType: 'nullsoft',
        InstallerUrl: 'https://example.test/ringcentral-user.exe',
      },
      {
        Architecture: 'x64',
        Scope: 'machine',
        InstallerType: 'wix',
        InstallerUrl: 'https://example.test/ringcentral-admin.msi',
        ProductCode: '{1DE15838-06D0-4C9D-B513-F86B806149D5}',
      },
    ];

    expect(selectQaVmInstaller(ringCentralInstallers)?.installer.InstallerType).toBe('wix');
    expect(selectWingetInstaller(ringCentralInstallers, 'x64')?.InstallerType).toBe('wix');
    expect(selectWingetInstaller(ringCentralInstallers, 'x64', 'machine')?.InstallerType)
      .toBe('wix');
  });

  it('falls back to user scope when no machine or unspecified-scope installer exists', () => {
    const userInstaller = {
      Architecture: 'x64',
      Scope: 'user',
      InstallerUrl: 'https://example.test/current-user.exe',
    };

    expect(selectQaVmInstaller([userInstaller])?.installer).toBe(userInstaller);
  });

  it('honors an explicit deployment scope and never substitutes the opposite scope', () => {
    const scopedInstallers = [
      {
        Architecture: 'x64',
        Scope: 'user',
        InstallerUrl: 'https://example.test/current-user.exe',
      },
      {
        Architecture: 'x64',
        Scope: 'machine',
        InstallerUrl: 'https://example.test/all-users.exe',
      },
    ];

    expect(selectWingetInstaller(scopedInstallers, 'x64', 'user')?.InstallerUrl)
      .toContain('current-user');
    expect(selectWingetInstaller([scopedInstallers[0]], 'x64', 'machine')).toBeNull();
  });

  it('accepts and uppercases only complete SHA-256 values', () => {
    expect(normalizeInstallerSha256('a'.repeat(64))).toBe('A'.repeat(64));
    expect(normalizeInstallerSha256('abc')).toBe('');
  });

  it('maps WinGet technology-specific types to supported package types', () => {
    expect(normalizeQaInstallerType('inno', 'exe')).toBe('exe');
    expect(normalizeQaInstallerType('nullsoft', 'exe')).toBe('exe');
    expect(normalizeQaInstallerType('wix', 'exe')).toBe('msi');
    expect(normalizeQaInstallerType('portable', 'exe')).toBe('exe');
  });

  it('gives extensionless executable URLs a runnable filename', () => {
    expect(
      qaInstallerFileName(
        'https://dl.pstmn.io/download/version/12.23.1/windows_64',
        'exe'
      )
    ).toBe('windows_64.exe');
  });
});
