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
import { resolveInstallerFileName } from '@/lib/installer-filename';
import { normalizeMarkerPath } from '@/lib/registry-marker';

/**
 * Generate detection rules based on installer metadata
 *
 * Strategy (in order of preference):
 * 1. Registry marker (IntuneGet) - when wingetId and version are provided. The
 *    PSADT install script writes this marker for EVERY installer type
 *    (including MSI), so it is the most reliable option across the board.
 *    MSI product codes from winget manifests are NOT used as the primary rule
 *    because many MSI apps change their product code every release, leaving
 *    the deployed detection rule stale (e.g. Chrome, PDF-XChange).
 * 2. MSI Product Code - fallback for MSI/WiX when wingetId/version are absent
 * 3. Folder existence - simple last resort (RoboPack approach)
 * 4. Script detection - for MSIX/APPX via Package Family Name
 *
 * @param installer - Normalized installer metadata
 * @param displayName - Application display name
 * @param wingetId - Optional Winget package ID for registry marker detection
 * @param version - Optional version for version comparison detection
 * @param markerPath - Optional custom registry marker root (psadtConfig.registryMarkerPath)
 */
export function generateDetectionRules(
  installer: NormalizedInstaller,
  displayName: string,
  wingetId?: string,
  version?: string,
  markerPath?: string
): DetectionRule[] {
  switch (installer.type) {
    case 'msi':
    case 'wix':
      // MSI: Prefer registry marker (product codes go stale across versions),
      // then product code, then folder detection
      return generateMsiDetectionRules(installer, displayName, wingetId, version, markerPath);

    case 'burn':
      // Burn bundles: Use registry marker if wingetId provided, otherwise folder detection
      if (wingetId && version) {
        return generateRegistryMarkerDetectionRules(wingetId, version, installer.scope, markerPath);
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
        return generateRegistryMarkerDetectionRules(wingetId, version, installer.scope, markerPath);
      }
      return generateFolderDetectionRules(installer, displayName);

    case 'portable':
    case 'zip':
      // Portable: Use registry marker if wingetId provided, otherwise folder existence
      if (wingetId && version) {
        return generateRegistryMarkerDetectionRules(wingetId, version, installer.scope, markerPath);
      }
      return generateFolderDetectionRules(installer, displayName);

    default:
      if (wingetId && version) {
        return generateRegistryMarkerDetectionRules(wingetId, version, installer.scope, markerPath);
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
 * The SOFTWARE\IntuneGet\Apps root is customizable per package via
 * psadtConfig.registryMarkerPath (issue #106)
 */
export function generateRegistryMarkerDetectionRules(
  wingetId: string,
  version: string,
  scope?: WingetScope,
  markerPath?: string
): DetectionRule[] {
  // Sanitize wingetId: replace . and - with _ to create valid registry key name
  const sanitizedId = wingetId.replace(/[\.\-]/g, '_');

  // Use HKCU for user scope, HKLM for machine scope (default)
  const hive = scope === 'user' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';

  // Intune's strict registry `version` operation is only appropriate for
  // System.Version-compatible values. WinGet also permits opaque versions
  // such as `0.0.1786233956-g40887a`; treating those as versions makes an
  // otherwise correctly installed marker fail detection. Use exact string
  // comparison for opaque values because the marker is generated per release.
  const versionParts = /^\d+(?:\.\d+){1,3}$/.test(version) ? version.split('.') : [];
  const useVersionComparison =
    versionParts.length >= 2 &&
    versionParts.length <= 4 &&
    versionParts.every((part) => Number(part) <= 2_147_483_647);

  return [
    {
      type: 'registry',
      keyPath: `${hive}\\${normalizeMarkerPath(markerPath)}\\${sanitizedId}`,
      valueName: 'Version',
      check32BitOn64System: false,
      detectionType: useVersionComparison ? 'version' : 'string',
      operator: useVersionComparison ? 'greaterThanOrEqual' : 'equal',
      detectionValue: version,
    } as RegistryDetectionRule,
  ];
}

/**
 * Generate MSI-based detection rules
 *
 * Prefers the IntuneGet registry marker over the MSI Product Code because
 * product codes synced from winget manifests go stale - many MSI apps change
 * their product code every release, so the deployed code no longer matches
 * the installed one after an update. The PSADT install script writes the
 * marker for all installer types including MSI.
 */
function generateMsiDetectionRules(
  installer: NormalizedInstaller,
  displayName: string,
  wingetId?: string,
  version?: string,
  markerPath?: string
): DetectionRule[] {
  // Primary: Registry marker detection (version-stable, written by PSADT)
  if (wingetId && version) {
    return generateRegistryMarkerDetectionRules(wingetId, version, installer.scope, markerPath);
  }

  // Fallback: MSI Product Code detection
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
        scriptContent: generateMsixDetectionScript(
          installer.packageFamilyName,
          installer.scope
        ),
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
function generateMsixDetectionScript(
  packageFamilyName: string,
  scope?: WingetScope
): string {
  // Extract the package name (before the underscore in family name)
  const packageName = packageFamilyName.split('_')[0];
  const packageLookup =
    scope === 'user'
      ? [
          `$package = Get-AppxPackage -Name "${packageName}"`,
          '$runningAsSystem = [Security.Principal.WindowsIdentity]::GetCurrent().IsSystem',
          `if (-not $package -and $runningAsSystem) { $package = Get-AppxPackage -Name "${packageName}" -AllUsers }`,
        ].join('\n')
      : `$package = Get-AppxPackage -Name "${packageName}" -AllUsers`;

  const lines = [
    '# MSIX Detection Script',
    `# Package Family Name: ${packageFamilyName}`,
    '',
    '$ErrorActionPreference = "SilentlyContinue"',
    packageLookup,
    ...(scope === 'user'
      ? []
      : [
          `if (-not $package) { $package = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq "${packageName}" } }`,
        ]),
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
  const installerName = resolveInstallerFileName(installer.url, installer.type);
  const effectiveType = installer.type === 'zip' && installer.nestedInstallerType
    ? installer.nestedInstallerType
    : installer.type;
  const silentArgs = installer.silentArgs || getDefaultSilentArgs(effectiveType);

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
      const declaredNestedPath = installer.nestedInstallerPath?.trim();
      if (declaredNestedPath) {
        const nestedPath = declaredNestedPath.replace(/\//g, '\\');
        if (!installer.nestedInstallerType) {
          throw new Error('Zip package declares a nested installer path but no nested installer type');
        }
        if (
          /^[\\/]/.test(nestedPath) ||
          /^[A-Za-z]:/.test(nestedPath) ||
          nestedPath.split('\\').includes('..') ||
          /[\x00-\x1f]/.test(nestedPath)
        ) {
          throw new Error(`Unsafe nested installer path: ${installer.nestedInstallerPath}`);
        }

        switch (installer.nestedInstallerType) {
          case 'msi':
          case 'wix': {
            const nestedMsiScope = scope === 'user' ? 'ALLUSERS=""' : 'ALLUSERS=1';
            return `msiexec /i "${nestedPath}" ${silentArgs} ${nestedMsiScope}`.trim();
          }
          case 'msix':
          case 'appx':
            return `Add-AppxPackage -Path "${nestedPath}"`;
          case 'portable':
            return `Expand-Archive -Path "${installerName}" -DestinationPath "%ProgramFiles%\\${installerName.replace(/\.[^/.]+$/, '')}" -Force`;
          default:
            return `"${nestedPath}" ${silentArgs}`.trim();
        }
      }
      return `Expand-Archive -Path "${installerName}" -DestinationPath "%ProgramFiles%\\${installerName.replace(/\.[^/.]+$/, '')}" -Force`;

    case 'portable': {
      const portableFolder = installerName.replace(/\.[^/.]+$/, '');
      if (/\.zip$/i.test(installerName)) {
        return `Expand-Archive -Path "${installerName}" -DestinationPath "%ProgramFiles%\\${portableFolder}" -Force`;
      }
      return `Copy-Item -Path "${installerName}" -Destination "%ProgramFiles%\\${portableFolder}\\${installerName}" -Force`;
    }

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
      // Some manifests omit ProductCode even though Windows Installer creates
      // an authoritative uninstall registration at install time. Resolve that
      // registration after installation instead of emitting a literal GUID
      // placeholder that msiexec will reject with exit code 1619.
      if (displayName) {
        return generateRegistryUninstallCommand(displayName);
      }
      return 'MSI_UNINSTALL_IDENTITY_REQUIRED';

    case 'msix':
    case 'appx':
      // Return marker for MSIX/APPX uninstall - handled specially in PSADT workflow
      if (installer.packageFamilyName) {
        return `MSIX_UNINSTALL:${installer.packageFamilyName.split('_')[0]}`;
      }
      // A display name is not an AppX package identity. Keep the marker
      // intentionally invalid so both packagers reject it before deployment.
      return 'MSIX_UNINSTALL:{PACKAGE_NAME}';

    case 'exe':
    case 'inno':
    case 'nullsoft':
    case 'burn':
      // Use registry-based uninstall lookup for EXE installers
      // This finds the actual UninstallString from the registry and executes it
      if (displayName) {
        return generateRegistryUninstallCommand(
          displayName,
          installer.productCode
        );
      }
      // Fallback to generic commands (less reliable)
      if (installer.type === 'inno') {
        return 'unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART';
      }
      return 'uninstall.exe /S';

    default:
      if (displayName) {
        return generateRegistryUninstallCommand(displayName);
      }
      return '# Manual uninstall required';
  }
}

/**
 * Generate a registry-based uninstall command
 *
 * Returns a marker that tells Create-PSADTPackage.ps1 to use
 * Uninstall-ADTApplication with the display name. PSADT handles
 * registry lookup, MSI vs EXE detection, and silent switches
 * automatically via the app's registered QuietUninstallString.
 */
function generateRegistryUninstallCommand(
  displayName: string,
  productCode?: string
): string {
  const normalizedDisplayName = displayName.trim();
  if (!normalizedDisplayName) {
    return '# Manual uninstall required';
  }
  // EXE-family installers can wrap MSI products or register bundles whose ARP
  // name differs from the catalog display name. A manifest ProductCode or
  // AppsAndFeatures ProductCode is the authoritative uninstall identity, so
  // preserve it for every EXE-family installer instead of falling back to a
  // human-readable name that may be normalized or localized differently.
  const productCodeMatch = productCode?.trim().match(
    /^\{?([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}?$/
  );
  if (productCodeMatch) {
    const canonicalProductCode = `{${productCodeMatch[1].toUpperCase()}}`;
    return `REGISTRY_UNINSTALL_PRODUCT:${canonicalProductCode}:${normalizedDisplayName}`;
  }
  return `REGISTRY_UNINSTALL:${normalizedDisplayName}`;
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
    inno: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
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
