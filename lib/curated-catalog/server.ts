import envelope from '@/catalog/curated/catalog.json';
import committedKeys from '@/catalog/curated/trusted-keys.json';
import { CURATED_APPS } from './definitions';
import { catalogEntries, CuratedCatalogError, verifyCatalogReleases } from './core.mjs';
import { assertCuratedPackageProfile, buildCuratedCartItem, curatedInstaller, curatedWorkflowInput } from './package';
import type { CuratedCatalogEnvelope, CuratedCatalogEntry } from './types';
import type { Win32CartItem } from '@/types/upload';
import type { QaWorkflowPackageInput } from '@/lib/qa/package-profile';
import type { PackagingJob } from '@/lib/db/types';
import { isCuratedPackageId } from './core.mjs';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import { authorizeCuratedExecution } from './custom-config';
import { testedCuratedSettings } from './settings';

export function getCuratedCatalog(): { payload: CuratedCatalogEnvelope['payload']; entries: CuratedCatalogEntry[] } {
  let trustedKeys: Record<string, string>;
  try { trustedKeys = JSON.parse(process.env.CURATED_CATALOG_PUBLIC_KEYS || '{}'); }
  catch { throw new CuratedCatalogError('The curated catalog trust configuration is invalid.'); }
  // Serving tolerates a definitions change that the automation has not
  // re-signed yet; every release is still revalidated individually.
  const { payload } = verifyCatalogReleases(envelope, CURATED_APPS, { ...committedKeys, ...trustedKeys });
  // A release whose packaging profile is no longer current is withheld until
  // the automation verifies it again; other apps stay deployable meanwhile.
  const entries = catalogEntries(CURATED_APPS, payload).map(entry => {
    if (!entry.release) return entry;
    try { assertCuratedPackageProfile(entry.app, entry.release); return entry; }
    catch { return { ...entry, status: 'pending' as const, release: null }; }
  });
  return { payload, entries };
}

export function getApprovedCuratedRelease(packageId: string, version?: string, releaseId?: string) {
  const { payload, entries } = getCuratedCatalog();
  const entry = entries.find(entry => entry.app.packageId.toLowerCase() === packageId.toLowerCase());
  if (!entry) throw new CuratedCatalogError('This application is not in the curated pilot.');
  const release = version || releaseId
    ? payload.releases.find(release => release.candidate.appId === entry.app.id &&
        (!version || release.candidate.version === version) && (!releaseId || release.id === releaseId) &&
        !payload.withdrawnReleaseIds.includes(release.id))
    : entry.release;
  if (!release) throw new CuratedCatalogError('This application release is awaiting verification or has been withdrawn.');
  assertCuratedPackageProfile(entry.app, release);
  return { app: entry.app, release };
}

export function assertCuratedInstaller(input: {
  wingetId: string; version: string; architecture?: string; installerUrl: string;
  installerSha256: string; installerType?: string; installScope?: string; curatedReleaseId?: string;
}) {
  const { app, release } = getApprovedCuratedRelease(input.wingetId, input.version, input.curatedReleaseId);
  if ((input.architecture || 'x64') !== app.architecture || (input.installScope || 'machine') !== app.scope ||
      input.installerUrl !== release.candidate.installerUrl || input.installerSha256.toLowerCase() !== release.installerSha256.toLowerCase() ||
      (input.installerType && input.installerType !== app.installerType)) {
    throw new CuratedCatalogError('Installer metadata differs from the approved curated release.');
  }
  return { app, release, installer: curatedInstaller(app, release) };
}

/**
 * Authorizes a curated deployment. Installer, arguments, uninstall identity
 * and detection must match the signed release; PSADT execution settings must
 * be the verified defaults or a custom configuration that passed its own VM
 * verification. With `request`, an unverified custom configuration is queued.
 */
export async function authorizeCuratedWorkflow(
  input: QaWorkflowPackageInput & { installerUrl: string; curatedReleaseId?: string },
  request?: { tenantId?: string | null; userId?: string | null },
) {
  const approved = assertCuratedInstaller(input);
  const execution = await authorizeCuratedExecution(approved.app, approved.release, input, request);
  return { ...approved, execution };
}

export async function reconcileCuratedCartItem(item: Win32CartItem, request?: { tenantId?: string | null; userId?: string | null }) {
  if (item.sourceType !== 'curated' || !item.curatedReleaseId || item.qaOverride || item.nestedInstallerType || item.nestedInstallerPath) {
    throw new CuratedCatalogError('Select an approved release from the curated catalog.');
  }
  const signed = getApprovedCuratedRelease(item.wingetId, item.version, item.curatedReleaseId);
  const psadtConfig = item.curatedSettingsMode === 'tested-defaults'
    ? testedCuratedSettings(buildCuratedCartItem(signed.app, signed.release).psadtConfig, item.psadtConfig)
    : item.psadtConfig;
  const approved = await authorizeCuratedWorkflow({ ...curatedWorkflowInput({ ...item, psadtConfig }), installerUrl: item.installerUrl, curatedReleaseId: item.curatedReleaseId }, request);
  // Assignment and PSADT choices survive; every other execution field comes
  // from the signed definition and cannot be replaced by mutable browser data.
  return { item: { ...item, ...buildCuratedCartItem(approved.app, approved.release),
    curatedSettingsMode: item.curatedSettingsMode || 'custom', psadtConfig }, trustedInstallers: [approved.installer] };
}

export function getCuratedLatestVersions() {
  return getCuratedCatalog().entries.flatMap(({ app, release }) => release ? [{ winget_id: app.packageId, latest_version: release.candidate.version }] : []);
}

export async function validateCuratedPackagingJob(job: PackagingJob): Promise<void> {
  const config = job.package_config && typeof job.package_config === 'object' && !Array.isArray(job.package_config)
    ? job.package_config as Record<string, unknown> : {};
  if (!isCuratedPackageId(job.winget_id) && config.sourceType !== 'curated') return;
  if (config.sourceType !== 'curated' || typeof config.curatedReleaseId !== 'string' || config.qaOverride) {
    throw new CuratedCatalogError('This packaging job has no valid curated release provenance.');
  }
  await authorizeCuratedWorkflow({
    wingetId: job.winget_id, version: job.version, displayName: job.display_name,
    publisher: job.publisher || '', architecture: job.architecture || 'x64',
    installerUrl: job.installer_url || '', installerSha256: job.installer_sha256 || '',
    installerType: job.installer_type || '', installScope: job.install_scope || 'machine',
    curatedReleaseId: config.curatedReleaseId,
    silentSwitches: extractSilentSwitches(job.install_command || '', job.installer_type || ''),
    uninstallCommand: job.uninstall_command || '', detectionRules: JSON.stringify(job.detection_rules || []),
    psadtConfig: JSON.stringify(config.psadtConfig),
    installerSuccessCodes: config.installerSuccessCodes as number[] | undefined,
    nestedInstallerType: config.nestedInstallerType as string | undefined,
    nestedInstallerPath: config.nestedInstallerPath as string | undefined,
  });
}
