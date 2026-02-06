/**
 * Detection Rule Engine
 * Auto-generates Intune detection rules based on installer type
 *
 * Uses simple folder existence detection
 * Example: %ProgramFiles%\Git - just check if the folder exists
 */

import type {
  DetectionRule,
  FileDetectionRule,
  MsiDetectionRule,
  RegistryDetectionRule,
  ScriptDetectionRule,
} from '@/types/intune';
import type { NormalizedInstaller, WingetInstallerType, WingetScope } from '@/types/winget';

/**
 * Generate detection rules based on installer metadata
 *
 * Strategy (in order of preference):
 * 1. MSI Product Code - most reliable for MSI installers
 * 2. Registry marker (IntuneGet) - for EXE/Inno/Nullsoft when wingetId is provided
 * 3. Folder existence - simple and reliable (RoboPack approach)
 * 4. Script detection - fallback for MSIX/complex cases
 *
 * @param installer - Normalized installer metadata
 * @param displayName - Application display name
 * @param wingetId - Optional Winget package ID for registry marker detection
 * @param version - Optional version for version comparison detection
 */
export function generateDetectionRules(
  installer: NormalizedInstaller,
  displayName: string,
  wingetId?: string,
  version?: string
): DetectionRule[] {
  switch (installer.type) {
    case 'msi':
    case 'wix':
      // MSI: Use product code if available, otherwise folder detection
      return generateMsiDetectionRules(installer, displayName);

    case 'burn':
      // Burn bundles: Use registry marker if wingetId provided, otherwise folder detection
      if (wingetId && version) {
        return generateRegistryMarkerDetectionRules(wingetId, version, installer.scope);
      }
      return generateFolderDetectionRules(installer, displayName);

    case 'msix':
    case 'appx':
      // MSIX: Must use script detection with Package Family Name
      return generateMsixDetectionRules(installer, displayName);

    case 'exe':
    case 'inno':
    case 'nullsoft':
      // Use PSADT registry marker - more reliable than uninstall registry search
      if (wingetId && version) {
        return generateRegistryMarkerDetectionRules(wingetId, version, installer.scope);
      }
      return generateFolderDetectionRules(installer, displayName);

    case 'portable':
    case 'zip':
      // Portable: Use registry marker if wingetId provided, otherwise folder existence
      if (wingetId && version) {
        return generateRegistryMarkerDetectionRules(wingetId, version, installer.scope);
      }
      return generateFolderDetectionRules(installer, displayName);

    default:
      if (wingetId && version) {
        return generateRegistryMarkerDetectionRules(wingetId, version, installer.scope);
      }
      return generateFolderDetectionRules(installer, displayName);
  }
}

/**
 * Generate registry marker detection rules
 * Uses IntuneGet's custom registry marker written by PSADT during installation
 *
 * This provides 100% reliable detection because:
 * - We control exactly what's written to the registry
 * - Works regardless of where the app actually installs
 * - Supports version comparison for upgrade detection
 * - Marker is removed on uninstall
 *
 * Registry path: HKLM:\SOFTWARE\IntuneGet\Apps\{WingetId_sanitized}
 * For user scope: HKCU:\SOFTWARE\IntuneGet\Apps\{WingetId_sanitized}
 */
function generateRegistryMarkerDetectionRules(
  wingetId: string,
  version: string,
  scope?: WingetScope
): DetectionRule[] {
  // Sanitize wingetId: replace . and - with _ to create valid registry key name
  const sanitizedId = wingetId.replace(/[\.\-]/g, '_');

  // Use HKCU for user scope, HKLM for machine scope (default)
  const hive = scope === 'user' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';

  return [
    {
      type: 'registry',
      keyPath: `${hive}\\SOFTWARE\\IntuneGet\\Apps\\${sanitizedId}`,
      valueName: 'Version',
      check32BitOn64System: false,
      detectionType: 'version',
      operator: 'greaterThanOrEqual',
      detectionValue: version,
    } as RegistryDetectionRule,
  ];
}

/**
 * Generate MSI-based detection rules
 * Uses MSI Product Code when available (most reliable)
 */
function generateMsiDetectionRules(
  installer: NormalizedInstaller,
  displayName: string
): DetectionRule[] {
  // Primary: MSI Product Code detection (most reliable)
  if (installer.productCode) {
    return [
      {
        type: 'msi',
        productCode: installer.productCode,
        productVersionOperator: 'greaterThanOrEqual',
      } as MsiDetectionRule,
    ];
  }

  // Fallback: Folder existence detection
  return generateFolderDetectionRules(installer, displayName);
}

/**
 * Generate MSIX/APPX detection rules
 * MSIX apps require script-based detection using Package Family Name
 */
function generateMsixDetectionRules(
  installer: NormalizedInstaller,
  displayName: string
): DetectionRule[] {
  if (installer.packageFamilyName) {
    return [
      {
        type: 'script',
        scriptContent: generateMsixDetectionScript(installer.packageFamilyName),
        enforceSignatureCheck: false,
        runAs32Bit: false,
      } as ScriptDetectionRule,
    ];
  }

  // Fallback: folder detection
  return generateFolderDetectionRules(installer, displayName);
}

/**
 * Generate folder existence detection rules (RoboPack approach)
 * Simple and reliable: just check if %ProgramFiles%\AppName exists
 */
function generateFolderDetectionRules(
  installer: NormalizedInstaller,
  displayName: string
): DetectionRule[] {
  const folderName = inferFolderName(displayName);
  const basePath = getBasePath(installer.scope, installer.architecture);

  return [
    {
      type: 'file',
      path: basePath,
      fileOrFolderName: folderName,
      detectionType: 'exists',
      check32BitOn64System: installer.architecture === 'x86',
    } as FileDetectionRule,
  ];
}

/**
 * Infer the installation folder name from display name
 *
 * Examples:
 * - "Git" -> "Git"
 * - "Visual Studio Code" -> "Microsoft VS Code" (common alias, but we use display name)
 * - "7-Zip" -> "7-Zip"
 *
 * Most apps use their display name or a simplified version as folder name
 */
function inferFolderName(displayName: string): string {
  // Keep the original name but remove characters that are invalid for folder names
  // Valid folder name characters: letters, numbers, spaces, hyphens, underscores, periods
  let folderName = displayName.replace(/[<>:"/\\|?*]/g, '').trim();

  // If the name is too long, truncate it (Windows path limit considerations)
  if (folderName.length > 64) {
    folderName = folderName.substring(0, 64).trim();
  }

  return folderName || 'Application';
}

/**
 * Get the base installation path based on scope and architecture
 */
function getBasePath(scope?: WingetScope, architecture?: string): string {
  if (scope === 'user') {
    return '%LOCALAPPDATA%\\Programs';
  }

  // For machine scope, check architecture
  if (architecture === 'x86') {
    return '%ProgramFiles(x86)%';
  }

  return '%ProgramFiles%';
}

/**
 * Generate MSIX detection script
 * MSIX apps are detected via Get-AppxPackage
 */
function generateMsixDetectionScript(packageFamilyName: string): string {
  // Extract the package name (before the underscore in family name)
  const packageName = packageFamilyName.split('_')[0];

  const lines = [
    '# MSIX Detection Script',
    `# Package Family Name: ${packageFamilyName}`,
    '',
    '$ErrorActionPreference = "SilentlyContinue"',
    `$package = Get-AppxPackage -Name "*${packageName}*" -AllUsers`,
    'if ($package) {',
    '    Write-Output "Installed"',
    '    exit 0',
    '}',
    'exit 1',
  ];

  return lines.join('\n');
}

/**
 * Generate install command based on installer type
 */
export function generateInstallCommand(
  installer: NormalizedInstaller,
  scope: WingetScope = 'machine'
): string {
  const installerName = getInstallerFileName(installer.url);
  const silentArgs = installer.silentArgs || getDefaultSilentArgs(installer.type);

  switch (installer.type) {
    case 'msi':
    case 'wix':
      const msiScope = scope === 'user' ? 'ALLUSERS=""' : 'ALLUSERS=1';
      return `msiexec /i "${installerName}" /qn ${msiScope} /norestart`;

    case 'msix':
    case 'appx':
      return `Add-AppxPackage -Path "${installerName}"`;

    case 'exe':
    case 'inno':
    case 'nullsoft':
    case 'burn':
      return `"${installerName}" ${silentArgs}`.trim();

    case 'zip':
    case 'portable':
      return `Expand-Archive -Path "${installerName}" -DestinationPath "%ProgramFiles%\\${installerName.replace(/\.[^/.]+$/, '')}" -Force`;

    default:
      return `"${installerName}" ${silentArgs}`.trim();
  }
}

/**
 * Generate uninstall command based on installer type
 *
 * For EXE/Inno/Nullsoft installers, we generate a registry-based lookup command
 * because the generic commands (uninstall.exe /S) don't work - the uninstaller
 * is located in the app's install directory, not the current working directory.
 *
 * @param installer - Normalized installer metadata
 * @param displayName - Application display name for registry lookup
 */
export function generateUninstallCommand(
  installer: NormalizedInstaller,
  displayName?: string
): string {
  switch (installer.type) {
    case 'msi':
    case 'wix':
      if (installer.productCode) {
        return `msiexec /x "${installer.productCode}" /qn /norestart`;
      }
      return 'msiexec /x {PRODUCT_CODE} /qn /norestart';

    case 'msix':
    case 'appx':
      // Return marker for MSIX/APPX uninstall - handled specially in PSADT workflow
      if (installer.packageFamilyName) {
        return `MSIX_UNINSTALL:${installer.packageFamilyName.split('_')[0]}`;
      }
      // Fallback using display name
      if (displayName) {
        return `MSIX_UNINSTALL:${displayName}`;
      }
      return 'MSIX_UNINSTALL:{PACKAGE_NAME}';

    case 'exe':
    case 'inno':
    case 'nullsoft':
    case 'burn':
      // Use registry-based uninstall lookup for EXE installers
      // This finds the actual UninstallString from the registry and executes it
      if (displayName) {
        return generateRegistryUninstallCommand(displayName, installer.type);
      }
      // Fallback to generic commands (less reliable)
      if (installer.type === 'inno') {
        return 'unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART';
      }
      return 'uninstall.exe /S';

    default:
      if (displayName) {
        return generateRegistryUninstallCommand(displayName, 'exe');
      }
      return '# Manual uninstall required';
  }
}

/**
 * Generate a registry-based uninstall command
 *
 * This searches the Windows registry for the app's UninstallString and executes it.
 * Much more reliable than hardcoded paths because:
 * - Works regardless of where the app was installed
 * - Uses the app's actual uninstaller
 * - Handles version-specific install paths
 */
function generateRegistryUninstallCommand(
  displayName: string,
  installerType: string
): string {
  // Determine silent switches based on installer type
  let silentSwitch: string;
  switch (installerType) {
    case 'inno':
      silentSwitch = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART';
      break;
    case 'nullsoft':
      silentSwitch = '/S';
      break;
    case 'burn':
      silentSwitch = '/quiet /norestart';
      break;
    default:
      silentSwitch = '/S';
  }

  // Return the display name as a marker - the actual uninstall script
  // is generated in the PSADT workflow with full PowerShell logic
  return `REGISTRY_UNINSTALL:${displayName}:${silentSwitch}`;
}

/**
 * Get installer filename from URL
 */
function getInstallerFileName(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    return pathname.split('/').pop() || 'installer.exe';
  } catch {
    return 'installer.exe';
  }
}

/**
 * Get default silent arguments based on installer type
 */
function getDefaultSilentArgs(type: WingetInstallerType): string {
  const defaults: Record<WingetInstallerType, string> = {
    msi: '/qn /norestart',
    msix: '',
    appx: '',
    exe: '/S',
    inno: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
    nullsoft: '/S',
    wix: '/qn /norestart',
    burn: '/quiet /norestart',
    zip: '',
    pwa: '',
    portable: '',
  };

  return defaults[type] || '';
}

/**
 * Validate detection rules
 */
export function validateDetectionRules(rules: DetectionRule[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (rules.length === 0) {
    errors.push('At least one detection rule is required');
  }

  for (const rule of rules) {
    switch (rule.type) {
      case 'msi':
        if (!(rule as MsiDetectionRule).productCode) {
          errors.push('MSI detection rule requires a product code');
        }
        break;

      case 'file':
        const fileRule = rule as FileDetectionRule;
        if (!fileRule.path || !fileRule.fileOrFolderName) {
          errors.push('File/folder detection rule requires path and file or folder name');
        }
        break;

      case 'registry':
        const regRule = rule as RegistryDetectionRule;
        if (!regRule.keyPath) {
          errors.push('Registry detection rule requires key path');
        }
        break;

      case 'script':
        const scriptRule = rule as ScriptDetectionRule;
        if (!scriptRule.scriptContent || scriptRule.scriptContent.length < 10) {
          errors.push('Script detection rule requires valid script content');
        }
        break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
