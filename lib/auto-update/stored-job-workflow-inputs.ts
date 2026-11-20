import type { Database } from '@/types/database';
import type { Win32CartItem } from '@/types/upload';
import type { WorkflowInputs } from '@/lib/github-actions';
import { buildIntuneAppDescription } from '@/lib/intune-description';
import { sanitizeAssignmentsForDispatch } from '@/lib/assignment-intents';
import { extractSilentSwitches } from '@/lib/msp/silent-switches';

type StoredPackagingJob = Database['public']['Tables']['packaging_jobs']['Row'];

export function storedJobItem(job: StoredPackagingJob): Win32CartItem {
  const item = job.package_config as unknown as Win32CartItem;
  // Keep explicit cart detection rules; automatic updates also store them on the row.
  return job.is_auto_update && item && item.detectionRules == null && job.detection_rules != null
    ? { ...item, detectionRules: job.detection_rules as unknown as Win32CartItem['detectionRules'] }
    : item;
}

export function buildStoredJobWorkflowInputs(
  job: StoredPackagingJob,
  item: Win32CartItem,
  { callbackUrl, qaOverride, sanitizeAssignments }: {
    callbackUrl: string; qaOverride: boolean; sanitizeAssignments: boolean;
  }
): WorkflowInputs {
  const selectedHash = item.installerSha256 || job.installer_sha256 || '';
  const installerSha256 = item.sourceType === 'custom' ? selectedHash.trim() : selectedHash;
  const autoUpdate = job.is_auto_update ? item as Win32CartItem & {
    sourceIntuneAppId?: string; autoSupersede?: boolean; supersedenceType?: string;
  } : undefined;
  return {
    qaOverride,
    jobId: job.id,
    tenantId: job.tenant_id || '',
    wingetId: job.winget_id,
    displayName: item.displayName || job.display_name,
    description: buildIntuneAppDescription({
      description: item.description,
      fallback: `Deployed via IntuneGet from Winget: ${job.winget_id}`,
    }),
    publisher: item.sourceType === 'custom' ? item.publisher : item.publisher || job.publisher || 'Unknown Publisher',
    version: job.version,
    architecture: item.architecture || job.architecture || 'x64',
    installerUrl: item.installerUrl || job.installer_url || '',
    installerSha256,
    hashValidationMode: 'strict',
    installerType: item.installerType || job.installer_type || 'exe',
    nestedInstallerType: item.nestedInstallerType,
    nestedInstallerPath: item.nestedInstallerPath,
    silentSwitches: extractSilentSwitches(
      item.installCommand || job.install_command || '',
      item.installerType || job.installer_type,
      item.nestedInstallerType
    ),
    installerSuccessCodes: item.installerSuccessCodes,
    uninstallCommand: item.uninstallCommand || job.uninstall_command || '',
    callbackUrl,
    psadtConfig: item.psadtConfig ? JSON.stringify(item.psadtConfig) : undefined,
    detectionRules: item.detectionRules ? JSON.stringify(item.detectionRules) : undefined,
    requirementRules: item.requirementRules ? JSON.stringify(item.requirementRules) : undefined,
    assignments: item.assignments ? JSON.stringify(sanitizeAssignments
      ? sanitizeAssignmentsForDispatch(item.assignments, Boolean(item.requirementRules?.length))
      : item.assignments) : undefined,
    categories: item.categories ? JSON.stringify(item.categories) : undefined,
    espProfiles: item.espProfiles ? JSON.stringify(item.espProfiles) : undefined,
    relationships: item.relationships?.length ? JSON.stringify(item.relationships) : undefined,
    installScope: (item.installScope || job.install_scope) === 'user' ? 'user' : 'machine',
    forceCreate: item.forceCreate,
    sourceIntuneAppId: autoUpdate?.sourceIntuneAppId,
    carryOverAssignments: autoUpdate?.assignmentMigration?.carryOverAssignments,
    // Queued policies may still contain the old implicit copy/removal flag.
    removeAssignmentsFromPreviousApp: autoUpdate ? false : undefined,
    autoSupersede: autoUpdate?.autoSupersede,
    supersedenceType: autoUpdate?.supersedenceType,
    sourceType: item.sourceType,
    curatedReleaseId: item.curatedReleaseId,
  };
}
