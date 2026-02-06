/**
 * Silent Switches Extraction
 * Shared module for extracting silent install switches from install commands
 */

/**
 * Extract silent switches from the install command
 */
export function extractSilentSwitches(installCommand: string, installerType: string): string {
  // Common silent switches by installer type
  const defaultSwitches: Record<string, string> = {
    msi: '/qn /norestart',
    exe: '/S',
    inno: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
    nullsoft: '/S',
    wix: '/qn /norestart',
    burn: '/q /norestart',
    msix: '', // MSIX doesn't need switches
  };

  // Strip executable path first (handles paths with hyphens like "7z2501-x64.exe")
  // This removes everything up to and including common installer extensions
  let cleaned = installCommand
    .replace(/^"[^"]+"\s*/, '') // Remove quoted paths like "C:\path\installer.exe"
    .replace(/^\S+\.(exe|msi|msix|appx)\s*/i, ''); // Remove unquoted paths ending in installer extensions

  // Strip msiexec action switches and their targets:
  // /i filename.msi, /x {GUID}, /p patch.msp, etc.
  cleaned = cleaned
    .replace(/\/[ixp]\s+"[^"]+"\s*/gi, '') // /i "quoted path.msi"
    .replace(/\/[ixp]\s+\{[^}]+\}\s*/gi, '') // /x {GUID}
    .replace(/\/[ixp]\s+\S+\.(msi|msp)\s*/gi, '') // /i filename.msi
    .replace(/\/[ixp]\s+/gi, ''); // /i alone (leftover)

  // Extract switches from remaining string (starts with / or -)
  const switchMatch = cleaned.match(/(?:\/\S+|-{1,2}\S+)(?:\s+(?:\/\S+|-{1,2}\S+))*/);
  if (switchMatch && switchMatch[0] !== '-DeploymentType') {
    return switchMatch[0];
  }

  return defaultSwitches[installerType] || '/S';
}
