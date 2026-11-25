import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import {
  buildQaPackageIdentity, canonicalQaJson, qaSha256, QA_PACKAGER_RELEASE_HISTORY,
  QA_PSADT_TOOLCHAIN, validateCompatiblePassedDeploymentQaProfile,
} from './package-profile';
import { terminalToolchainRetryTargets } from './toolchain-backfill';

const oldPin = '1cc5fb513cf3c23120f2b0741d66f11ee435d409';
const newPin = '37cbdcdbbaedf092b39e18777c44c8d613725e14';
function check(config = {}, sourceType = 'exe', nestedType = '', priorPin = oldPin) {
  const current = buildQaPackageIdentity({
    profileKind: 'deployment-config', wingetId: 'Synthetic.Hook', displayName: 'Fixture',
    publisher: 'Fixture', version: '1.0', architecture: 'x64', installerSha256: 'a'.repeat(64),
    sourceInstallerType: sourceType, silentArgs: '/S', uninstallCommand: 'REGISTRY_UNINSTALL:Fixture',
    installScope: 'machine', nestedInstallerType: nestedType, nestedInstallerFiles: [],
    psadtConfig: { ...DEFAULT_PSADT_CONFIG, ...config }, detectionRules: [],
  });
  const priorProfile = JSON.parse(current.canonicalJson);
  priorProfile.toolchain.packagerCommit = priorPin;
  const canonical = canonicalQaJson(priorProfile), hash = qaSha256(canonical);
  return validateCompatiblePassedDeploymentQaProfile({
    prior: { testConfig: { profileKind: 'deployment-config', packageProfileCanonicalJson: canonical,
      packageProfileSha256: hash }, candidatePackageProfileSha256: hash,
      candidateWingetId: 'Synthetic.Hook', candidateVersion: '1.0', candidateArchitecture: 'x64',
      candidateInstallerSha256: 'a'.repeat(64) },
    currentCanonicalJson: current.canonicalJson, currentPackageProfileSha256: current.packageProfileSha256,
  });
}
describe('coupled hook activation compatibility', () => {
  it('keeps the predecessor and the new current release ordered once', () => {
    expect(QA_PSADT_TOOLCHAIN.packagerCommit).toBe(newPin);
    expect(QA_PACKAGER_RELEASE_HISTORY.slice(-2)).toEqual([oldPin, newPin]);
    expect(new Set(QA_PACKAGER_RELEASE_HISTORY).size).toBe(QA_PACKAGER_RELEASE_HISTORY.length);
  });
  it.each(['postInstallPowerShell', 'postUninstallPowerShell'])('rejects old passes with identical nonempty %s', field => {
    expect(check({ [field]: "Write-Output 'fixture'" })).toEqual({ valid: false, reason: 'compatible-powershell-hook-changed' });
  });
  it('retains unrelated zero-hook and whitespace-hook profiles', () => {
    expect(check()).toMatchObject({ valid: true });
    expect(check({ postInstallPowerShell: ' \r\n\t', postUninstallPowerShell: '' })).toMatchObject({ valid: true });
  });
  it('does not invalidate hook coverage already produced at the new release', () => {
    expect(check({ postInstallPowerShell: "Write-Output 'fixture'" }, 'exe', '', newPin)).toMatchObject({ valid: true });
  });
  it.each([['msi', ''], ['wix', ''], ['zip', 'msi'], ['zip', 'wix']])('rejects changed %s/%s override behavior', (type, nested) => {
    expect(check({ reviewedInstallArgumentsOverride: '/S' }, type, nested)).toEqual({ valid: false, reason: 'compatible-msi-reviewed-override-changed' });
  });
  it('retains unchanged MSI-form and executable override behavior', () => {
    expect(check({ reviewedInstallArgumentsOverride: '/qn PROP=1' }, 'msi')).toMatchObject({ valid: true });
    expect(check({ reviewedInstallArgumentsOverride: '/QUIET PROP="two words"' }, 'zip', 'wix')).toMatchObject({ valid: true });
    expect(check({ reviewedInstallArgumentsOverride: '/S' }, 'exe')).toMatchObject({ valid: true });
  });
  it('carries only the existing fixed retry targets, without adding apps', () => {
    expect(terminalToolchainRetryTargets(newPin)).toEqual(terminalToolchainRetryTargets(oldPin));
  });
  it('keeps the MSI compatibility pattern equal to the pinned generator guard', () => {
    const generator = readFileSync('.github/scripts/Create-PSADTPackage.ps1', 'utf8');
    const profile = readFileSync('lib/qa/package-profile.ts', 'utf8');
    const pattern = generator.match(/^\$msiReviewedOverridePattern = '([^']+)'/m)?.[1];
    expect(pattern).toBeTruthy();
    expect(profile).toContain('new RegExp(String.raw`' + pattern + "`, 'i')");
  });
});
