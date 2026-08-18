import { describe, expect, it } from 'vitest';
import { evaluatePackagingContract } from './packaging-contract';

describe('evaluatePackagingContract', () => {
  it('rejects a plain EXE when no unattended command is declared', () => {
    const result = evaluatePackagingContract({
      wingetId: 'Contoso.OpaqueSetup',
      installerType: 'exe',
      silentArgs: '',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('silent-install-contract-missing');
  });

  it('accepts a plain EXE with explicit vendor silent arguments', () => {
    expect(evaluatePackagingContract({
      wingetId: 'Contoso.DocumentedSetup',
      installerType: 'exe',
      silentArgs: '--quiet --norestart',
    }).valid).toBe(true);
  });

  it('accepts an EXE whose reviewed adapter supplies the install contract', () => {
    expect(evaluatePackagingContract({
      wingetId: 'Bitvise.SSH.Client',
      installerType: 'exe',
      silentArgs: '',
    }).valid).toBe(true);
  });

  it('rejects a nested plain EXE without silent arguments', () => {
    const result = evaluatePackagingContract({
      wingetId: 'Contoso.OpaqueArchive',
      installerType: 'zip',
      nestedInstallerType: 'exe',
      nestedInstallerFiles: ['setup.exe'],
      silentArgs: '',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('silent-install-contract-missing');
  });

  it('recognizes complete Office Deployment Tool configuration arguments', () => {
    expect(evaluatePackagingContract({
      wingetId: 'Microsoft.Office',
      installerType: 'exe',
      silentArgs: '/configure https://aka.ms/fhlwingetconfig',
    })).toEqual({
      valid: true,
      family: 'vendor-bootstrapper',
      dependencyMode: 'remote-configuration',
    });
  });

  it('rejects Office when the configuration operand was discarded', () => {
    const result = evaluatePackagingContract({
      wingetId: 'Microsoft.Office',
      installerType: 'exe',
      silentArgs: '/configure',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('required-argument-missing');
  });

  it('accepts an archive without a nested installer contract as portable', () => {
    expect(evaluatePackagingContract({
      wingetId: 'Contoso.Archive',
      installerType: 'zip',
      silentArgs: '/S',
    }).valid).toBe(true);
  });

  it.each([
    { nestedInstallerType: 'nullsoft' },
    { nestedInstallerFiles: ['setup.exe'] },
  ])('rejects a half-declared archive contract: %o', (nestedContract) => {
    const result = evaluatePackagingContract({
      wingetId: 'Contoso.Archive',
      installerType: 'zip',
      silentArgs: '/S',
      ...nestedContract,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('archive-contract-incomplete');
  });

  it('accepts a typed archive with a nested installer path', () => {
    expect(evaluatePackagingContract({
      wingetId: 'Contoso.Archive',
      installerType: 'zip',
      silentArgs: '/S',
      nestedInstallerType: 'nullsoft',
      nestedInstallerFiles: ['setup.exe'],
    }).valid).toBe(true);
  });

  it('rejects installer types without an adapter', () => {
    const result = evaluatePackagingContract({
      wingetId: 'Contoso.Unknown',
      installerType: 'script',
      silentArgs: '--silent',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('unsupported-installer-type');
  });
});
