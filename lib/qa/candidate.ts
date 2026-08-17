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
  InstallerSwitches?: {
    Silent?: string;
    SilentWithProgress?: string;
    Interactive?: string;
    InstallLocation?: string;
    Log?: string;
    Upgrade?: string;
    Custom?: string;
  };
  InstallLocationRequired?: boolean;
  DefaultInstallLocation?: string;
  AppsAndFeaturesEntries?: Array<{ ProductCode?: string }>;
}

export interface QaInstallerSelection {
  installer: WingetInstallerCandidate;
  architecture: 'x64' | 'x86';
}

const SUPPORTED_ARCHITECTURES = new Set(['x64', 'x86', 'arm64']);
const QA_RUNNER_ARCHITECTURES = new Set(['x64', 'x86']);

/** The current Hyper-V golden image is x64 and can execute x64/x86 payloads only. */
export function isQaRunnerArchitectureSupported(value?: string | null): boolean {
  return QA_RUNNER_ARCHITECTURES.has(value?.trim().toLowerCase() || 'x64');
}

function preferredScopeInstaller(
  installers: WingetInstallerCandidate[],
  requestedScope?: 'machine' | 'user'
): WingetInstallerCandidate | null {
  const preferEnterpriseMachineInstaller = (
    candidates: WingetInstallerCandidate[],
    machineScope: boolean,
  ): WingetInstallerCandidate | null => {
    if (!machineScope) return candidates[0] || null;

    const enterpriseInstaller = candidates.find((installer) => {
      const sourceType = installer.InstallerType?.trim().toLowerCase();
      const effectiveType = sourceType === 'zip'
        ? installer.NestedInstallerType?.trim().toLowerCase()
        : sourceType;
      return effectiveType === 'msi' || effectiveType === 'wix';
    });
    return enterpriseInstaller || candidates[0] || null;
  };

  if (requestedScope) {
    const exactScope = installers.filter(
      (installer) => installer.Scope?.trim().toLowerCase() === requestedScope
    );
    if (exactScope.length > 0) {
      return preferEnterpriseMachineInstaller(exactScope, requestedScope === 'machine');
    }

    const unspecifiedScope = installers.filter((installer) => !installer.Scope?.trim());
    return preferEnterpriseMachineInstaller(
      unspecifiedScope,
      requestedScope === 'machine',
    );
  }

  const machineScope = installers.filter(
    (installer) => installer.Scope?.trim().toLowerCase() === 'machine'
  );
  if (machineScope.length > 0) {
    return preferEnterpriseMachineInstaller(machineScope, true);
  }

  const unspecifiedScope = installers.filter((installer) => !installer.Scope?.trim());
  if (unspecifiedScope.length > 0) {
    return preferEnterpriseMachineInstaller(unspecifiedScope, true);
  }

  return installers.find(
    (installer) => installer.Scope?.trim().toLowerCase() === 'user'
  ) || installers[0] || null;
}

export function normalizeQaArchitecture(value?: string | null): 'x64' | 'x86' | 'arm64' {
  const normalized = value?.trim().toLowerCase();
  return SUPPORTED_ARCHITECTURES.has(normalized || '')
    ? (normalized as 'x64' | 'x86' | 'arm64')
    : 'x64';
}

/** Select the exact architecture requested by a deployment or QA recipe. */
export function selectWingetInstaller(
  installers: WingetInstallerCandidate[] | null | undefined,
  architecture?: string | null,
  requestedScope?: 'machine' | 'user'
): WingetInstallerCandidate | null {
  if (!installers?.length) return null;
  const target = normalizeQaArchitecture(architecture);
  const exactArchitecture = installers.filter(
    (installer) => installer.Architecture?.toLowerCase() === target
  );
  if (exactArchitecture.length) {
    return preferredScopeInstaller(exactArchitecture, requestedScope);
  }
  const neutral = installers.filter(
    (installer) => installer.Architecture?.toLowerCase() === 'neutral'
  );
  return preferredScopeInstaller(neutral, requestedScope);
}

/**
 * Select an installer for the x64 QA VM. Within each architecture, prefer
 * machine scope so elevated PSADT execution does not launch a per-user setup.
 */
export function selectQaVmInstaller(
  installers: WingetInstallerCandidate[] | null | undefined
): QaInstallerSelection | null {
  if (!installers?.length) return null;
  const x64 = preferredScopeInstaller(
    installers.filter((installer) => installer.Architecture?.toLowerCase() === 'x64')
  );
  if (x64) return { installer: x64, architecture: 'x64' };
  const neutral = preferredScopeInstaller(
    installers.filter((installer) => installer.Architecture?.toLowerCase() === 'neutral')
  );
  if (neutral) return { installer: neutral, architecture: 'x64' };
  const x86 = preferredScopeInstaller(
    installers.filter((installer) => installer.Architecture?.toLowerCase() === 'x86')
  );
  return x86 ? { installer: x86, architecture: 'x86' } : null;
}

export function normalizeInstallerSha256(value?: string | null): string {
  const normalized = value?.trim().toUpperCase() || '';
  return /^[A-F0-9]{64}$/.test(normalized) ? normalized : '';
}

export function normalizeQaInstallerType(
  wingetType?: string | null,
  recipeType: string = 'exe'
): 'exe' | 'msi' | 'msix' | 'appx' | 'zip' | 'portable' {
  const normalized = wingetType?.trim().toLowerCase();
  if (normalized === 'wix' || normalized === 'msi') return 'msi';
  if (['inno', 'nullsoft', 'burn', 'exe'].includes(normalized || '')) return 'exe';
  if (normalized === 'msix') return 'msix';
  if (normalized === 'appx') return 'appx';
  if (normalized === 'zip') return 'zip';
  if (normalized === 'portable') return 'portable';
  const fallback = recipeType.trim().toLowerCase();
  return ['exe', 'msi', 'msix', 'appx', 'zip', 'portable'].includes(fallback)
    ? (fallback as 'exe' | 'msi' | 'msix' | 'appx' | 'zip' | 'portable')
    : 'exe';
}

export function qaInstallerFileName(installerUrl: string, installerType: string): string {
  return resolveInstallerFileName(installerUrl, normalizeQaInstallerType(installerType));
}
import { resolveInstallerFileName } from '@/lib/installer-filename';
