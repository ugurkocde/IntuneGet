import { createHash } from 'node:crypto';
import { QA_PSADT_TOOLCHAIN, validateCompatiblePassedCatalogQaProfile } from './package-profile';

export const QA_COHORT_BOUNDARY = '2026-08-30T08:28:35Z';
export const QA_COHORT_TARGET = 500;
type Row = Record<string, unknown>;
const object = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const norm = (v: unknown) => typeof v === 'string' ? v.trim().toLowerCase() : '';

export function strictEvidenceReason(candidate: Row, result: Row | undefined): string | null {
  if (!result) return 'missingExactResult';
  const config = object(candidate.test_config);
  let profile: Row;
  try { profile = JSON.parse(String(config.packageProfileCanonicalJson)); }
  catch { return 'missingCanonicalProfile'; }
  if (candidate.status !== 'passed' || result.outcome !== 'Passed' ||
      candidate.test_level !== 'psadt-package' || config.mode !== 'psadt-package' ||
      profile.testLevel !== 'psadt-package') return 'packageMode';
  if (norm(candidate.winget_id) !== norm(result.winget_id) || candidate.version !== result.tested_version ||
      norm(candidate.architecture) !== norm(result.architecture) ||
      norm(candidate.installer_sha256) !== norm(result.installer_sha256) ||
      norm(candidate.package_profile_sha256) !== norm(result.package_profile_sha256)) return 'tupleMismatch';
  if (!/^[a-f0-9]{64}$/.test(norm(candidate.installer_sha256)) ||
      createHash('sha256').update(String(config.packageProfileCanonicalJson)).digest('hex') !== norm(candidate.package_profile_sha256) ||
      norm(object(profile.installer).sha256) !== norm(candidate.installer_sha256) ||
      norm(object(profile.app).wingetId) !== norm(candidate.winget_id) ||
      object(profile.app).version !== candidate.version ||
      norm(object(profile.app).architecture) !== norm(candidate.architecture)) return 'profileHashMismatch';
  const phases = object(result.phase_results);
  for (const [name, code] of Object.entries({ install: 0, detectionAfterInstall: 0, uninstall: 0, detectionAfterUninstall: 1 })) {
    const phase = object(phases[name]);
    if (phase.exitCode !== code || phase.timedOut === true) return 'lifecycleTuple';
  }
  if (object(result.environment).executionContext !== 'LocalSystem') return 'executionContext';
  if (result.virustotal_status !== 'clean' || result.virustotal_malicious !== 0 || result.virustotal_suspicious !== 0) return 'virusTotalNotClean';
  if (norm(object(profile.toolchain).packagerCommit) !== norm(result.packager_commit)) return 'resultPinMismatch';
  // Published results historically stored the canonical run URL without filling
  // github_run_id. Accept that exact trusted-repository identity, never an
  // arbitrary URL suffix or conflicting ID/URL pair.
  const urlRun = typeof result.github_run_url === 'string'
    ? result.github_run_url.match(/^https:\/\/github\.com\/ugurkocde\/IntuneGet-Workflows\/actions\/runs\/([1-9][0-9]*)\/?$/i)?.[1]
    : undefined;
  const resultRun = result.github_run_id || urlRun;
  if (!/^[1-9][0-9]*$/.test(String(candidate.github_run_id)) || candidate.github_run_id !== resultRun ||
      (result.github_run_id && result.github_run_url && urlRun !== result.github_run_id)) return 'runMismatch';
  if (!Number.isFinite(Date.parse(String(candidate.finished_at))) ||
      !Number.isFinite(Date.parse(String(result.tested_at_utc)))) return 'missingTimestamp';
  return null;
}

/** Shared approved release history and its per-profile invalidation rules are authoritative. */
export function auditQaCohort(input: {
  candidates: Row[]; results: Row[]; deployedIds: string[];
  blockedIds: string[]; blockedPayloads: Row[]; boundary?: string;
}) {
  const boundary = input.boundary || QA_COHORT_BOUNDARY;
  const resultByProfile = new Map(input.results.map(r => [norm(r.package_profile_sha256), r]));
  const rejected: Record<string, number> = {};
  const reject = (reason: string) => { rejected[reason] = (rejected[reason] || 0) + 1; };
  const strict = input.candidates.filter(c => {
    const reason = strictEvidenceReason(c, resultByProfile.get(norm(c.package_profile_sha256)));
    if (reason) reject(reason);
    return !reason;
  });
  // Conservative baseline: a previous PSADT pass can exclude an app but never
  // grant new cohort credit. Result rows are upserted; losing the old detailed
  // evidence must not make a historically tested app appear new after a rerun.
  const historical = new Set(input.candidates.filter(c => c.status === 'passed' &&
    c.test_level === 'psadt-package' && Date.parse(String(c.finished_at)) <= Date.parse(boundary)).map(c => norm(c.winget_id)));
  const deployed = new Set(input.deployedIds.map(norm));
  const blocked = new Set(input.blockedIds.map(norm));
  const payloadKey = (c: Row) => JSON.stringify([norm(c.winget_id), c.version, norm(c.architecture), norm(c.installer_sha256)]);
  const blockedPayloads = new Set(input.blockedPayloads.map(payloadKey));
  const accepted = new Map<string, Row>();
  let currentPinCount = 0;
  const currentPinIds = new Set<string>();
  for (const c of strict) {
    const id = norm(c.winget_id);
    if (Date.parse(String(c.finished_at)) <= Date.parse(boundary) || historical.has(id)) continue;
    if (!deployed.has(id)) { reject('notCustomerDeployed'); continue; }
    if (blocked.has(id) || blockedPayloads.has(payloadKey(c))) { reject('blocked'); continue; }
    const validation = validateCompatiblePassedCatalogQaProfile({
      testConfig: c.test_config, candidatePackageProfileSha256: c.package_profile_sha256,
      candidateWingetId: c.winget_id, candidateVersion: c.version,
      candidateArchitecture: c.architecture, candidateInstallerSha256: c.installer_sha256,
    });
    if (!validation.valid) { reject(validation.reason); continue; }
    const previous = accepted.get(id);
    if (!previous || Date.parse(String(c.finished_at)) > Date.parse(String(previous.finished_at))) accepted.set(id, c);
    if (resultByProfile.get(norm(c.package_profile_sha256))?.packager_commit === QA_PSADT_TOOLCHAIN.packagerCommit) currentPinIds.add(id);
  }
  currentPinCount = currentPinIds.size;
  return {
    boundaryUtc: boundary, target: QA_COHORT_TARGET, policyVersion: 2,
    policy: 'strict-evidence-approved-compatible-release-lineage',
    historicalExclusionPolicy: 'conservative-preboundary-psadt-pass-record',
    strictCount: accepted.size, currentPinCount,
    remaining: Math.max(0, QA_COHORT_TARGET - accepted.size),
    requiredPin: QA_PSADT_TOOLCHAIN.packagerCommit,
    latestStrictFinish: [...accepted.values()].map(c => String(c.finished_at)).sort().at(-1) || null,
    auditedPassedCandidates: input.candidates.length, rejectedReasons: rejected,
  };
}
