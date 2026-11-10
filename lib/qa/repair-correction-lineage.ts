import { extractSilentSwitches } from '@/lib/msp/silent-switches';
import {
  canonicalQaJson, QA_PSADT_TOOLCHAIN, validateCurrentQaPackageProfile,
  validateRecordedQaPackageProfile,
} from './package-profile';

type ProfileWitness = Parameters<typeof validateRecordedQaPackageProfile>[0];
export interface RepairProfileCorrectionInput {
  contract: string;
  expectedOldProfile: string;
  expectedNewProfile: string;
  requiredPackagerCommit: string;
  old: ProfileWitness;
  current: ProfileWitness;
}
type LineageProof = {valid: true; oldProfile: string; newProfile: string} | {valid: false; reason: string};
const denied = (reason: string): LineageProof => ({valid: false, reason});
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * Frozen comparison witness for the four unconditional MSI replacements fixed
 * by IntuneGet PR #1779 (2f924d49ed79530a376980efa9874a218b9677b7).
 * Never use this value as an install command or write it to a new candidate.
 */
function legacyStrip1779(args: string): string {
  return args
    .replace(/\/[ixp]\s+"[^"]+"\s*/gi, '')
    .replace(/\/[ixp]\s+\{[^}]+\}\s*/gi, '')
    .replace(/\/[ixp]\s+\S+\.(msi|msp)\s*/gi, '')
    .replace(/\/[ixp]\s+/gi, '')
    .trim();
}

/**
 * Proves only the narrow old-to-new execution lineage. This does not authorize
 * insertion, adoption, a grant, dispatch or customer admission. The caller must
 * derive `current` from the exact trusted manifest and server defaults, and the
 * locked database transaction must independently enforce every admission gate.
 */
export function proveRepairProfileCorrection(input: RepairProfileCorrectionInput): LineageProof {
  if (input.contract !== 'exe-embedded-msi-target@1779') return denied('correction_contract_unknown');
  if (!/^[A-F0-9]{64}$/.test(input.expectedOldProfile) || !/^[A-F0-9]{64}$/.test(input.expectedNewProfile) ||
    input.expectedOldProfile !== input.old.candidatePackageProfileSha256 ||
    input.expectedNewProfile !== input.current.candidatePackageProfileSha256) return denied('profile_cas_mismatch');
  if (input.requiredPackagerCommit !== QA_PSADT_TOOLCHAIN.packagerCommit) return denied('required_pin_mismatch');
  const before = validateRecordedQaPackageProfile(input.old);
  const after = validateCurrentQaPackageProfile(input.current);
  if (!before.valid || !after.valid) return denied('profile_invalid');
  const old = record(JSON.parse(before.canonicalJson));
  const current = record(JSON.parse(after.canonicalJson));
  const oldInstaller = record(old?.installer), currentInstaller = record(current?.installer);
  const oldConfig = record(input.old.testConfig), currentConfig = record(input.current.testConfig);
  const toolchain = record(current?.toolchain);
  if (!old || !current || !oldInstaller || !currentInstaller || !oldConfig || !currentConfig ||
    old.profileKind !== 'deployment-config' || current.profileKind !== 'deployment-config' ||
    toolchain?.packagerCommit !== input.requiredPackagerCommit) return denied('profile_kind_or_pin_invalid');
  const args = currentInstaller.silentArgs, oldArgs = oldInstaller.silentArgs;
  // The fixed extractor must preserve an EXE argument tail, not strip an outer
  // launcher. Limit the legacy JS/Postgres comparison to printable ASCII.
  if (currentInstaller.sourceType !== 'exe' || oldInstaller.sourceType !== 'exe' ||
    typeof args !== 'string' || typeof oldArgs !== 'string' || !/^[\x20-\x7e]+$/.test(args) ||
    args === oldArgs || extractSilentSwitches(args, 'exe') !== args || legacyStrip1779(args) !== oldArgs) {
    return denied('correction_lineage_unproven');
  }
  const withoutCorrection = (profile: Record<string, unknown>): string => {
    const copy = structuredClone(profile);
    delete (copy.installer as Record<string, unknown>).silentArgs;
    delete (copy.toolchain as Record<string, unknown>).packagerCommit;
    return canonicalQaJson(copy);
  };
  if (withoutCorrection(old) !== withoutCorrection(current) ||
    canonicalQaJson(oldConfig.psadtConfig) !== canonicalQaJson(currentConfig.psadtConfig) ||
    canonicalQaJson(oldConfig.detectionRules) !== canonicalQaJson(currentConfig.detectionRules)) {
    return denied('unrelated_execution_change');
  }
  return {valid: true, oldProfile: before.packageProfileSha256, newProfile: after.packageProfileSha256};
}
