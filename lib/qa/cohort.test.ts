import { describe, expect, it } from 'vitest';
import { auditQaCohort, strictEvidenceReason } from './cohort';
import { buildQaPackageIdentity, QA_PSADT_TOOLCHAIN, qaSha256 } from './package-profile';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

function fixture(commit = QA_PSADT_TOOLCHAIN.packagerCommit as string) {
  const identity = buildQaPackageIdentity({ profileKind: 'catalog-default', wingetId: 'Example.App',
    displayName: 'Example', publisher: 'Example', version: '1', architecture: 'x64', installerSha256: 'A'.repeat(64),
    sourceInstallerType: 'msi', silentArgs: '/qn', uninstallCommand: '', installScope: 'machine',
    psadtConfig: DEFAULT_PSADT_CONFIG, detectionRules: [], nestedInstallerFiles: [], nestedInstallerType: '' });
  const canonical = JSON.parse(identity.canonicalJson);
  canonical.toolchain.packagerCommit = commit;
  const text = JSON.stringify(canonical);
  const c = { status: 'passed', test_level: 'psadt-package', winget_id: 'Example.App', version: '1', architecture: 'x64',
    installer_sha256: 'A'.repeat(64), package_profile_sha256: qaSha256(text), github_run_id: '12345',
    finished_at: '2026-09-20T12:00:00Z', test_config: { mode: 'psadt-package', profileKind: 'catalog-default',
      packageProfileCanonicalJson: text, packageProfileSha256: qaSha256(text) } };
  const r = { ...c, tested_version: '1', outcome: 'Passed', packager_commit: commit, tested_at_utc: c.finished_at,
    phase_results: { install: { exitCode: 0 }, detectionAfterInstall: { exitCode: 0 }, uninstall: { exitCode: 0 }, detectionAfterUninstall: { exitCode: 1 } },
    environment: { executionContext: 'LocalSystem' }, virustotal_status: 'clean', virustotal_malicious: 0, virustotal_suspicious: 0 };
  return { c, r, input: { candidates: [c], results: [r], deployedIds: ['Example.App'], blockedIds: [], blockedPayloads: [] } };
}

describe('authoritative cohort audit', () => {
  it('preserves an unaffected strict pass across an approved packager promotion', () => {
    const { input } = fixture('e7410e97df040bd38f11842ccf259abd9bc757f7');
    expect(auditQaCohort(input)).toMatchObject({ strictCount: 1, currentPinCount: 0 });
  });
  it('never counts status-only, user-context, or unknown security results', () => {
    const { c, r } = fixture();
    expect(strictEvidenceReason(c, undefined)).toBe('missingExactResult');
    expect(strictEvidenceReason(c, { ...r, environment: { executionContext: 'User' } })).toBe('executionContext');
    expect(strictEvidenceReason(c, { ...r, virustotal_status: 'not_found' })).toBe('virusTotalNotClean');
    expect(strictEvidenceReason(c, { ...r, github_run_id: '999' })).toBe('runMismatch');
    expect(strictEvidenceReason(c, { ...r, installer_sha256: 'B'.repeat(64) })).toBe('tupleMismatch');
  });
  it('excludes historical passes, blocked payloads, and apps without customer demand', () => {
    const { c, input } = fixture();
    expect(auditQaCohort({ ...input, deployedIds: [] }).strictCount).toBe(0);
    expect(auditQaCohort({ ...input, blockedPayloads: [c] }).strictCount).toBe(0);
    expect(auditQaCohort({ ...input, candidates: [{ ...c, finished_at: '2026-08-29T12:00:00Z' }, c] }).strictCount).toBe(0);
  });
  it('rejects unapproved pins while counting distinct application IDs only once', () => {
    expect(auditQaCohort(fixture('f'.repeat(40)).input).strictCount).toBe(0);
    const { c, input } = fixture();
    expect(auditQaCohort({ ...input, candidates: [c, c] }).strictCount).toBe(1);
  });
  it('accepts legacy URL-only run identity but rejects wrong repositories and conflicting IDs', () => {
    const { c, r } = fixture();
    const github_run_url = 'https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/12345';
    expect(strictEvidenceReason(c, { ...r, github_run_id: null, github_run_url })).toBeNull();
    expect(strictEvidenceReason(c, { ...r, github_run_id: null, github_run_url: github_run_url.replace('ugurkocde', 'untrusted') })).toBe('runMismatch');
    expect(strictEvidenceReason(c, { ...r, github_run_url: github_run_url.replace('12345', '999') })).toBe('runMismatch');
  });
  it('does not count a historical app as new when its old detailed result was replaced', () => {
    const { c, input } = fixture();
    const historical = { ...c, finished_at: '2026-08-29T12:00:00Z', package_profile_sha256: 'B'.repeat(64) };
    expect(auditQaCohort({ ...input, candidates: [historical, c] }).strictCount).toBe(0);
  });
});
