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
  installerType,
}: {
  detectionRules: readonly unknown[] | null | undefined;
  fallbackDetectionRules?: readonly unknown[] | null;
  wingetId: string;
  version: string;
  installScope?: string;
  markerPath?: string | null;
  installerType?: string | null;
}): DetectionRule[] {
  if (typeof wingetId !== 'string' || !wingetId.trim()) {
    throw new Error('Catalog package detection requires a non-empty Winget ID');
  }
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error('Catalog package detection requires a non-empty version');
  }

  // Match the PowerShell packager's scope semantics. PowerShell string
  // equality is case-insensitive but does not ignore surrounding whitespace.
  const scope: WingetScope = typeof installScope === 'string' && installScope.toLowerCase() === 'user'
    ? 'user'
    : 'machine';
  const primaryRules = compatibleDetectionRules(detectionRules, installerType);
  const usableRules = primaryRules.length > 0
    ? primaryRules
    : compatibleDetectionRules(fallbackDetectionRules, installerType);
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

/**
 * Discard only rules whose machine-generated shape proves they belong to a
 * different installer family. This repairs saved catalog entries after a
 * vendor changes formats (for example MSIX to MSI) without replacing genuine
 * customer-authored scripts merely because they use a different mechanism.
 */
function compatibleDetectionRules(
  values: readonly unknown[] | null | undefined,
  installerType?: string | null
): DetectionRule[] {
  const rules = usableDetectionRules(values);
  const effectiveType = installerType?.trim().toLowerCase();
  if (!effectiveType) return rules;

  return rules.filter((rule) => {
    if (rule.type === 'script' && isGeneratedMsixDetectionRule(rule)) {
      return effectiveType === 'msix' || effectiveType === 'appx';
    }
    if (rule.type === 'msi' && (effectiveType === 'msix' || effectiveType === 'appx')) {
      return false;
    }
    return true;
  });
}

function isGeneratedMsixDetectionRule(rule: DetectionRule): boolean {
  if (rule.type !== 'script') return false;
  const script = (rule as { scriptContent?: unknown }).scriptContent;
  return typeof script === 'string' &&
    /^\s*# MSIX Detection Script\s*$/im.test(script) &&
    /^\s*# Package Family Name:\s*\S+/im.test(script);
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
