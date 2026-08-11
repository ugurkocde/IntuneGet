import type { DetectionRule } from '@/types/intune';
import type { WingetScope } from '@/types/winget';
import { generateRegistryMarkerDetectionRules } from '@/lib/detection-rules';
import { reconcileManagedMarkerDetectionRules } from '@/lib/registry-marker';

/**
 * Normalize trusted catalog-package detection at the server boundary. Saved
 * customer profiles can predate managed marker detection, so an empty rule
 * list must be repaired before either QA or customer packaging is dispatched.
 */
export function normalizeCatalogDetectionRules({
  detectionRules,
  wingetId,
  version,
  installScope,
  markerPath,
}: {
  detectionRules: DetectionRule[] | null | undefined;
  wingetId: string;
  version: string;
  installScope?: string;
  markerPath?: string | null;
}): DetectionRule[] {
  const scope: WingetScope = installScope?.trim().toLowerCase() === 'user'
    ? 'user'
    : 'machine';
  const reconciled = reconcileManagedMarkerDetectionRules({
    detectionRules: Array.isArray(detectionRules) ? detectionRules : [],
    wingetId,
    version,
    installScope: scope,
    markerPath,
  });

  return reconciled.length > 0
    ? reconciled
    : generateRegistryMarkerDetectionRules(wingetId, version, scope, markerPath || undefined);
}
