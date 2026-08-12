import { resolveInstallerFileName } from '@/lib/installer-filename';
import {
  fetchAvailableVersionsLive,
  getLiveInstallers,
} from '@/lib/manifest-api';
import { assertPackagingContract } from '@/lib/packaging-contract';
import { compareVersions } from '@/lib/version-compare';
import type {
  NormalizedInstaller,
  WingetArchitecture,
  WingetInstallerType,
} from '@/types/winget';

const MAX_DEPENDENCY_DEPTH = 3;
const MAX_PACKAGE_DEPENDENCIES = 8;
const SHA256_PATTERN = /^[A-F0-9]{64}$/;

// Keep dependency redistribution explicit and fail closed. Each reviewed
// family also constrains the installer formats we are prepared to invoke
// offline inside the PSADT package.
const VC_REDISTRIBUTABLE_PACKAGE_PATTERN =
  /^Microsoft\.VCRedist\.[A-Za-z0-9+.-]+\.(?:x86|x64|arm64)$/i;
const DOTNET_DESKTOP_RUNTIME_PACKAGE_PATTERN =
  /^Microsoft\.DotNet\.DesktopRuntime\.\d+$/i;

interface ReviewedDependencyPolicy {
  packagePattern: RegExp;
  installerTypes: ReadonlySet<WingetInstallerType>;
}

const REVIEWED_DEPENDENCY_POLICIES: readonly ReviewedDependencyPolicy[] = [
  {
    packagePattern: VC_REDISTRIBUTABLE_PACKAGE_PATTERN,
    installerTypes: new Set<WingetInstallerType>(['exe', 'burn']),
  },
  {
    packagePattern: DOTNET_DESKTOP_RUNTIME_PACKAGE_PATTERN,
    installerTypes: new Set<WingetInstallerType>(['exe', 'burn']),
  },
  {
    packagePattern: /^Microsoft\.PowerShell$/i,
    installerTypes: new Set<WingetInstallerType>(['msi', 'wix']),
  },
];

function reviewedDependencyPolicy(
  packageIdentifier: string
): ReviewedDependencyPolicy | null {
  return REVIEWED_DEPENDENCY_POLICIES.find((policy) =>
    policy.packagePattern.test(packageIdentifier)
  ) || null;
}

export interface PackagedWingetDependency {
  packageIdentifier: string;
  minimumVersion?: string;
  version: string;
  architecture: WingetArchitecture;
  installerUrl: string;
  installerSha256: string;
  installerType: WingetInstallerType;
  nestedInstallerType?: WingetInstallerType;
  nestedInstallerPath?: string;
  silentArgs: string;
  successCodes: number[];
  rebootCodes: number[];
  fileName: string;
  order: number;
  depth: number;
}

export interface WingetDependencyResolverIo {
  getInstallers(packageIdentifier: string, version: string): Promise<NormalizedInstaller[]>;
  getVersions(packageIdentifier: string): Promise<string[]>;
}

const defaultIo: WingetDependencyResolverIo = {
  getInstallers: getLiveInstallers,
  getVersions: fetchAvailableVersionsLive,
};

function normalizeSha256(value: string): string {
  const normalized = value.trim().toUpperCase();
  return SHA256_PATTERN.test(normalized) ? normalized : '';
}

function normalizedArchitecture(value: string): 'x64' | 'x86' | 'arm64' {
  const normalized = value.trim().toLowerCase();
  return normalized === 'x86' || normalized === 'arm64' ? normalized : 'x64';
}

function chooseInstaller(
  installers: NormalizedInstaller[],
  targetArchitecture: 'x64' | 'x86' | 'arm64',
  allowedTypes?: ReadonlySet<WingetInstallerType>
): NormalizedInstaller | null {
  const reviewedInstallers = allowedTypes
    ? installers.filter((installer) => allowedTypes.has(installer.type))
    : installers;
  const exact = reviewedInstallers.find(
    (installer) => installer.architecture === targetArchitecture
  );
  if (exact) return exact;
  const neutral = reviewedInstallers.find((installer) => installer.architecture === 'neutral');
  if (neutral) return neutral;
  // WinGet's dependency resolver permits an x86 prerequisite for an x64 app.
  // Never make the inverse substitution and never use x86 for ARM64.
  if (targetArchitecture === 'x64') {
    return reviewedInstallers.find((installer) => installer.architecture === 'x86') || null;
  }
  return null;
}

function ensureSupportedDependencyShape(
  packageIdentifier: string,
  installer: NormalizedInstaller
): void {
  const unsupported = [
    ...(installer.windowsFeatures || []).map((value) => `Windows feature ${value}`),
    ...(installer.windowsLibraries || []).map((value) => `Windows library ${value}`),
    ...(installer.externalDependencies || []).map((value) => `external dependency ${value}`),
  ];
  if (unsupported.length > 0) {
    throw new Error(
      `${packageIdentifier} declares unsupported dependencies: ${unsupported.join(', ')}`
    );
  }
}

function safeDependencyFileName(
  packageIdentifier: string,
  installerUrl: string,
  installerType: WingetInstallerType
): string {
  const packagePrefix = packageIdentifier
    .replace(/[^A-Za-z0-9._+-]/g, '_')
    .slice(0, 80);
  const installerName = resolveInstallerFileName(installerUrl, installerType)
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(-140);
  return `${packagePrefix}-${installerName}`;
}

function dependencySuccessCodes(packageIdentifier: string, installer: NormalizedInstaller): number[] {
  const codes = new Set<number>([0, ...(installer.installerSuccessCodes || [])]);
  if (VC_REDISTRIBUTABLE_PACKAGE_PATTERN.test(packageIdentifier)) {
    // VC++ redistributables return ERROR_PRODUCT_VERSION (1638), sometimes
    // surfaced as signed HRESULT 0x80070666, when the same or a newer runtime
    // is already installed. Both are successful idempotent outcomes.
    codes.add(1638);
    codes.add(-2147023258);
  }
  return Array.from(codes).sort((left, right) => left - right);
}

function highestMinimum(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return compareVersions(left, right) >= 0 ? left : right;
}

export async function resolveWingetPackageDependencies(
  input: {
    wingetId: string;
    version: string;
    architecture?: string;
    installerSha256: string;
    installScope?: string;
  },
  io: WingetDependencyResolverIo = defaultIo
): Promise<PackagedWingetDependency[]> {
  const targetArchitecture = normalizedArchitecture(input.architecture || 'x64');
  const rootSha256 = normalizeSha256(input.installerSha256);
  if (!rootSha256) throw new Error('Primary installer SHA-256 is invalid.');

  const rootInstallers = await io.getInstallers(input.wingetId, input.version);
  const rootCandidates = rootInstallers.filter(
    (installer) => normalizeSha256(installer.sha256) === rootSha256
  );
  const rootInstaller = chooseInstaller(rootCandidates, targetArchitecture);
  if (!rootInstaller) {
    throw new Error(
      `The trusted WinGet installer tuple for ${input.wingetId} ${input.version} could not be resolved.`
    );
  }
  ensureSupportedDependencyShape(input.wingetId, rootInstaller);
  if (
    input.installScope?.trim().toLowerCase() === 'user' &&
    (rootInstaller.packageDependencies || []).length > 0
  ) {
    throw new Error(
      `${input.wingetId} declares machine-wide package dependencies that cannot be installed safely in user scope.`
    );
  }

  const ordered: PackagedWingetDependency[] = [];
  const resolved = new Map<string, PackagedWingetDependency>();
  const minimums = new Map<string, string | undefined>();
  const activePath: string[] = [];

  const visit = async (
    packageIdentifier: string,
    minimumVersion: string | undefined,
    depth: number
  ): Promise<void> => {
    if (depth > MAX_DEPENDENCY_DEPTH) {
      throw new Error(
        `WinGet dependency depth exceeds ${MAX_DEPENDENCY_DEPTH} at ${packageIdentifier}.`
      );
    }
    const dependencyPolicy = reviewedDependencyPolicy(packageIdentifier);
    if (!dependencyPolicy) {
      throw new Error(
        `WinGet dependency ${packageIdentifier} is not in the reviewed redistribution allowlist.`
      );
    }

    const key = packageIdentifier.toLowerCase();
    const cycleIndex = activePath.indexOf(key);
    if (cycleIndex >= 0) {
      throw new Error(
        `WinGet dependency cycle detected: ${[
          ...activePath.slice(cycleIndex),
          key,
        ].join(' -> ')}`
      );
    }
    const effectiveMinimum = highestMinimum(minimums.get(key), minimumVersion);
    minimums.set(key, effectiveMinimum);
    const existing = resolved.get(key);
    if (
      existing &&
      (!effectiveMinimum || compareVersions(existing.version, effectiveMinimum) >= 0)
    ) {
      return;
    }
    if (!existing && resolved.size >= MAX_PACKAGE_DEPENDENCIES) {
      throw new Error(
        `WinGet package dependency count exceeds ${MAX_PACKAGE_DEPENDENCIES}.`
      );
    }

    activePath.push(key);
    try {
      const versions = (await io.getVersions(packageIdentifier))
        .filter((version) => !effectiveMinimum || compareVersions(version, effectiveMinimum) >= 0)
        .sort((left, right) => compareVersions(right, left));

      let selectedVersion = '';
      let selectedInstaller: NormalizedInstaller | null = null;
      for (const version of versions) {
        const installers = await io.getInstallers(packageIdentifier, version);
        const candidate = chooseInstaller(
          installers,
          targetArchitecture,
          dependencyPolicy.installerTypes
        );
        if (candidate) {
          selectedVersion = version;
          selectedInstaller = candidate;
          break;
        }
      }
      if (!selectedInstaller || !selectedVersion) {
        throw new Error(
          `No compatible installer was found for WinGet dependency ${packageIdentifier}` +
            (effectiveMinimum ? ` >= ${effectiveMinimum}.` : '.')
        );
      }
      ensureSupportedDependencyShape(packageIdentifier, selectedInstaller);
      if (!dependencyPolicy.installerTypes.has(selectedInstaller.type)) {
        throw new Error(
          `WinGet dependency ${packageIdentifier} uses unreviewed installer type ${selectedInstaller.type}.`
        );
      }
      const installerSha256 = normalizeSha256(selectedInstaller.sha256);
      let protocol = '';
      try {
        protocol = new URL(selectedInstaller.url).protocol;
      } catch {
        // The actionable error below covers malformed URLs without exposing them.
      }
      if (protocol !== 'https:' || !installerSha256) {
        throw new Error(
          `WinGet dependency ${packageIdentifier} is missing a trusted HTTPS URL or SHA-256.`
        );
      }
      assertPackagingContract({
        wingetId: packageIdentifier,
        installerType: selectedInstaller.type,
        silentArgs: selectedInstaller.silentArgs || '',
        nestedInstallerType: selectedInstaller.nestedInstallerType,
        nestedInstallerFiles: selectedInstaller.nestedInstallerPath
          ? [selectedInstaller.nestedInstallerPath]
          : [],
      });

      for (const child of selectedInstaller.packageDependencies || []) {
        await visit(child.packageIdentifier, child.minimumVersion, depth + 1);
      }

      const dependency: PackagedWingetDependency = {
        packageIdentifier,
        ...(effectiveMinimum ? { minimumVersion: effectiveMinimum } : {}),
        version: selectedVersion,
        architecture: selectedInstaller.architecture,
        installerUrl: selectedInstaller.url,
        installerSha256,
        installerType: selectedInstaller.type,
        ...(selectedInstaller.nestedInstallerType
          ? { nestedInstallerType: selectedInstaller.nestedInstallerType }
          : {}),
        ...(selectedInstaller.nestedInstallerPath
          ? { nestedInstallerPath: selectedInstaller.nestedInstallerPath }
          : {}),
        silentArgs: selectedInstaller.silentArgs || '',
        successCodes: dependencySuccessCodes(packageIdentifier, selectedInstaller),
        rebootCodes: [1641, 3010],
        fileName: safeDependencyFileName(
          packageIdentifier,
          selectedInstaller.url,
          selectedInstaller.type
        ),
        order: existing?.order || ordered.length + 1,
        depth,
      };

      if (existing) {
        const index = ordered.findIndex(
          (item) => item.packageIdentifier.toLowerCase() === key
        );
        if (index >= 0) ordered[index] = dependency;
      } else {
        ordered.push(dependency);
      }
      resolved.set(key, dependency);
    } finally {
      activePath.pop();
    }
  };

  for (const dependency of rootInstaller.packageDependencies || []) {
    await visit(dependency.packageIdentifier, dependency.minimumVersion, 1);
  }

  return ordered.map((dependency, index) => ({ ...dependency, order: index + 1 }));
}

export function hasPackagedDependencies(
  value: readonly PackagedWingetDependency[] | null | undefined
): value is readonly PackagedWingetDependency[] {
  return Array.isArray(value) && value.length > 0;
}
