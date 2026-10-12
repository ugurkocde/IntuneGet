/**
 * Silent Switches Extraction
 * Shared module for extracting silent install switches from install commands
 */

/**
 * Extract silent switches from the install command
 */
export function extractSilentSwitches(
  installCommand: string,
  installerType: string,
  nestedInstallerType?: string
): string {
  // Common silent switches by installer type
  const defaultSwitches: Record<string, string> = {
    msi: '/qn /norestart',
    exe: '',
    inno: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
    nullsoft: '/S',
    wix: '/qn /norestart',
    burn: '/q /norestart',
    msix: '', // MSIX doesn't need switches
  };

  const sourceType = installerType.toLowerCase();
  const effectiveType = sourceType === 'zip' && nestedInstallerType
    ? nestedInstallerType.toLowerCase()
    : sourceType;

  // Archive extraction parameters are not vendor silent switches. Never pass
  // values such as "-Archive -Path" to a nested executable.
  if (/\bExpand-Archive\b/i.test(installCommand)) {
    return defaultSwitches[effectiveType] ?? '';
  }

  // Strip executable path first (handles paths with hyphens like "7z2501-x64.exe")
  // This removes everything up to and including common installer extensions
  let cleaned = installCommand
    .replace(/^msiexec(?:\.exe)?\s+/i, '') // Remove Windows Installer launcher with or without .exe
    .replace(/^"[^"]+"\s*/, '') // Remove quoted paths like "C:\path\installer.exe"
    .replace(/^\S+\.(exe|msi|msix|appx)\s*/i, ''); // Remove unquoted paths ending in installer extensions

  // Strip msiexec action switches and their targets:
  // /i filename.msi, /x {GUID}, /p patch.msp, etc.
  cleaned = cleaned
    .replace(/\/[ixp]\s+"[^"]+"\s*/gi, '') // /i "quoted path.msi"
    .replace(/\/[ixp]\s+\{[^}]+\}\s*/gi, '') // /x {GUID}
    .replace(/\/[ixp]\s+\S+\.(msi|msp)\s*/gi, '') // /i filename.msi
    .replace(/\/[ixp]\s+/gi, ''); // /i alone (leftover)

  // Preserve the complete vendor argument tail, including positional operands.
  // Commands such as Office Deployment Tool's
  //   /configure https://aka.ms/fhlwingetconfig
  // are incomplete (and silently do nothing) if we retain only slash-prefixed
  // tokens. The executable token and MSI action target were removed above, so
  // everything remaining belongs to the vendor's install contract.
  cleaned = cleaned.trim();
  const beginsWithVendorSwitch = /^(?:\/\S+|-{1,2}\S+)/.test(cleaned);
  const beginsWithMsiProperty = /^[A-Za-z_][A-Za-z0-9_.-]*=(?:"[^"]*"|\S+)(?:\s|$)/.test(cleaned);
  if (
    (beginsWithVendorSwitch && cleaned !== '-DeploymentType') ||
    (['msi', 'wix'].includes(effectiveType) && beginsWithMsiProperty)
  ) {
    return cleaned;
  }

  return defaultSwitches[effectiveType] ?? '';
}
