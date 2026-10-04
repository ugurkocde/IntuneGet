import { generateDetectionRules, generateInstallCommand, generateUninstallCommand } from '@/lib/detection-rules';
import { compatiblePriorExecutionProfileReason, normalizeQaWorkflowPackageInput, type QaWorkflowPackageInput } from '@/lib/qa/package-profile';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import type { NormalizedInstaller } from '@/types/winget';
import type { Win32CartItem } from '@/types/upload';
import type { CuratedAppDefinition, CuratedRelease } from './types';
import { CuratedCatalogError } from './core.mjs';

export function curatedInstaller(app: CuratedAppDefinition, release: CuratedRelease): NormalizedInstaller {
  return {
    architecture: app.architecture, scope: app.scope, type: app.installerType,
    url: release.candidate.installerUrl, sha256: release.installerSha256,
    silentArgs: app.silentArgs,
  };
}

export function buildCuratedCartItem(app: CuratedAppDefinition, release: CuratedRelease): Omit<Win32CartItem, 'id' | 'addedAt'> {
  const installer = curatedInstaller(app, release);
  const detectionRules = generateDetectionRules(installer, app.name, app.packageId, release.candidate.version);
  return {
    appSource: 'win32', sourceType: 'curated', curatedReleaseId: release.id,
    wingetId: app.packageId, displayName: app.name, publisher: app.publisher,
    description: `${app.name}. IntuneGet Curated Catalog — ${app.channel}.`,
    version: release.candidate.version, architecture: app.architecture, installScope: app.scope,
    installerType: app.installerType, installerUrl: installer.url, installerSha256: installer.sha256,
    installCommand: generateInstallCommand(installer, app.scope),
    uninstallCommand: generateUninstallCommand(installer, app.name),
    detectionRules, psadtConfig: { ...DEFAULT_PSADT_CONFIG, detectionRules },
  };
}

export function curatedWorkflowInput(item: Omit<Win32CartItem, 'id' | 'addedAt'>): QaWorkflowPackageInput {
  // The workflow generator receives the reviewed vendor arguments separately
  // from the downloaded file path. Both QA and customer dispatch use these.
  return {
    wingetId: item.wingetId, displayName: item.displayName, publisher: item.publisher,
    version: item.version, architecture: item.architecture, installerSha256: item.installerSha256,
    installerType: item.installerType, installScope: item.installScope,
    installerSuccessCodes: item.installerSuccessCodes,
    nestedInstallerType: item.nestedInstallerType, nestedInstallerPath: item.nestedInstallerPath,
    silentSwitches: extractSilentSwitches(item.installCommand, item.installerType),
    uninstallCommand: item.uninstallCommand,
    psadtConfig: JSON.stringify(item.psadtConfig), detectionRules: JSON.stringify(item.detectionRules),
    packageDependencies: [],
  };
}

export function assertCuratedPackageProfile(app: CuratedAppDefinition, release: CuratedRelease, input?: QaWorkflowPackageInput): void {
  const expected = curatedWorkflowInput(buildCuratedCartItem(app, release));
  const identity = normalizeQaWorkflowPackageInput(expected).identity;
  const profile = identity.executionProfileSha256;
  // Packager releases ship every few days. A release tested on an earlier
  // packager stays deployable only while its exact profile is unchanged and no
  // intervening packager release alters behavior that profile exercises.
  if (compatiblePriorExecutionProfileReason(identity.canonicalJson, release.evidence.qa.packagerCommit, release.executionProfileSha256) !== null) {
    throw new CuratedCatalogError('This curated release needs verification with the current packaging configuration.');
  }
  if (input && normalizeQaWorkflowPackageInput({ ...input, packageDependencies: [] }).identity.executionProfileSha256 !== profile) {
    throw new CuratedCatalogError('The requested package configuration differs from the approved curated release.');
  }
}
