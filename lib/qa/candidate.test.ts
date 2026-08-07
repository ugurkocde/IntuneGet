import { describe, expect, it } from 'vitest';
import {
  normalizeInstallerSha256,
  normalizeQaArchitecture,
  normalizeQaInstallerType,
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
});
