import { describe, it, expect } from 'vitest';
import {
  generateDetectionRules,
  generateInstallCommand,
  generateUninstallCommand,
  validateDetectionRules,
} from '../detection-rules';
import type { NormalizedInstaller } from '@/types/winget';
import type {
  MsiDetectionRule,
  FileDetectionRule,
  RegistryDetectionRule,
  ScriptDetectionRule,
} from '@/types/intune';

describe('generateDetectionRules', () => {
  describe('MSI detection rules', () => {
    it('should prefer registry marker over product code when wingetId and version are available', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.msi',
        sha256: 'abc123',
        type: 'msi',
        productCode: '{12345678-1234-1234-1234-123456789012}',
      };

      const rules = generateDetectionRules(installer, 'Google Chrome', 'Google.Chrome', '120.0.6099.130');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('registry');
      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.keyPath).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Google_Chrome');
      expect(regRule.valueName).toBe('Version');
      expect(regRule.detectionType).toBe('version');
      expect(regRule.operator).toBe('greaterThanOrEqual');
      expect(regRule.detectionValue).toBe('120.0.6099.130');
    });

    it('should use HKCU registry marker for user-scoped MSI installs', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.msi',
        sha256: 'abc123',
        type: 'msi',
        scope: 'user',
        productCode: '{12345678-1234-1234-1234-123456789012}',
      };

      const rules = generateDetectionRules(installer, 'Test App', 'Publisher.TestApp', '1.2.3');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('registry');
      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.keyPath).toBe('HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Publisher_TestApp');
    });

    it('should use registry marker for WiX installers with wingetId and version', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.msi',
        sha256: 'abc123',
        type: 'wix',
        productCode: '{ABCD1234-5678-90AB-CDEF-1234567890AB}',
      };

      const rules = generateDetectionRules(installer, 'WiX App', 'Publisher.WixApp', '2.0.0');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('registry');
    });

    it('should generate MSI product code rule when wingetId and version are missing', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.msi',
        sha256: 'abc123',
        type: 'msi',
        productCode: '{12345678-1234-1234-1234-123456789012}',
      };

      const rules = generateDetectionRules(installer, 'Test App');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('msi');
      const msiRule = rules[0] as MsiDetectionRule;
      expect(msiRule.productCode).toBe('{12345678-1234-1234-1234-123456789012}');
      expect(msiRule.productVersionOperator).toBe('greaterThanOrEqual');
    });

    it('should fall back to folder detection when product code is missing', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.msi',
        sha256: 'abc123',
        type: 'msi',
      };

      const rules = generateDetectionRules(installer, 'Test App');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('file');
      const fileRule = rules[0] as FileDetectionRule;
      expect(fileRule.path).toBe('%ProgramFiles%');
      expect(fileRule.fileOrFolderName).toBe('Test App');
      expect(fileRule.detectionType).toBe('exists');
    });

    it('should handle WiX installer type same as MSI', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.msi',
        sha256: 'abc123',
        type: 'wix',
        productCode: '{ABCD1234-5678-90AB-CDEF-1234567890AB}',
      };

      const rules = generateDetectionRules(installer, 'WiX App');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('msi');
    });
  });

  describe('Registry marker detection rules', () => {
    it('should generate registry marker rule for EXE installer with wingetId and version', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'exe',
      };

      const rules = generateDetectionRules(installer, 'Test App', 'Publisher.TestApp', '1.0.0');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('registry');
      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.keyPath).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Publisher_TestApp');
      expect(regRule.valueName).toBe('Version');
      expect(regRule.detectionType).toBe('version');
      expect(regRule.operator).toBe('greaterThanOrEqual');
      expect(regRule.detectionValue).toBe('1.0.0');
    });

    it('should use exact string detection for opaque WinGet versions', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/amp.exe',
        sha256: 'abc123',
        type: 'portable',
      };

      const rules = generateDetectionRules(
        installer,
        'Amp CLI',
        'Sourcegraph.Amp',
        '0.0.1786233956-g40887a'
      );

      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.detectionType).toBe('string');
      expect(regRule.operator).toBe('equal');
      expect(regRule.detectionValue).toBe('0.0.1786233956-g40887a');
    });

    it('should use exact string detection outside the four-part Windows version range', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'exe',
      };

      const rules = generateDetectionRules(
        installer,
        'Test App',
        'Publisher.TestApp',
        '1.2.3.4.5'
      );

      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.detectionType).toBe('string');
      expect(regRule.operator).toBe('equal');
    });

    it('should use HKCU for user-scoped installs', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'exe',
        scope: 'user',
      };

      const rules = generateDetectionRules(installer, 'Test App', 'Publisher.TestApp', '2.0.0');

      expect(rules).toHaveLength(1);
      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.keyPath).toContain('HKEY_CURRENT_USER');
    });

    it('should sanitize dots and dashes in wingetId', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'inno',
      };

      const rules = generateDetectionRules(installer, 'Test App', 'My-Publisher.Test.App-Pro', '1.0');

      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.keyPath).toContain('My_Publisher_Test_App_Pro');
    });

    it('should fall back to folder detection when wingetId or version is missing', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'exe',
      };

      const rules = generateDetectionRules(installer, 'Test App');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('file');
    });

    it('should use a custom marker root when provided', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'exe',
      };

      const rules = generateDetectionRules(
        installer,
        'Test App',
        'Publisher.TestApp',
        '1.0.0',
        'SOFTWARE\\Contoso\\Apps'
      );

      expect(rules).toHaveLength(1);
      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.keyPath).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Apps\\Publisher_TestApp');
    });

    it('should use a custom marker root with HKCU for user scope', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'exe',
        scope: 'user',
      };

      const rules = generateDetectionRules(
        installer,
        'Test App',
        'Publisher.TestApp',
        '1.0.0',
        'SOFTWARE\\Contoso\\Apps'
      );

      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.keyPath).toBe('HKEY_CURRENT_USER\\SOFTWARE\\Contoso\\Apps\\Publisher_TestApp');
    });

    it('should use a custom marker root for MSI installers', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.msi',
        sha256: 'abc123',
        type: 'msi',
        productCode: '{12345678-1234-1234-1234-123456789012}',
      };

      const rules = generateDetectionRules(
        installer,
        'Test App',
        'Publisher.TestApp',
        '1.0.0',
        'SOFTWARE\\Contoso\\Apps'
      );

      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.keyPath).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Apps\\Publisher_TestApp');
    });

    it('should normalize a marker root with hive prefix and trailing backslash', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'exe',
      };

      const rules = generateDetectionRules(
        installer,
        'Test App',
        'Publisher.TestApp',
        '1.0.0',
        'HKLM\\SOFTWARE\\Contoso\\'
      );

      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.keyPath).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Publisher_TestApp');
    });

    it('should fall back to the default marker root for an empty custom path', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'exe',
      };

      const rules = generateDetectionRules(installer, 'Test App', 'Publisher.TestApp', '1.0.0', '');

      const regRule = rules[0] as RegistryDetectionRule;
      expect(regRule.keyPath).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Publisher_TestApp');
    });
  });

  describe('MSIX detection rules', () => {
    it('should generate script detection for MSIX with package family name', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.msix',
        sha256: 'abc123',
        type: 'msix',
        packageFamilyName: 'Microsoft.VSCode_8wekyb3d8bbwe',
      };

      const rules = generateDetectionRules(installer, 'VS Code');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('script');
      const scriptRule = rules[0] as ScriptDetectionRule;
      expect(scriptRule.scriptContent).toContain('Get-AppxPackage');
      expect(scriptRule.scriptContent).toContain('Microsoft.VSCode');
      expect(scriptRule.enforceSignatureCheck).toBe(false);
      expect(scriptRule.runAs32Bit).toBe(false);
    });

    it('should fall back to folder detection when package family name is missing', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.msix',
        sha256: 'abc123',
        type: 'msix',
      };

      const rules = generateDetectionRules(installer, 'Test App');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('file');
    });

    it('should handle APPX type same as MSIX', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.appx',
        sha256: 'abc123',
        type: 'appx',
        packageFamilyName: 'TestApp_abc123',
      };

      const rules = generateDetectionRules(installer, 'Test App');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('script');
    });

    it('should detect a ZIP-wrapped AppX by its package family identity', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/dependencies.zip',
        sha256: 'abc123',
        type: 'zip',
        nestedInstallerType: 'msix',
        nestedInstallerPath: 'Dependencies\\x64\\Microsoft.NET.Native.Runtime.2.2.appx',
        packageFamilyName: 'Microsoft.NET.Native.Runtime.2.2_8wekyb3d8bbwe',
      };

      const rules = generateDetectionRules(
        installer,
        'Microsoft .NET Native Runtime',
        'Microsoft.DotNet.Native.Runtime',
        '2.2.28604.0'
      );

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('script');
      expect((rules[0] as ScriptDetectionRule).scriptContent).toContain(
        'Get-AppxPackage -Name "Microsoft.NET.Native.Runtime.2.2" -AllUsers'
      );
    });

    it('should query the current user and fall back only when running as SYSTEM', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/terminal.msixbundle',
        sha256: 'abc123',
        type: 'msix',
        scope: 'user',
        packageFamilyName: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe',
      };

      const rules = generateDetectionRules(installer, 'Windows Terminal');
      const script = (rules[0] as ScriptDetectionRule).scriptContent;

      expect(script).toContain('Get-AppxPackage -Name "Microsoft.WindowsTerminal"');
      expect(script).toContain(
        '[Security.Principal.WindowsIdentity]::GetCurrent().IsSystem'
      );
      expect(script).toContain(
        'if (-not $package -and $runningAsSystem) { $package = Get-AppxPackage -Name "Microsoft.WindowsTerminal" -AllUsers }'
      );
      expect(script).not.toContain('Get-AppxProvisionedPackage');
    });

    it('should check installed and provisioned identities for a machine-scoped package', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.msix',
        sha256: 'abc123',
        type: 'msix',
        scope: 'machine',
        packageFamilyName: 'Contoso.App_abc123',
      };

      const rules = generateDetectionRules(installer, 'Contoso App');
      const script = (rules[0] as ScriptDetectionRule).scriptContent;

      expect(script).toContain('Get-AppxPackage -Name "Contoso.App" -AllUsers');
      expect(script).toContain('Get-AppxProvisionedPackage -Online');
    });
  });

  describe('Folder detection rules', () => {
    it('should use %ProgramFiles% for x64 machine-scoped installs', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'portable',
      };

      const rules = generateDetectionRules(installer, 'Test App');
      const fileRule = rules[0] as FileDetectionRule;

      expect(fileRule.path).toBe('%ProgramFiles%');
      expect(fileRule.check32BitOn64System).toBe(false);
    });

    it('should use %ProgramFiles(x86)% for x86 installs', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x86',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'portable',
      };

      const rules = generateDetectionRules(installer, 'Test App');
      const fileRule = rules[0] as FileDetectionRule;

      expect(fileRule.path).toBe('%ProgramFiles(x86)%');
      expect(fileRule.check32BitOn64System).toBe(true);
    });

    it('should use %LOCALAPPDATA%\\Programs for user-scoped installs', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'portable',
        scope: 'user',
      };

      const rules = generateDetectionRules(installer, 'Test App');
      const fileRule = rules[0] as FileDetectionRule;

      expect(fileRule.path).toBe('%LOCALAPPDATA%\\Programs');
    });

    it('should sanitize invalid folder name characters', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'portable',
      };

      const rules = generateDetectionRules(installer, 'Test:App<v1>?');
      const fileRule = rules[0] as FileDetectionRule;

      expect(fileRule.fileOrFolderName).not.toContain(':');
      expect(fileRule.fileOrFolderName).not.toContain('<');
      expect(fileRule.fileOrFolderName).not.toContain('>');
      expect(fileRule.fileOrFolderName).not.toContain('?');
    });

    it('should truncate very long folder names', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'portable',
      };

      const longName = 'A'.repeat(100);
      const rules = generateDetectionRules(installer, longName);
      const fileRule = rules[0] as FileDetectionRule;

      expect(fileRule.fileOrFolderName.length).toBeLessThanOrEqual(64);
    });

    it('should use "Application" as fallback for empty name', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/app.exe',
        sha256: 'abc123',
        type: 'portable',
      };

      const rules = generateDetectionRules(installer, '   ');
      const fileRule = rules[0] as FileDetectionRule;

      expect(fileRule.fileOrFolderName).toBe('Application');
    });
  });

  describe('Burn installer detection', () => {
    it('should use registry marker for burn installers with wingetId', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/bundle.exe',
        sha256: 'abc123',
        type: 'burn',
      };

      const rules = generateDetectionRules(installer, 'Burn Bundle', 'Publisher.Bundle', '3.0.0');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('registry');
    });

    it('should fall back to folder detection for burn without wingetId', () => {
      const installer: NormalizedInstaller = {
        architecture: 'x64',
        url: 'https://example.com/bundle.exe',
        sha256: 'abc123',
        type: 'burn',
      };

      const rules = generateDetectionRules(installer, 'Burn Bundle');

      expect(rules).toHaveLength(1);
      expect(rules[0].type).toBe('file');
    });
  });
});

describe('generateInstallCommand', () => {
  it('should generate MSI install command', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/installer.msi',
      sha256: 'abc123',
      type: 'msi',
    };

    const command = generateInstallCommand(installer);

    expect(command).toContain('msiexec /i');
    expect(command).toContain('/qn');
    expect(command).toContain('ALLUSERS=1');
    expect(command).toContain('/norestart');
  });

  it('should generate user-scoped MSI install command', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/installer.msi',
      sha256: 'abc123',
      type: 'msi',
    };

    const command = generateInstallCommand(installer, 'user');

    expect(command).toContain('ALLUSERS=""');
  });

  it('preserves trusted WinGet custom properties in an MSI install command', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://downloads.example.com/Macabacus-9.9.2.msi',
      sha256: 'abc123',
      type: 'wix',
      silentArgs: '/qn /norestart OFFICE2016X64FOUND=1 EULA=1',
    };

    expect(generateInstallCommand(installer, 'machine')).toBe(
      'msiexec /i "Macabacus-9.9.2.msi" /qn /norestart OFFICE2016X64FOUND=1 EULA=1 ALLUSERS=1'
    );
  });

  it('does not override a manifest-owned MSI scope property', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/installer.msi',
      sha256: 'abc123',
      type: 'msi',
      silentArgs: '/qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=""',
    };

    expect(generateInstallCommand(installer, 'machine')).toBe(
      'msiexec /i "installer.msi" /qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=""'
    );
  });

  it('should generate MSIX install command', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/installer.msix',
      sha256: 'abc123',
      type: 'msix',
    };

    const command = generateInstallCommand(installer);

    expect(command).toContain('Add-AppxPackage');
  });

  it('should use custom silent args when provided', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/installer.exe',
      sha256: 'abc123',
      type: 'exe',
      silentArgs: '/VERYSILENT /NORESTART',
    };

    const command = generateInstallCommand(installer);

    expect(command).toContain('/VERYSILENT /NORESTART');
  });

  it('should use default silent args for Inno installer', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/setup.exe',
      sha256: 'abc123',
      type: 'inno',
    };

    const command = generateInstallCommand(installer);

    expect(command).toContain('/VERYSILENT');
    expect(command).toContain('/SUPPRESSMSGBOXES');
    expect(command).toContain('/NORESTART');
  });

  it('should use default silent args for Nullsoft installer', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/setup.exe',
      sha256: 'abc123',
      type: 'nullsoft',
    };

    const command = generateInstallCommand(installer);

    expect(command).toContain('/S');
  });

  it('should append .exe for extensionless EXE URLs', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://dl.pstmn.io/download/version/11.82.1/windows_64',
      sha256: 'abc123',
      type: 'exe',
    };

    const command = generateInstallCommand(installer);

    expect(command).toContain('"windows_64.exe"');
    expect(command).not.toContain('/S');
  });

  it('should append .msi for extensionless MSI URLs', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/releases/installer',
      sha256: 'abc123',
      type: 'msi',
    };

    const command = generateInstallCommand(installer);

    expect(command).toContain('msiexec /i "installer.msi"');
  });

  it('should generate zip extraction command', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.zip',
      sha256: 'abc123',
      type: 'zip',
    };

    const command = generateInstallCommand(installer);

    expect(command).toContain('Expand-Archive');
    expect(command).toContain('-Force');
  });

  it('should generate a nested installer command for non-portable zip packages', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.zip',
      sha256: 'abc123',
      type: 'zip',
      nestedInstallerType: 'inno',
      nestedInstallerPath: 'setup.exe',
      silentArgs: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
    };

    expect(generateInstallCommand(installer)).toBe(
      '"setup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-'
    );
  });

  it('should use msiexec for a nested MSI package', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.zip',
      sha256: 'abc123',
      type: 'zip',
      nestedInstallerType: 'msi',
      nestedInstallerPath: 'payload\\setup.msi',
      silentArgs: '/qn /norestart',
    };

    expect(generateInstallCommand(installer)).toBe(
      'msiexec /i "payload\\setup.msi" /qn /norestart ALLUSERS=1'
    );
  });

  it('should not launch a nested portable executable', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.zip',
      sha256: 'abc123',
      type: 'zip',
      nestedInstallerType: 'portable',
      nestedInstallerPath: 'app.exe',
    };

    expect(generateInstallCommand(installer)).toContain('Expand-Archive');
  });

  it('should describe copying a bare portable executable', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/claude.exe',
      sha256: 'abc123',
      type: 'portable',
    };

    expect(generateInstallCommand(installer)).toBe(
      'Copy-Item -Path "claude.exe" -Destination "%ProgramFiles%\\claude\\claude.exe" -Force'
    );
  });

  it('should describe extracting a portable zip archive', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/claude.zip',
      sha256: 'abc123',
      type: 'portable',
    };

    expect(generateInstallCommand(installer)).toContain(
      'Expand-Archive -Path "claude.zip" -DestinationPath "%ProgramFiles%\\claude"'
    );
  });

  it('should reject a nested path without a nested installer type', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.zip',
      sha256: 'abc123',
      type: 'zip',
      nestedInstallerPath: 'setup.exe',
    };

    expect(() => generateInstallCommand(installer)).toThrow(/no nested installer type/i);
  });

  it('should treat a whitespace-only nested path as an archive-only package', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.zip',
      sha256: 'abc123',
      type: 'zip',
      nestedInstallerPath: '   ',
    };

    expect(generateInstallCommand(installer)).toContain('Expand-Archive');
  });

  it('should reject an unsafe nested installer path', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.zip',
      sha256: 'abc123',
      type: 'zip',
      nestedInstallerType: 'exe',
      nestedInstallerPath: '..\\setup.exe',
    };

    expect(() => generateInstallCommand(installer)).toThrow(/unsafe nested installer path/i);
  });
});

describe('generateUninstallCommand', () => {
  it('should generate MSI uninstall command with product code', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/installer.msi',
      sha256: 'abc123',
      type: 'msi',
      productCode: '{12345678-1234-1234-1234-123456789012}',
    };

    const command = generateUninstallCommand(installer);

    expect(command).toContain('msiexec /x');
    expect(command).toContain('{12345678-1234-1234-1234-123456789012}');
    expect(command).toContain('/qn');
    expect(command).toContain('/norestart');
  });

  it('should resolve MSI uninstall registration without a product code', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/installer.msi',
      sha256: 'abc123',
      type: 'msi',
    };

    const command = generateUninstallCommand(installer, 'Codeless MSI App');

    expect(command).toBe('REGISTRY_UNINSTALL:Codeless MSI App');
    expect(command).not.toContain('{PRODUCT_CODE}');
  });

  it('should fail safely when MSI uninstall identity cannot be determined', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/installer.msi',
      sha256: 'abc123',
      type: 'msi',
    };

    expect(generateUninstallCommand(installer)).toBe(
      'MSI_UNINSTALL_IDENTITY_REQUIRED'
    );
  });

  it('should generate MSIX uninstall marker with package family name', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/installer.msix',
      sha256: 'abc123',
      type: 'msix',
      packageFamilyName: 'Microsoft.VSCode_8wekyb3d8bbwe',
    };

    const command = generateUninstallCommand(installer);

    expect(command).toContain('MSIX_UNINSTALL:');
    expect(command).toContain('Microsoft.VSCode');
  });

  it('should not guess an MSIX package identity from its display name', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/installer.msix',
      sha256: 'abc123',
      type: 'msix',
    };

    expect(generateUninstallCommand(installer, 'Windows Terminal')).toBe(
      'MSIX_UNINSTALL:{PACKAGE_NAME}'
    );
  });

  it('should generate registry uninstall command for EXE with display name', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.exe',
      sha256: 'abc123',
      type: 'exe',
    };

    const command = generateUninstallCommand(installer, 'Test Application');

    expect(command).toContain('REGISTRY_UNINSTALL:');
    expect(command).toContain('Test Application');
  });

  it('should preserve a Burn bundle product code in the registry uninstall marker', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/python.exe',
      sha256: 'abc123',
      type: 'burn',
      productCode: '{97b6de30-6082-48d1-9bb4-9f43296531a4}',
    };

    const command = generateUninstallCommand(installer, 'Python 3.14');

    expect(command).toBe(
      'REGISTRY_UNINSTALL_PRODUCT:{97B6DE30-6082-48D1-9BB4-9F43296531A4}:Python 3.14'
    );
  });

  it('should preserve an EXE wrapper product code in the registry uninstall marker', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/reader.exe',
      sha256: 'abc123',
      type: 'exe',
      productCode: '{AC76BA86-1033-FF00-7760-BC15014EA700}',
    };

    const command = generateUninstallCommand(
      installer,
      'Adobe Acrobat Reader (64-bit)'
    );

    expect(command).toBe(
      'REGISTRY_UNINSTALL_PRODUCT:{AC76BA86-1033-FF00-7760-BC15014EA700}:Adobe Acrobat Reader (64-bit)'
    );
  });

  it('should preserve a nested MSI product code for archive packages', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x86',
      url: 'https://example.com/bankid.zip',
      sha256: 'abc123',
      type: 'zip',
      nestedInstallerType: 'msi',
      nestedInstallerPath: 'BankID.msi',
      productCode: '{77B5BCDC-5496-48DA-8B16-5EE2AF08CA31}',
    };

    expect(
      generateUninstallCommand(installer, 'BankID säkerhetsprogram')
    ).toBe(
      'REGISTRY_UNINSTALL_PRODUCT:{77B5BCDC-5496-48DA-8B16-5EE2AF08CA31}:BankID säkerhetsprogram'
    );
  });

  it('should preserve a nested AppX package identity for archive packages', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/dependencies.zip',
      sha256: 'abc123',
      type: 'zip',
      nestedInstallerType: 'msix',
      nestedInstallerPath: 'Dependencies\\x64\\Microsoft.NET.Native.Runtime.2.2.appx',
      packageFamilyName: 'Microsoft.NET.Native.Runtime.2.2_8wekyb3d8bbwe',
    };

    expect(
      generateUninstallCommand(installer, 'Microsoft .NET Native Runtime')
    ).toBe('MSIX_UNINSTALL:Microsoft.NET.Native.Runtime.2.2');
  });

  it('should canonicalize a braceless product code and reject malformed GUID shapes', () => {
    const base: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.exe',
      sha256: 'abc123',
      type: 'exe',
    };

    expect(
      generateUninstallCommand(
        { ...base, productCode: 'ac76ba86-1033-ff00-7760-bc15014ea700' },
        'Reader'
      )
    ).toBe(
      'REGISTRY_UNINSTALL_PRODUCT:{AC76BA86-1033-FF00-7760-BC15014EA700}:Reader'
    );
    expect(
      generateUninstallCommand(
        { ...base, productCode: '{------------------------------------}' },
        'Reader'
      )
    ).toBe('REGISTRY_UNINSTALL:Reader');
  });

  it('should preserve a safe non-MSI ARP registry key as exact uninstall identity', () => {
    const base: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.exe',
      sha256: 'abc123',
      type: 'nullsoft',
    };

    expect(
      generateUninstallCommand(
        { ...base, productCode: 'IntelliJ IDEA 2025.2.5' },
        'IntelliJ IDEA Ultimate Edition'
      )
    ).toBe(
      'REGISTRY_UNINSTALL_KEY:IntelliJ IDEA 2025.2.5:IntelliJ IDEA Ultimate Edition'
    );
    expect(
      generateUninstallCommand(
        {
          ...base,
          type: 'inno',
          productCode: '{22222222-2222-2222-2222-222222222222}_is1',
        },
        'Inno App'
      )
    ).toBe(
      'REGISTRY_UNINSTALL_KEY:{22222222-2222-2222-2222-222222222222}_is1:Inno App'
    );
    expect(
      generateUninstallCommand(
        { ...base, productCode: 'Unsafe\\Key:Value' },
        'Unsafe App'
      )
    ).toBe('REGISTRY_UNINSTALL:Unsafe App');
  });

  it('should delegate Inno uninstall to registry lookup when display name is provided', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.exe',
      sha256: 'abc123',
      type: 'inno',
    };

    const command = generateUninstallCommand(installer, 'Inno App');

    expect(command).toContain('REGISTRY_UNINSTALL:');
    expect(command).toContain('Inno App');
  });

  it('should fall back to generic uninstall for EXE without display name', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.exe',
      sha256: 'abc123',
      type: 'exe',
    };

    const command = generateUninstallCommand(installer);

    expect(command).toBe('uninstall.exe /S');
  });

  it('should not emit an exact product marker without a usable display name', () => {
    const installer: NormalizedInstaller = {
      architecture: 'x64',
      url: 'https://example.com/app.exe',
      sha256: 'abc123',
      type: 'exe',
      productCode: '{AC76BA86-1033-FF00-7760-BC15014EA700}',
    };

    expect(generateUninstallCommand(installer, '   ')).toBe('# Manual uninstall required');
  });
});

describe('validateDetectionRules', () => {
  it('should return valid for proper MSI rule', () => {
    const rules = [
      {
        type: 'msi' as const,
        productCode: '{12345678-1234-1234-1234-123456789012}',
        productVersionOperator: 'greaterThanOrEqual' as const,
      },
    ];

    const result = validateDetectionRules(rules);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return invalid for MSI rule without product code', () => {
    const rules = [
      {
        type: 'msi' as const,
        productCode: '',
      },
    ];

    const result = validateDetectionRules(rules);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('MSI detection rule requires a product code');
  });

  it('should return valid for proper file rule', () => {
    const rules = [
      {
        type: 'file' as const,
        path: '%ProgramFiles%',
        fileOrFolderName: 'TestApp',
        detectionType: 'exists' as const,
      },
    ];

    const result = validateDetectionRules(rules);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return invalid for file rule without path', () => {
    const rules = [
      {
        type: 'file' as const,
        path: '',
        fileOrFolderName: 'TestApp',
        detectionType: 'exists' as const,
      },
    ];

    const result = validateDetectionRules(rules);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('File/folder detection rule requires path and file or folder name');
  });

  it('should return invalid for registry rule without key path', () => {
    const rules = [
      {
        type: 'registry' as const,
        keyPath: '',
        detectionType: 'exists' as const,
      },
    ];

    const result = validateDetectionRules(rules);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Registry detection rule requires key path');
  });

  it('should return invalid for script rule with short content', () => {
    const rules = [
      {
        type: 'script' as const,
        scriptContent: 'exit 0',
        enforceSignatureCheck: false,
      },
    ];

    const result = validateDetectionRules(rules);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Script detection rule requires valid script content');
  });

  it('should return invalid for empty rules array', () => {
    const result = validateDetectionRules([]);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('At least one detection rule is required');
  });

  it('should validate multiple rules and collect all errors', () => {
    const rules = [
      {
        type: 'msi' as const,
        productCode: '',
      },
      {
        type: 'file' as const,
        path: '',
        fileOrFolderName: '',
        detectionType: 'exists' as const,
      },
    ];

    const result = validateDetectionRules(rules);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
