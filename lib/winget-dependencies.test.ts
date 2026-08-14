import { describe, expect, it } from 'vitest';
import type { NormalizedInstaller } from '@/types/winget';
import {
  resolveWingetPackageDependencies,
  type WingetDependencyResolverIo,
} from './winget-dependencies';

const ROOT_SHA = 'A'.repeat(64);
const VC_SHA = 'B'.repeat(64);

function installer(
  overrides: Partial<NormalizedInstaller> = {}
): NormalizedInstaller {
  return {
    architecture: 'x64',
    url: 'https://example.invalid/setup.exe',
    sha256: ROOT_SHA,
    type: 'exe',
    silentArgs: '/quiet',
    ...overrides,
  };
}

function fixtureIo(
  installers: Record<string, NormalizedInstaller[]>,
  versions: Record<string, string[]>
): WingetDependencyResolverIo {
  return {
    getInstallers: async (packageIdentifier, version) =>
      installers[`${packageIdentifier}@${version}`] || [],
    getVersions: async (packageIdentifier) => versions[packageIdentifier] || [],
  };
}

describe('resolveWingetPackageDependencies', () => {
  it('returns no bundle metadata when the exact root installer has no dependencies', async () => {
    const io = fixtureIo(
      { 'Example.App@1.0.0': [installer()] },
      {}
    );

    await expect(resolveWingetPackageDependencies({
      wingetId: 'Example.App',
      version: '1.0.0',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
    }, io)).resolves.toEqual([]);
  });

  it('bundles the current VC++ runtime for VirtualBox with idempotent exit codes', async () => {
    const io = fixtureIo(
      {
        'Oracle.VirtualBox@7.2.14': [installer({
          packageDependencies: [{
            packageIdentifier: 'Microsoft.VCRedist.2015+.x64',
          }],
        })],
        'Microsoft.VCRedist.2015+.x64@14.51.36210.0': [installer({
          url: 'https://aka.ms/vc14/vc_redist.x64.exe',
          sha256: VC_SHA,
          silentArgs: '/install /quiet /norestart',
        })],
      },
      {
        'Microsoft.VCRedist.2015+.x64': ['14.51.36210.0'],
      }
    );

    const result = await resolveWingetPackageDependencies({
      wingetId: 'Oracle.VirtualBox',
      version: '7.2.14',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
    }, io);

    expect(result).toEqual([
      expect.objectContaining({
        packageIdentifier: 'Microsoft.VCRedist.2015+.x64',
        version: '14.51.36210.0',
        installerSha256: VC_SHA,
        order: 1,
        successCodes: [-2147023258, 0, 1638],
        rebootCodes: [1641, 3010],
      }),
    ]);
    expect(result[0].fileName).toBe(
      'Microsoft.VCRedist.2015+.x64-vc_redist.x64.exe'
    );
  });

  it('adds the reviewed x86 VC++ runtime omitted by the Qfinder Pro manifest', async () => {
    const io = fixtureIo(
      {
        'QNAP.QfinderPro@7.14.0.0626': [installer({
          architecture: 'x86',
          type: 'nullsoft',
          sha256: ROOT_SHA,
        })],
        'Microsoft.VCRedist.2015+.x86@14.51.36210.0': [installer({
          architecture: 'x86',
          url: 'https://aka.ms/vc14/vc_redist.x86.exe',
          sha256: VC_SHA,
          silentArgs: '/install /quiet /norestart',
        })],
      },
      {
        'Microsoft.VCRedist.2015+.x86': ['14.51.36210.0'],
      }
    );

    const result = await resolveWingetPackageDependencies({
      wingetId: 'QNAP.QfinderPro',
      version: '7.14.0.0626',
      architecture: 'x86',
      installerSha256: ROOT_SHA,
      installScope: 'machine',
    }, io);

    expect(result).toEqual([
      expect.objectContaining({
        packageIdentifier: 'Microsoft.VCRedist.2015+.x86',
        architecture: 'x86',
        version: '14.51.36210.0',
        installerSha256: VC_SHA,
        successCodes: [-2147023258, 0, 1638],
      }),
    ]);
  });

  it('selects the newest version satisfying the declared minimum', async () => {
    const io = fixtureIo(
      {
        'Example.App@1.0.0': [installer({
          packageDependencies: [{
            packageIdentifier: 'Microsoft.VCRedist.2015+.x64',
            minimumVersion: '14.40.0.0',
          }],
        })],
        'Microsoft.VCRedist.2015+.x64@14.30.0.0': [installer({ sha256: VC_SHA })],
        'Microsoft.VCRedist.2015+.x64@14.40.0.0': [installer({ sha256: VC_SHA })],
        'Microsoft.VCRedist.2015+.x64@14.50.0.0': [installer({ sha256: VC_SHA })],
      },
      {
        'Microsoft.VCRedist.2015+.x64': ['14.40.0.0', '14.30.0.0', '14.50.0.0'],
      }
    );

    const [dependency] = await resolveWingetPackageDependencies({
      wingetId: 'Example.App',
      version: '1.0.0',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
    }, io);
    expect(dependency.version).toBe('14.50.0.0');
    expect(dependency.minimumVersion).toBe('14.40.0.0');
  });

  it('bundles a reviewed .NET Desktop Runtime Burn prerequisite', async () => {
    const io = fixtureIo(
      {
        'Example.App@1.0.0': [installer({
          packageDependencies: [{
            packageIdentifier: 'Microsoft.DotNet.DesktopRuntime.10',
            minimumVersion: '10.0.10',
          }],
        })],
        'Microsoft.DotNet.DesktopRuntime.10@10.0.11': [installer({
          type: 'burn',
          url: 'https://download.microsoft.com/windowsdesktop-runtime-10.0.11-win-x64.exe',
          sha256: VC_SHA,
          silentArgs: '/quiet /norestart',
        })],
      },
      { 'Microsoft.DotNet.DesktopRuntime.10': ['10.0.11'] }
    );

    const [dependency] = await resolveWingetPackageDependencies({
      wingetId: 'Example.App',
      version: '1.0.0',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
    }, io);

    expect(dependency).toMatchObject({
      packageIdentifier: 'Microsoft.DotNet.DesktopRuntime.10',
      version: '10.0.11',
      installerType: 'burn',
      silentArgs: '/quiet /norestart',
    });
  });

  it('bundles a reviewed ASP.NET Core Runtime Burn prerequisite', async () => {
    const io = fixtureIo(
      {
        'Example.App@1.0.0': [installer({
          packageDependencies: [{
            packageIdentifier: 'Microsoft.DotNet.AspNetCore.8',
            minimumVersion: '8.0.29',
          }],
        })],
        'Microsoft.DotNet.AspNetCore.8@8.0.30': [installer({
          type: 'burn',
          url: 'https://download.microsoft.com/aspnetcore-runtime-8.0.30-win-x64.exe',
          sha256: VC_SHA,
          silentArgs: '/quiet /norestart',
        })],
      },
      { 'Microsoft.DotNet.AspNetCore.8': ['8.0.30'] }
    );

    const [dependency] = await resolveWingetPackageDependencies({
      wingetId: 'Example.App',
      version: '1.0.0',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
    }, io);

    expect(dependency).toMatchObject({
      packageIdentifier: 'Microsoft.DotNet.AspNetCore.8',
      minimumVersion: '8.0.29',
      version: '8.0.30',
      installerType: 'burn',
      silentArgs: '/quiet /norestart',
    });
  });

  it('selects the reviewed PowerShell Wix installer instead of its MSIX variant', async () => {
    const io = fixtureIo(
      {
        'Example.App@1.0.0': [installer({
          packageDependencies: [{ packageIdentifier: 'Microsoft.PowerShell' }],
        })],
        'Microsoft.PowerShell@7.6.4.0': [
          installer({
            type: 'msix',
            url: 'https://github.com/PowerShell/PowerShell/releases/PowerShell-7.6.4.msixbundle',
            sha256: 'C'.repeat(64),
            silentArgs: '',
          }),
          installer({
            type: 'wix',
            url: 'https://github.com/PowerShell/PowerShell/releases/PowerShell-7.6.4-win-x64.msi',
            sha256: VC_SHA,
            silentArgs: '/qn /norestart',
          }),
        ],
      },
      { 'Microsoft.PowerShell': ['7.6.4.0'] }
    );

    const [dependency] = await resolveWingetPackageDependencies({
      wingetId: 'Example.App',
      version: '1.0.0',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
    }, io);

    expect(dependency).toMatchObject({
      packageIdentifier: 'Microsoft.PowerShell',
      installerType: 'wix',
      silentArgs: '/qn /norestart',
      installerSha256: VC_SHA,
    });
  });

  it('bundles the reviewed Microsoft VCLibs APPX payload for MSIX packages', async () => {
    const io = fixtureIo(
      {
        'Microsoft.WindowsApp@2.0.1314.0': [installer({
          type: 'msix',
          packageDependencies: [{ packageIdentifier: 'Microsoft.VCLibs.Desktop.14' }],
        })],
        'Microsoft.VCLibs.Desktop.14@14.0.33728.0': [installer({
          type: 'zip',
          nestedInstallerType: 'appx',
          nestedInstallerPath: 'x64/Microsoft.VCLibs.140.00.UWPDesktop_14.0.33728.0_x64.appx',
          packageFamilyName: 'Microsoft.VCLibs.140.00.UWPDesktop_8wekyb3d8bbwe',
          url: 'https://github.com/microsoft/winget-cli/releases/download/v1.9.25180/DesktopAppInstaller_Dependencies.zip',
          sha256: VC_SHA,
          silentArgs: '',
        })],
      },
      { 'Microsoft.VCLibs.Desktop.14': ['14.0.33728.0'] }
    );

    const [dependency] = await resolveWingetPackageDependencies({
      wingetId: 'Microsoft.WindowsApp',
      version: '2.0.1314.0',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
    }, io);

    expect(dependency).toMatchObject({
      packageIdentifier: 'Microsoft.VCLibs.Desktop.14',
      installerType: 'zip',
      nestedInstallerType: 'appx',
      nestedInstallerPath: 'x64/Microsoft.VCLibs.140.00.UWPDesktop_14.0.33728.0_x64.appx',
      packageFamilyName: 'Microsoft.VCLibs.140.00.UWPDesktop_8wekyb3d8bbwe',
    });
  });

  it('fails closed for dependency families that have not been reviewed', async () => {
    const io = fixtureIo(
      { 'Example.App@1.0.0': [installer({
        packageDependencies: [{ packageIdentifier: 'Vendor.Runtime' }],
      })] },
      {}
    );

    await expect(resolveWingetPackageDependencies({
      wingetId: 'Example.App',
      version: '1.0.0',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
    }, io)).rejects.toMatchObject({
      blockCode: 'unreviewed_dependency',
      message: expect.stringContaining('not in the reviewed redistribution allowlist'),
    });
  });

  it('fails closed when WinGet declares an unsupported external dependency', async () => {
    const io = fixtureIo(
      { 'Example.App@1.0.0': [installer({ externalDependencies: ['Vendor account'] })] },
      {}
    );

    await expect(resolveWingetPackageDependencies({
      wingetId: 'Example.App',
      version: '1.0.0',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
    }, io)).rejects.toThrow('declares unsupported dependencies');
  });

  it('refuses machine-wide prerequisites in a user-scope package', async () => {
    const io = fixtureIo(
      { 'Example.App@1.0.0': [installer({
        packageDependencies: [{
          packageIdentifier: 'Microsoft.VCRedist.2015+.x64',
        }],
      })] },
      {}
    );

    await expect(resolveWingetPackageDependencies({
      wingetId: 'Example.App',
      version: '1.0.0',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
      installScope: 'user',
    }, io)).rejects.toThrow('cannot be installed safely in user scope');
  });

  it('refuses a user-scope installer that explicitly requires elevation', async () => {
    const io = fixtureIo(
      { 'Example.App@1.0.0': [installer({
        scope: 'user',
        elevationRequirement: 'elevationRequired',
      })] },
      {}
    );

    await expect(resolveWingetPackageDependencies({
      wingetId: 'Example.App',
      version: '1.0.0',
      architecture: 'x64',
      installerSha256: ROOT_SHA,
      installScope: 'user',
    }, io)).rejects.toMatchObject({
      blockCode: 'user_scope_elevation_required',
      message: expect.stringContaining('requires elevation'),
    });
  });

  it('requires the exact trusted root installer hash', async () => {
    const io = fixtureIo(
      { 'Example.App@1.0.0': [installer()] },
      {}
    );

    await expect(resolveWingetPackageDependencies({
      wingetId: 'Example.App',
      version: '1.0.0',
      architecture: 'x64',
      installerSha256: 'C'.repeat(64),
    }, io)).rejects.toMatchObject({
      blockCode: 'trusted_installer_tuple_unavailable',
      message: expect.stringContaining('trusted WinGet installer tuple'),
    });
  });
});
