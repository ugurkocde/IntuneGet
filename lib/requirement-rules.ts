/**
 * Requirement Rule Generator
 * Generates Intune requirement rules that check for app EXISTENCE on the device.
 *
 * Used by the "Update Only" assignment mode: the app is assigned as "required"
 * but with a requirement rule that gates installation to devices where the app
 * is already present. Intune evaluates: requirement met (app exists) AND
 * detection not met (new version not installed) = proceed with install (update).
 *
 * IMPORTANT: These rules detect the app using standard Windows methods
 * (uninstall registry, file paths), NOT the IntuneGet registry marker.
 * The IntuneGet marker only exists after IntuneGet deploys an app -- it would
 * NOT exist on devices where the app was discovered/installed natively.
 */

import type {
  RequirementRule,
  RegistryRequirementRule,
  ScriptRequirementRule,
} from '@/types/intune';
import type { WingetInstallerType, WingetScope } from '@/types/winget';
import type { PackageAssignment } from '@/types/upload';

export function buildCartItemRequirementRules(
  displayName: string,
  installerType: WingetInstallerType,
  productCode: string | undefined,
  assignments: PackageAssignment[] | undefined
): RequirementRule[] | undefined {
  if (!assignments?.some((assignment) => assignment.intent === 'updateOnly')) {
    return undefined;
  }

  return generateRequirementRules(displayName, installerType, productCode);
}

/**
 * Generate requirement rules that check whether the app is already installed.
 *
 * Strategy:
 * - MSI apps with a known product code: use a registry rule checking the
 *   product code's uninstall key directly (most precise).
 * - All other apps: use a PowerShell script that searches the Windows
 *   uninstall registry by display name (universal).
 */
export function generateRequirementRules(
  displayName: string,
  installerType: WingetInstallerType,
  productCode?: string,
  _packageFamilyName?: string,
  _scope?: WingetScope
): RequirementRule[] {
  // MSI-specific optimization: check the product code's uninstall key directly
  if ((installerType === 'msi' || installerType === 'wix') && productCode) {
    return [generateMsiRegistryRequirementRule(productCode)];
  }

  // Universal fallback: PowerShell script searching uninstall registry by name
  return [generateUninstallRegistryScriptRule(displayName)];
}

/**
 * Generate a registry requirement rule for MSI apps.
 * Checks if the MSI product code exists in the uninstall registry.
 */
function generateMsiRegistryRequirementRule(
  productCode: string
): RegistryRequirementRule {
  return {
    '@odata.type': '#microsoft.graph.win32LobAppRegistryRule',
    ruleType: 'requirement',
    keyPath: `HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${productCode}`,
    check32BitOn64System: false,
    operationType: 'exists',
  };
}

/**
 * Generate a PowerShell script requirement rule that searches the Windows
 * uninstall registry for the app by display name.
 *
 * Searches:
 * - HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*
 * - HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*
 * - HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*
 *
 * Returns $true if the app is found (any version), $false otherwise.
 */
function generateUninstallRegistryScriptRule(
  displayName: string
): ScriptRequirementRule {
  // Escape single quotes in display name for PowerShell string
  const escapedName = displayName.replace(/'/g, "''");

  const scriptLines = [
    '# Requirement rule: Check if app is already installed on this device',
    `# App: ${displayName}`,
    '$ErrorActionPreference = "SilentlyContinue"',
    '',
    '$uninstallPaths = @(',
    '    "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
    '    "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
    '    "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"',
    ')',
    '',
    'foreach ($path in $uninstallPaths) {',
    '    $apps = Get-ItemProperty $path -ErrorAction SilentlyContinue |',
    `        Where-Object { $_.DisplayName -like '*${escapedName}*' }`,
    '    if ($apps) {',
    '        Write-Output "True"',
    '        exit 0',
    '    }',
    '}',
    '',
    'Write-Output "False"',
    'exit 0',
  ];

  const scriptContent = scriptLines.join('\r\n');
  const base64Script = Buffer.from(scriptContent, 'utf-8').toString('base64');

  return {
    '@odata.type': '#microsoft.graph.win32LobAppPowerShellScriptRule',
    ruleType: 'requirement',
    displayName: `Check if ${displayName} is installed`,
    scriptContent: base64Script,
    enforceSignatureCheck: false,
    runAs32Bit: false,
    runAsAccount: 'system',
    operationType: 'boolean',
    operator: 'equal',
    comparisonValue: 'True',
  };
}
