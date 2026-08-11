import type { DetectionRule } from '@/types/intune';
import type { WingetScope } from '@/types/winget';
import {
  generateRegistryMarkerDetectionRules,
  validateDetectionRules,
} from '@/lib/detection-rules';
import { reconcileManagedMarkerDetectionRules } from '@/lib/registry-marker';

/**
 * Normalize trusted catalog-package detection at the server boundary. Saved
 * customer profiles can predate managed marker detection, so an empty rule
 * list must be repaired before either QA or customer packaging is dispatched.
 * Callers must keep custom-source packages out of this catalog-only path.
 */
export function normalizeCatalogDetectionRules({
  detectionRules,
  fallbackDetectionRules,
  wingetId,
  version,
  installScope,
  markerPath,
}: {
  detectionRules: readonly unknown[] | null | undefined;
  fallbackDetectionRules?: readonly unknown[] | null;
  wingetId: string;
  version: string;
  installScope?: string;
  markerPath?: string | null;
}): DetectionRule[] {
  if (typeof wingetId !== 'string' || !wingetId.trim()) {
    throw new Error('Catalog package detection requires a non-empty Winget ID');
  }
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error('Catalog package detection requires a non-empty version');
  }

  // Match the PowerShell packager's scope semantics. PowerShell string
  // equality is case-insensitive but does not ignore surrounding whitespace.
  const scope: WingetScope = installScope?.toLowerCase() === 'user'
    ? 'user'
    : 'machine';
  const primaryRules = usableDetectionRules(detectionRules);
  const usableRules = primaryRules.length > 0
    ? primaryRules
    : usableDetectionRules(fallbackDetectionRules);
  const reconciled = reconcileManagedMarkerDetectionRules({
    detectionRules: usableRules,
    wingetId,
    version,
    installScope: scope,
    markerPath,
  });

  return reconciled.length > 0
    ? reconciled
    : generateRegistryMarkerDetectionRules(wingetId, version, scope, markerPath || undefined);
}

function usableDetectionRules(values: readonly unknown[] | null | undefined): DetectionRule[] {
  return Array.isArray(values) ? values.filter(isUsableDetectionRule) : [];
}

function isUsableDetectionRule(value: unknown): value is DetectionRule {
  if (!value || typeof value !== 'object') return false;
  const type = (value as { type?: unknown }).type;
  if (!['msi', 'file', 'registry', 'script'].includes(String(type))) return false;
  return validateDetectionRules([value as DetectionRule]).valid;
}
