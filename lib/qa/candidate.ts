export interface WingetInstallerCandidate {
  Architecture?: string;
  InstallerUrl?: string;
  InstallerSha256?: string;
  InstallerType?: string;
  NestedInstallerType?: string;
  NestedInstallerFiles?: Array<{ RelativeFilePath?: string }>;
  Scope?: string;
  ProductCode?: string;
  PackageFamilyName?: string;
  InstallerSwitches?: Record<string, unknown>;
  AppsAndFeaturesEntries?: Array<{ ProductCode?: string }>;
}

export interface QaInstallerSelection {
  installer: WingetInstallerCandidate;
  architecture: 'x64' | 'x86';
}

const SUPPORTED_ARCHITECTURES = new Set(['x64', 'x86', 'arm64']);

export function normalizeQaArchitecture(value?: string | null): 'x64' | 'x86' | 'arm64' {
  const normalized = value?.trim().toLowerCase();
  return SUPPORTED_ARCHITECTURES.has(normalized || '')
    ? (normalized as 'x64' | 'x86' | 'arm64')
    : 'x64';
}

/** Select the exact architecture requested by a deployment or QA recipe. */
export function selectWingetInstaller(
  installers: WingetInstallerCandidate[] | null | undefined,
  architecture?: string | null
): WingetInstallerCandidate | null {
  if (!installers?.length) return null;
  const target = normalizeQaArchitecture(architecture);
  return (
    installers.find((installer) => installer.Architecture?.toLowerCase() === target) ||
    installers.find((installer) => installer.Architecture?.toLowerCase() === 'neutral') ||
    null
  );
}

/** Select an installer executable by the x64 QA VM (x64/neutral first, then x86). */
export function selectQaVmInstaller(
  installers: WingetInstallerCandidate[] | null | undefined
): QaInstallerSelection | null {
  if (!installers?.length) return null;
  const x64 = installers.find((installer) => installer.Architecture?.toLowerCase() === 'x64');
  if (x64) return { installer: x64, architecture: 'x64' };
  const neutral = installers.find(
    (installer) => installer.Architecture?.toLowerCase() === 'neutral'
  );
  if (neutral) return { installer: neutral, architecture: 'x64' };
  const x86 = installers.find((installer) => installer.Architecture?.toLowerCase() === 'x86');
  return x86 ? { installer: x86, architecture: 'x86' } : null;
}

export function normalizeInstallerSha256(value?: string | null): string {
  const normalized = value?.trim().toUpperCase() || '';
  return /^[A-F0-9]{64}$/.test(normalized) ? normalized : '';
}

export function normalizeQaInstallerType(
  wingetType?: string | null,
  recipeType: string = 'exe'
): 'exe' | 'msi' | 'msix' | 'appx' | 'zip' {
  const normalized = wingetType?.trim().toLowerCase();
  if (normalized === 'wix' || normalized === 'msi') return 'msi';
  if (['inno', 'nullsoft', 'burn', 'exe'].includes(normalized || '')) return 'exe';
  if (normalized === 'msix') return 'msix';
  if (normalized === 'appx') return 'appx';
  if (normalized === 'zip') return 'zip';
  const fallback = recipeType.trim().toLowerCase();
  return ['exe', 'msi', 'msix', 'appx', 'zip'].includes(fallback)
    ? (fallback as 'exe' | 'msi' | 'msix' | 'appx' | 'zip')
    : 'exe';
}

export function qaInstallerFileName(installerUrl: string, installerType: string): string {
  try {
    const decoded = decodeURIComponent(new URL(installerUrl).pathname.split('/').pop() || '');
    if (decoded && !/[\\/:*?"<>|]/.test(decoded)) return decoded;
  } catch {
    // Use a deterministic safe fallback below.
  }
  return `installer.${normalizeQaInstallerType(installerType)}`;
}
