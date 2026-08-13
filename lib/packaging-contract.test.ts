import { describe, expect, it } from 'vitest';
import { evaluatePackagingContract } from './packaging-contract';

describe('evaluatePackagingContract', () => {
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

  it('rejects an archive without an explicit nested installer contract', () => {
    const result = evaluatePackagingContract({
      wingetId: 'Contoso.Archive',
      installerType: 'zip',
      silentArgs: '/S',
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
