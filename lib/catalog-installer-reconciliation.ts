import {
  generateInstallCommand,
  generateUninstallCommand,
} from '@/lib/detection-rules';
import {
  InstallerPreflightError,
} from '@/lib/installer-preflight';
import { getLiveInstallers } from '@/lib/manifest-api';
import {
  resolveApplicationInstallScope,
  resolveApplicationUninstallCommand,
} from '@/lib/packaging-adapters';
import { evaluatePackagingContract } from '@/lib/packaging-contract';
import { hashesEqual } from '@/lib/installer-download';
import type { Win32CartItem } from '@/types/upload';
import type { NormalizedInstaller, WingetScope } from '@/types/winget';
import { createClient } from '@supabase/supabase-js';

export interface TrustedCatalogInstallerRequest {
  wingetId: string;
  version: string;
  architecture?: string;
  installScope: WingetScope;
  installerUrl?: string;
  installerSha256?: string;
  localeCode?: string;
}

export interface ReconciledCatalogInstaller {
  item: Win32CartItem;
  trustedInstallers: NormalizedInstaller[];
}

function normalized(value?: string | null): string {
  return value?.trim().toLowerCase() || '';
}

function preferEnterpriseMachineInstaller(
  installers: NormalizedInstaller[],
  installScope: WingetScope,
): NormalizedInstaller[] {
  if (installScope !== 'machine') return installers;

  const enterpriseInstallers = installers.filter((installer) => {
    const effectiveType = normalized(
      installer.type === 'zip' && installer.nestedInstallerType
        ? installer.nestedInstallerType
        : installer.type,
    );
    return effectiveType === 'msi' || effectiveType === 'wix';
  });

  return enterpriseInstallers.length > 0 ? enterpriseInstallers : installers;
}

function selectPreferredIdentity(
  installers: NormalizedInstaller[],
  input: TrustedCatalogInstallerRequest,
): NormalizedInstaller | null {
  if (installers.length === 0) return null;

  const currentUrl = input.installerUrl?.trim();
  const currentSha256 = input.installerSha256?.trim();
  const currentIdentity = installers.find((installer) =>
    Boolean(currentUrl) &&
    installer.url?.trim() === currentUrl &&
    Boolean(currentSha256) &&
    hashesEqual(installer.sha256 || '', currentSha256 || '')
  );
  if (currentIdentity) return currentIdentity;

  const locale = normalized(input.localeCode);
  if (locale) {
    const localized = installers.find(
      (installer) => normalized(installer.installerLocale) === locale
    );
    if (localized) return localized;
  }

  return installers.find((installer) => !installer.installerLocale?.trim()) || installers[0];
}

/**
 * Select the live WinGet installer that actually represents the requested
 * architecture and deployment scope. An installer with no declared scope is
 * compatible with either scope; an installer explicitly declaring the
 * opposite scope is never substituted.
 */
export function selectTrustedCatalogInstaller(
  installers: NormalizedInstaller[],
  input: TrustedCatalogInstallerRequest,
): NormalizedInstaller | null {
  const requestedArchitecture = normalized(input.architecture) || 'x64';
  const exactArchitecture = installers.filter(
    (installer) => normalized(installer.architecture) === requestedArchitecture
  );
  const architectureCandidates = exactArchitecture.length > 0
    ? exactArchitecture
    : installers.filter((installer) => normalized(installer.architecture) === 'neutral');

  const exactScope = architectureCandidates.filter(
    (installer) => normalized(installer.scope) === input.installScope
  );
  if (exactScope.length > 0) {
    return selectPreferredIdentity(
      preferEnterpriseMachineInstaller(exactScope, input.installScope),
      input,
    );
  }

  const unspecifiedScope = architectureCandidates.filter(
    (installer) => !installer.scope?.trim()
  );
  return selectPreferredIdentity(
    preferEnterpriseMachineInstaller(unspecifiedScope, input.installScope),
    input,
  );
}

export async function reconcileCatalogInstaller(
  item: Win32CartItem,
): Promise<ReconciledCatalogInstaller> {
  const installScope = resolveApplicationInstallScope(item.wingetId, item.installScope);
  const trustedInstallers = await getLiveInstallers(item.wingetId, item.version);
  if (trustedInstallers.length === 0) {
    throw new InstallerPreflightError(
      'MANIFEST_UNAVAILABLE',
      `The trusted WinGet installer manifest for ${item.wingetId} ${item.version} is unavailable`,
      true,
    );
  }

  const installer = selectTrustedCatalogInstaller(trustedInstallers, {
    wingetId: item.wingetId,
    version: item.version,
    architecture: item.architecture,
    installScope,
    installerUrl: item.installerUrl,
    installerSha256: item.installerSha256,
    localeCode: item.localeCode,
  });
  if (!installer) {
    throw new InstallerPreflightError(
      'INSTALL_SCOPE_UNAVAILABLE',
      `WinGet does not publish a ${item.architecture || 'x64'} ${installScope}-scope installer for ${item.wingetId} ${item.version}`,
    );
  }
  if (!installer.url?.trim() || !/^[A-Fa-f0-9]{64}$/.test(installer.sha256?.trim() || '')) {
    throw new InstallerPreflightError(
      'MANIFEST_CHANGED',
      `The selected installer for ${item.wingetId} ${item.version} is missing its trusted URL or SHA256`,
    );
  }

  const customInstallCommand = item.psadtConfig?.installCommand?.trim();
  const customUninstallCommand = item.psadtConfig?.uninstallCommand?.trim();
  const packagingContract = evaluatePackagingContract({
    wingetId: item.wingetId,
    installerType: installer.type,
    silentArgs: customInstallCommand || installer.silentArgs || '',
    nestedInstallerType: installer.nestedInstallerType,
    nestedInstallerFiles: installer.nestedInstallerPath
      ? [installer.nestedInstallerPath]
      : undefined,
  });
  if (!packagingContract.valid) {
    throw new InstallerPreflightError(
      'SILENT_INSTALL_UNAVAILABLE',
      packagingContract.message,
    );
  }
  const refreshedItem: Win32CartItem = {
    ...item,
    installScope,
    installerUrl: installer.url,
    installerSha256: installer.sha256.toUpperCase(),
    installerType: installer.type,
    nestedInstallerType: installer.nestedInstallerType,
    nestedInstallerPath: installer.nestedInstallerPath,
    installerSuccessCodes: installer.installerSuccessCodes,
    manifestDependencies: installer.packageDependencies,
    installCommand: customInstallCommand || generateInstallCommand(installer, installScope),
    uninstallCommand: customUninstallCommand || resolveApplicationUninstallCommand(
      item.wingetId,
      generateUninstallCommand(installer, item.displayName),
    ),
  };

  if (
    item.installerUrl !== refreshedItem.installerUrl ||
    !hashesEqual(item.installerSha256, refreshedItem.installerSha256)
  ) {
    await healCatalogInstaller(item.wingetId, item.version, installer, trustedInstallers);
  }

  return {
    item: refreshedItem,
    trustedInstallers,
  };
}

async function healCatalogInstaller(
  wingetId: string,
  version: string,
  selected: NormalizedInstaller,
  installers: NormalizedInstaller[],
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const rawInstallers = installers.map((value) => ({
    Architecture: value.architecture,
    InstallerLocale: value.installerLocale,
    InstallerUrl: value.url,
    InstallerSha256: value.sha256,
    InstallerType: value.type,
    InstallerSwitches: value.silentArgs
      ? { Silent: value.silentArgs }
      : undefined,
    NestedInstallerType: value.nestedInstallerType,
    Scope: value.scope,
    InstallerSuccessCodes: value.installerSuccessCodes,
    ProductCode: value.productCode,
    PackageFamilyName: value.packageFamilyName,
  }));
  const { error } = await createClient(url, key).from('version_history').upsert({
    winget_id: wingetId,
    version,
    installer_url: selected.url,
    installer_sha256: selected.sha256.toUpperCase(),
    installer_type: selected.type,
    installer_scope: selected.scope || null,
    silent_args: selected.silentArgs || null,
    installers: rawInstallers,
    manifest_fetched_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'winget_id,version' });
  if (error) {
    console.warn(`Could not refresh catalog installer for ${wingetId} ${version}: ${error.message}`);
  }
}
