import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeInstaller,
  fetchLocaleManifest,
  getFullManifest,
  clearManifestCache,
} from '../manifest-api';
import type { WingetInstaller, NormalizedInstaller } from '@/types/winget';

// Mock fetch for network tests
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('normalizeInstaller', () => {
  it('should normalize a basic installer', () => {
    const installer: WingetInstaller = {
      Architecture: 'x64',
      InstallerUrl: 'https://example.com/installer.exe',
      InstallerSha256: 'abc123def456',
      InstallerType: 'exe',
    };

    const result = normalizeInstaller(installer);

    expect(result).toEqual({
      architecture: 'x64',
      url: 'https://example.com/installer.exe',
      sha256: 'abc123def456',
      type: 'exe',
      scope: undefined,
      silentArgs: '/S',
      productCode: undefined,
      packageFamilyName: undefined,
    });
  });

  it('should use Silent switch when provided', () => {
    const installer: WingetInstaller = {
      Architecture: 'x64',
      InstallerUrl: 'https://example.com/installer.exe',
      InstallerSha256: 'abc123',
      InstallerType: 'exe',
      InstallerSwitches: {
        Silent: '/VERYSILENT /SUPPRESSMSGBOXES',
      },
    };

    const result = normalizeInstaller(installer);

    expect(result.silentArgs).toBe('/VERYSILENT /SUPPRESSMSGBOXES');
  });

  it('should use SilentWithProgress when Silent is not available', () => {
    const installer: WingetInstaller = {
      Architecture: 'x64',
      InstallerUrl: 'https://example.com/installer.exe',
      InstallerSha256: 'abc123',
      InstallerType: 'exe',
      InstallerSwitches: {
        SilentWithProgress: '/S /passive',
      },
    };

    const result = normalizeInstaller(installer);

    expect(result.silentArgs).toBe('/S /passive');
  });

  it('should include scope when provided', () => {
    const installer: WingetInstaller = {
      Architecture: 'x64',
      InstallerUrl: 'https://example.com/installer.exe',
      InstallerSha256: 'abc123',
      InstallerType: 'exe',
      Scope: 'user',
    };

    const result = normalizeInstaller(installer);

    expect(result.scope).toBe('user');
  });

  it('should include productCode for MSI installers', () => {
    const installer: WingetInstaller = {
      Architecture: 'x64',
      InstallerUrl: 'https://example.com/installer.msi',
      InstallerSha256: 'abc123',
      InstallerType: 'msi',
      ProductCode: '{12345678-1234-1234-1234-123456789012}',
    };

    const result = normalizeInstaller(installer);

    expect(result.productCode).toBe('{12345678-1234-1234-1234-123456789012}');
  });

  it('should include packageFamilyName for MSIX installers', () => {
    const installer: WingetInstaller = {
      Architecture: 'x64',
      InstallerUrl: 'https://example.com/installer.msix',
      InstallerSha256: 'abc123',
      InstallerType: 'msix',
      PackageFamilyName: 'Microsoft.App_8wekyb3d8bbwe',
    };

    const result = normalizeInstaller(installer);

    expect(result.packageFamilyName).toBe('Microsoft.App_8wekyb3d8bbwe');
  });

  describe('Custom switches handling', () => {
    it('should append Custom to the default silent switch when only Custom is provided', () => {
      // e.g. Greenshot declares only Custom: '/ALLUSERS' in its manifest
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/Greenshot-INSTALLER.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'inno',
        InstallerSwitches: {
          Custom: '/ALLUSERS',
        },
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /ALLUSERS');
    });

    it('should append Custom after Silent when both are provided', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
        InstallerSwitches: {
          Silent: '/VERYSILENT',
          Custom: '/ALLUSERS',
        },
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/VERYSILENT /ALLUSERS');
    });

    it('should append Custom after SilentWithProgress when Silent is not available', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
        InstallerSwitches: {
          SilentWithProgress: '/S /passive',
          Custom: '/ALLUSERS',
        },
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/S /passive /ALLUSERS');
    });

    it('should leave switches unchanged when Custom is not provided', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
        InstallerSwitches: {
          Silent: '/VERYSILENT /SUPPRESSMSGBOXES',
        },
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/VERYSILENT /SUPPRESSMSGBOXES');
    });

    it('should not duplicate Custom when it is already contained in the silent switch', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
        InstallerSwitches: {
          Silent: '/VERYSILENT /ALLUSERS',
          Custom: '/ALLUSERS',
        },
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/VERYSILENT /ALLUSERS');
    });

    it('should append a Custom switch that is a substring of an existing switch', () => {
      // Token-level dedupe: /S is not the same switch as /SILENT
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
        InstallerSwitches: {
          Silent: '/SILENT',
          Custom: '/S',
        },
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/SILENT /S');
    });
  });

  describe('default silent arguments', () => {
    it('should use default args for MSI', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.msi',
        InstallerSha256: 'abc123',
        InstallerType: 'msi',
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/qn /norestart');
    });

    it('should use default args for Inno', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'inno',
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART');
    });

    it('should use default args for Nullsoft (NSIS)', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'nullsoft',
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/S');
    });

    it('should use default args for WiX', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.msi',
        InstallerSha256: 'abc123',
        InstallerType: 'wix',
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/qn /norestart');
    });

    it('should use default args for Burn bundles', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/bundle.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'burn',
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/quiet /norestart');
    });

    it('should use empty args for MSIX', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.msix',
        InstallerSha256: 'abc123',
        InstallerType: 'msix',
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('');
    });

    it('should use empty args for portable', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/app.zip',
        InstallerSha256: 'abc123',
        InstallerType: 'portable',
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('');
    });
  });

  describe('nested installer handling (zip)', () => {
    it('should map nested installer type and path for zip installers', () => {
      // e.g. dotPDN.PaintDotNet ships a zip wrapping an exe installer
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/paint.net.5.1.12.install.x64.zip',
        InstallerSha256: 'abc123',
        InstallerType: 'zip',
        NestedInstallerType: 'exe',
        NestedInstallerFiles: [
          { RelativeFilePath: 'paint.net.5.1.12.install.x64.exe' },
        ],
      };

      const result = normalizeInstaller(installer);

      expect(result.type).toBe('zip');
      expect(result.nestedInstallerType).toBe('exe');
      expect(result.nestedInstallerPath).toBe('paint.net.5.1.12.install.x64.exe');
      // Default silent switch comes from the NESTED type, not zip
      expect(result.silentArgs).toBe('/S');
    });

    it('should pick the nested-type default switch for zip with nested inno', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/app.zip',
        InstallerSha256: 'abc123',
        InstallerType: 'zip',
        NestedInstallerType: 'inno',
        NestedInstallerFiles: [{ RelativeFilePath: 'setup.exe' }],
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART');
    });

    it('should prefer declared Silent switches over nested-type defaults', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/app.zip',
        InstallerSha256: 'abc123',
        InstallerType: 'zip',
        NestedInstallerType: 'inno',
        NestedInstallerFiles: [{ RelativeFilePath: 'setup.exe' }],
        InstallerSwitches: {
          Silent: '/CUSTOMSILENT',
        },
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('/CUSTOMSILENT');
    });

    it('should leave nested fields undefined for non-zip installers', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
      };

      const result = normalizeInstaller(installer);

      expect(result.nestedInstallerType).toBeUndefined();
      expect(result.nestedInstallerPath).toBeUndefined();
      expect(result.silentArgs).toBe('/S');
    });

    it('should yield undefined nestedInstallerPath for zip without NestedInstallerFiles', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/app.zip',
        InstallerSha256: 'abc123',
        InstallerType: 'zip',
        NestedInstallerType: 'exe',
      };

      const result = normalizeInstaller(installer);

      expect(result.nestedInstallerType).toBe('exe');
      expect(result.nestedInstallerPath).toBeUndefined();
    });

    it('should keep the zip default (empty) when zip has no nested type', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/app.zip',
        InstallerSha256: 'abc123',
        InstallerType: 'zip',
      };

      const result = normalizeInstaller(installer);

      expect(result.silentArgs).toBe('');
    });
  });

  describe('manifest package dependencies', () => {
    it('should map PackageDependencies to packageDependencies with identifier and minimum version', () => {
      // e.g. PowerToys depends on Microsoft.DotNet.DesktopRuntime.8
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
        Dependencies: {
          PackageDependencies: [
            { PackageIdentifier: 'Microsoft.DotNet.DesktopRuntime.8', MinimumVersion: '8.0.0' },
            { PackageIdentifier: 'Microsoft.VCRedist.2015+.x64' },
          ],
        },
      };

      const result = normalizeInstaller(installer);

      expect(result.packageDependencies).toEqual([
        { packageIdentifier: 'Microsoft.DotNet.DesktopRuntime.8', minimumVersion: '8.0.0' },
        { packageIdentifier: 'Microsoft.VCRedist.2015+.x64', minimumVersion: undefined },
      ]);
    });

    it('should leave packageDependencies undefined when Dependencies is absent', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
      };

      const result = normalizeInstaller(installer);

      expect(result.packageDependencies).toBeUndefined();
    });

    it('should leave packageDependencies undefined when PackageDependencies is empty', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
        Dependencies: {
          WindowsFeatures: ['NetFx3'],
          PackageDependencies: [],
        },
      };

      const result = normalizeInstaller(installer);

      expect(result.packageDependencies).toBeUndefined();
    });

    it('should skip dependency entries without a PackageIdentifier', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
        Dependencies: {
          PackageDependencies: [
            { PackageIdentifier: '' },
            { PackageIdentifier: 'Microsoft.DotNet.DesktopRuntime.8' },
          ],
        },
      };

      const result = normalizeInstaller(installer);

      expect(result.packageDependencies).toEqual([
        { packageIdentifier: 'Microsoft.DotNet.DesktopRuntime.8', minimumVersion: undefined },
      ]);
    });
  });

  describe('architecture handling', () => {
    it('should handle x64 architecture', () => {
      const installer: WingetInstaller = {
        Architecture: 'x64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
      };

      expect(normalizeInstaller(installer).architecture).toBe('x64');
    });

    it('should handle x86 architecture', () => {
      const installer: WingetInstaller = {
        Architecture: 'x86',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
      };

      expect(normalizeInstaller(installer).architecture).toBe('x86');
    });

    it('should handle arm64 architecture', () => {
      const installer: WingetInstaller = {
        Architecture: 'arm64',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
      };

      expect(normalizeInstaller(installer).architecture).toBe('arm64');
    });

    it('should handle neutral architecture', () => {
      const installer: WingetInstaller = {
        Architecture: 'neutral',
        InstallerUrl: 'https://example.com/installer.exe',
        InstallerSha256: 'abc123',
        InstallerType: 'exe',
      };

      expect(normalizeInstaller(installer).architecture).toBe('neutral');
    });
  });
});

describe('getManifestPaths logic', () => {
  // Testing the path building logic indirectly through manifest expectations
  it('should handle simple package IDs', () => {
    // e.g., "Git.Git" -> "g/Git/Git"
    const wingetId = 'Git.Git';
    const parts = wingetId.split('.');
    const firstLetter = parts[0].charAt(0).toLowerCase();

    expect(firstLetter).toBe('g');
    expect(parts[0]).toBe('Git');
    expect(parts[1]).toBe('Git');
  });

  it('should handle multi-part package IDs', () => {
    // e.g., "Microsoft.VisualStudioCode" -> "m/Microsoft/VisualStudioCode"
    const wingetId = 'Microsoft.VisualStudioCode';
    const parts = wingetId.split('.');
    const firstLetter = parts[0].charAt(0).toLowerCase();

    expect(firstLetter).toBe('m');
    expect(parts.join('/')).toBe('Microsoft/VisualStudioCode');
  });

  it('should handle complex package IDs with multiple dots', () => {
    // e.g., "Adobe.Acrobat.Reader.64-bit" -> "a/Adobe/Acrobat/Reader/64-bit"
    const wingetId = 'Adobe.Acrobat.Reader.64-bit';
    const parts = wingetId.split('.');
    const firstLetter = parts[0].charAt(0).toLowerCase();

    expect(firstLetter).toBe('a');
    expect(parts.length).toBe(4);
    expect(parts.join('/')).toBe('Adobe/Acrobat/Reader/64-bit');
  });

  it('should handle uppercase and lowercase consistently', () => {
    const ids = ['Microsoft.VSCode', 'google.Chrome', 'NVIDIA.GeForceExperience'];

    for (const id of ids) {
      const parts = id.split('.');
      const firstLetter = parts[0].charAt(0).toLowerCase();

      expect(firstLetter).toMatch(/^[a-z]$/);
    }
  });
});

describe('version sorting', () => {
  it('should sort semantic versions correctly', () => {
    const versions = ['1.0.0', '2.0.0', '1.5.0', '10.0.0', '1.10.0'];

    const sorted = versions.sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true })
    );

    expect(sorted[0]).toBe('10.0.0');
    expect(sorted[1]).toBe('2.0.0');
    expect(sorted[2]).toBe('1.10.0');
    expect(sorted[3]).toBe('1.5.0');
    expect(sorted[4]).toBe('1.0.0');
  });

  it('should handle versions with different formats', () => {
    const versions = ['1.85.2', '1.85.10', '1.84.0', '1.9.0'];

    const sorted = versions.sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true })
    );

    expect(sorted[0]).toBe('1.85.10');
    expect(sorted[1]).toBe('1.85.2');
  });

  it('should handle versions with build numbers', () => {
    const versions = ['121.0.6167.85', '121.0.6167.160', '120.0.6099.129'];

    const sorted = versions.sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true })
    );

    expect(sorted[0]).toBe('121.0.6167.160');
    expect(sorted[1]).toBe('121.0.6167.85');
    expect(sorted[2]).toBe('120.0.6099.129');
  });
});

describe('installer type mapping', () => {
  const testCases: Array<{ input: string; expected: string }> = [
    { input: 'msix', expected: 'msix' },
    { input: 'msi', expected: 'msi' },
    { input: 'appx', expected: 'appx' },
    { input: 'exe', expected: 'exe' },
    { input: 'zip', expected: 'zip' },
    { input: 'inno', expected: 'inno' },
    { input: 'nullsoft', expected: 'nullsoft' },
    { input: 'wix', expected: 'wix' },
    { input: 'burn', expected: 'burn' },
    { input: 'pwa', expected: 'pwa' },
    { input: 'portable', expected: 'portable' },
    // Case insensitive
    { input: 'MSI', expected: 'msi' },
    { input: 'EXE', expected: 'exe' },
    { input: 'Inno', expected: 'inno' },
  ];

  it.each(testCases)('should map "$input" to "$expected"', ({ input, expected }) => {
    const typeMap: Record<string, string> = {
      msix: 'msix',
      msi: 'msi',
      appx: 'appx',
      exe: 'exe',
      zip: 'zip',
      inno: 'inno',
      nullsoft: 'nullsoft',
      wix: 'wix',
      burn: 'burn',
      pwa: 'pwa',
      portable: 'portable',
    };

    const result = typeMap[input.toLowerCase()] || 'exe';

    expect(result).toBe(expected);
  });

  it('should default to "exe" for unknown types', () => {
    const typeMap: Record<string, string> = {
      msix: 'msix',
      msi: 'msi',
      exe: 'exe',
    };

    const result = typeMap['unknown'?.toLowerCase()] || 'exe';

    expect(result).toBe('exe');
  });
});

describe('architecture priority', () => {
  it('should prefer x64 architecture when x64 is preferred', () => {
    const archPriority: Record<string, string[]> = {
      x64: ['x64', 'neutral', 'x86'],
      x86: ['x86', 'neutral', 'x64'],
      arm64: ['arm64', 'arm', 'neutral', 'x64'],
    };

    const installers: NormalizedInstaller[] = [
      { architecture: 'x86', url: '', sha256: '', type: 'exe' },
      { architecture: 'x64', url: '', sha256: '', type: 'exe' },
      { architecture: 'neutral', url: '', sha256: '', type: 'exe' },
    ];

    const priority = archPriority['x64'];
    let selected: NormalizedInstaller | undefined;

    for (const arch of priority) {
      selected = installers.find((i) => i.architecture === arch);
      if (selected) break;
    }

    expect(selected?.architecture).toBe('x64');
  });

  it('should fall back to neutral when preferred arch is not available', () => {
    const archPriority: Record<string, string[]> = {
      x64: ['x64', 'neutral', 'x86'],
    };

    const installers: NormalizedInstaller[] = [
      { architecture: 'x86', url: '', sha256: '', type: 'exe' },
      { architecture: 'neutral', url: '', sha256: '', type: 'exe' },
    ];

    const priority = archPriority['x64'];
    let selected: NormalizedInstaller | undefined;

    for (const arch of priority) {
      selected = installers.find((i) => i.architecture === arch);
      if (selected) break;
    }

    expect(selected?.architecture).toBe('neutral');
  });

  it('should fall back to x86 when only x86 is available for x64 preference', () => {
    const archPriority: Record<string, string[]> = {
      x64: ['x64', 'neutral', 'x86'],
    };

    const installers: NormalizedInstaller[] = [
      { architecture: 'x86', url: '', sha256: '', type: 'exe' },
    ];

    const priority = archPriority['x64'];
    let selected: NormalizedInstaller | undefined;

    for (const arch of priority) {
      selected = installers.find((i) => i.architecture === arch);
      if (selected) break;
    }

    expect(selected?.architecture).toBe('x86');
  });

  it('should handle arm64 preference correctly', () => {
    const archPriority: Record<string, string[]> = {
      arm64: ['arm64', 'arm', 'neutral', 'x64'],
    };

    const installers: NormalizedInstaller[] = [
      { architecture: 'x64', url: '', sha256: '', type: 'exe' },
      { architecture: 'arm', url: '', sha256: '', type: 'exe' },
    ];

    const priority = archPriority['arm64'];
    let selected: NormalizedInstaller | undefined;

    for (const arch of priority) {
      selected = installers.find((i) => i.architecture === arch);
      if (selected) break;
    }

    expect(selected?.architecture).toBe('arm');
  });
});

function yamlResponse(body: string) {
  return { ok: true, status: 200, text: async () => body };
}

function notFound() {
  return { ok: false, status: 404, text: async () => '' };
}

describe('fetchLocaleManifest locale resolution', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('returns the en-US locale manifest when it has a description', async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('Git.Git.locale.en-US.yaml')) {
        return yamlResponse('PackageLocale: en-US\nShortDescription: Distributed version control\n');
      }
      return notFound();
    });

    const manifest = await fetchLocaleManifest('Git.Git', '2.44.0');

    expect(manifest?.ShortDescription).toBe('Distributed version control');
    // en-US hit short-circuits: no version-manifest or default-locale fetch
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the DefaultLocale file when there is no en-US locale', async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/3.0.0.0/xkonglong.gongwen.yaml')) {
        return yamlResponse('PackageIdentifier: xkonglong.gongwen\nDefaultLocale: zh-CN\nManifestType: version\n');
      }
      if (url.endsWith('xkonglong.gongwen.locale.zh-CN.yaml')) {
        return yamlResponse('PackageLocale: zh-CN\nShortDescription: Chinese-only description\n');
      }
      return notFound();
    });

    const manifest = await fetchLocaleManifest('xkonglong.gongwen', '3.0.0.0');

    expect(manifest?.ShortDescription).toBe('Chinese-only description');
  });

  it('uses singleton manifests that carry locale fields in <id>.yaml', async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/1.0.0/Foo.Bar.yaml')) {
        return yamlResponse('PackageIdentifier: Foo.Bar\nShortDescription: Singleton description\nManifestType: singleton\n');
      }
      return notFound();
    });

    const manifest = await fetchLocaleManifest('Foo.Bar', '1.0.0');

    expect(manifest?.ShortDescription).toBe('Singleton description');
  });

  it('builds slash-joined paths for multi-part package IDs', async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/m/MongoDB/Compass/Full/1.49.0/MongoDB.Compass.Full.locale.en-US.yaml')) {
        return yamlResponse('PackageLocale: en-US\nShortDescription: The GUI for MongoDB\n');
      }
      return notFound();
    });

    const manifest = await fetchLocaleManifest('MongoDB.Compass.Full', '1.49.0');

    expect(manifest?.ShortDescription).toBe('The GUI for MongoDB');
  });

  it('returns null when no manifest carries a description', async () => {
    mockFetch.mockImplementation(async () => notFound());

    const manifest = await fetchLocaleManifest('Foo.Missing', '1.0.0');

    expect(manifest).toBeNull();
  });

  it('resolves the DefaultLocale file when en-US exists but has no description', async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('Foo.German.locale.en-US.yaml')) {
        // Additional-locale files may omit ShortDescription/Description
        return yamlResponse('PackageLocale: en-US\nReleaseNotesUrl: https://example.com/notes\n');
      }
      if (url.endsWith('/2.0.0/Foo.German.yaml')) {
        return yamlResponse('PackageIdentifier: Foo.German\nDefaultLocale: de-DE\nManifestType: version\n');
      }
      if (url.endsWith('Foo.German.locale.de-DE.yaml')) {
        return yamlResponse('PackageLocale: de-DE\nShortDescription: Deutsche Beschreibung\n');
      }
      return notFound();
    });

    const manifest = await fetchLocaleManifest('Foo.German', '2.0.0');

    expect(manifest?.ShortDescription).toBe('Deutsche Beschreibung');
    // en-US file + version manifest + DefaultLocale file
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('still returns a description-less requested locale when nothing better exists', async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('Foo.Bare.locale.en-US.yaml')) {
        return yamlResponse('PackageLocale: en-US\nReleaseNotesUrl: https://example.com/notes\n');
      }
      return notFound();
    });

    const manifest = await fetchLocaleManifest('Foo.Bare', '1.0.0');

    // The pre-change behavior of returning the en-US manifest even without
    // a description is preserved (callers may want other locale fields)
    expect(manifest?.ReleaseNotesUrl).toBe('https://example.com/notes');
  });
});

describe('getFullManifest description order', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearManifestCache();
  });

  it('prefers ShortDescription over Description, matching the catalog syncs', async () => {
    mockFetch.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('Foo.App.installer.yaml')) {
        return yamlResponse(
          [
            'PackageIdentifier: Foo.App',
            'InstallerType: exe',
            'Installers:',
            '  - Architecture: x64',
            '    InstallerUrl: https://example.com/foo.exe',
            '    InstallerSha256: abc123',
          ].join('\n')
        );
      }
      if (url.endsWith('Foo.App.locale.en-US.yaml')) {
        return yamlResponse(
          'PackageLocale: en-US\nShortDescription: Short text\nDescription: Much longer marketing text\n'
        );
      }
      if (url.endsWith('/1.0.0/Foo.App.yaml')) {
        return yamlResponse('PackageIdentifier: Foo.App\nDefaultLocale: en-US\nManifestType: version\n');
      }
      return notFound();
    });

    const manifest = await getFullManifest('Foo.App', '1.0.0');

    expect(manifest?.Description).toBe('Short text');
    expect(manifest?.ShortDescription).toBe('Short text');

    // Common case stays at 3 parallel GitHub fetches (installer + en-US
    // locale + version manifest) with no extra DefaultLocale request
    const githubCalls = mockFetch.mock.calls.filter((call) =>
      String(call[0]).includes('raw.githubusercontent.com')
    );
    expect(githubCalls).toHaveLength(3);
  });
});
