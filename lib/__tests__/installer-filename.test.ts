import { describe, it, expect } from 'vitest';
import { resolveInstallerFileName } from '../installer-filename';

describe('resolveInstallerFileName', () => {
  it('appends .exe for extensionless Postman URL', () => {
    const fileName = resolveInstallerFileName(
      'https://dl.pstmn.io/download/version/11.82.1/windows_64',
      'exe'
    );

    expect(fileName).toBe('windows_64.exe');
  });

  it('preserves existing extension', () => {
    const fileName = resolveInstallerFileName(
      'https://example.com/installer.msi',
      'msi'
    );

    expect(fileName).toBe('installer.msi');
  });

  it('decodes encoded filenames and appends extension', () => {
    const fileName = resolveInstallerFileName(
      'https://example.com/Postman%20Setup',
      'exe'
    );

    expect(fileName).toBe('Postman Setup.exe');
  });

  it('does not mistake a dotted numeric version for a file extension', () => {
    const fileName = resolveInstallerFileName(
      'https://memory.timelyapp.com/download/windows/26.7.174',
      'exe'
    );

    expect(fileName).toBe('26.7.174.exe');
  });

  it('uses type-specific fallback when URL has no leaf', () => {
    const fileName = resolveInstallerFileName(
      'https://example.com/downloads/',
      'zip'
    );

    expect(fileName).toBe('installer.zip');
  });
});
