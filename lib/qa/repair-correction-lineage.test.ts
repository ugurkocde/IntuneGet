import { describe, expect, it } from 'vitest';
import { proveRepairProfileCorrection } from './repair-correction-lineage';
import { canonicalQaJson, normalizeQaWorkflowPackageInput, qaSha256, QA_PSADT_TOOLCHAIN } from './package-profile';
import { buildQaDeploymentTestConfig, QA_DEPLOYMENT_TEST_PSADT_CONFIG } from './deployment-test-config';

const fixedArgs = '/Q /C:"msiexec /i ""vcredist.msi"" /quiet /norestart"';
const brokenArgs = '/Q /C:"msiexec "" /quiet /norestart"';
function fixture(architecture = 'x64') {
  const normalized = normalizeQaWorkflowPackageInput({
    wingetId: `Microsoft.VCRedist.2005.${architecture}`, displayName: 'VC2005', publisher: 'Microsoft',
    version: architecture === 'x64' ? '8.0.61000' : '8.0.61001', architecture,
    installerSha256: 'A'.repeat(64), installerType: 'exe', silentSwitches: fixedArgs,
    uninstallCommand: 'REGISTRY_UNINSTALL_PRODUCT:{AD8A2FA1-06E7-4B0D-927D-6E54B3D31028}:VC2005',
    installScope: 'machine', psadtConfig: JSON.stringify(QA_DEPLOYMENT_TEST_PSADT_CONFIG), detectionRules: '[]',
  });
  const currentConfig = buildQaDeploymentTestConfig(normalized, []);
  const canonical = JSON.parse(normalized.identity.canonicalJson);
  canonical.installer.silentArgs = brokenArgs;
  const oldJson = canonicalQaJson(canonical), oldHash = qaSha256(oldJson);
  const oldConfig = { ...currentConfig, packageProfileCanonicalJson: oldJson, packageProfileSha256: oldHash, executionProfileSha256: oldHash };
  const tuple = { candidateWingetId: `Microsoft.VCRedist.2005.${architecture}`, candidateVersion: normalized.identity.profile.app && (normalized.identity.profile.app as {version:string}).version, candidateArchitecture: architecture, candidateInstallerSha256: 'A'.repeat(64) };
  return {
    contract: 'exe-embedded-msi-target@1779', expectedOldProfile: oldHash,
    expectedNewProfile: normalized.identity.packageProfileSha256, requiredPackagerCommit: QA_PSADT_TOOLCHAIN.packagerCommit,
    old: { ...tuple, testConfig: oldConfig, candidatePackageProfileSha256: oldHash },
    current: { ...tuple, testConfig: currentConfig, candidatePackageProfileSha256: normalized.identity.packageProfileSha256 },
  };
}
function change(input: ReturnType<typeof fixture>, side: 'old'|'current', mutate: (p: Record<string, any>) => void) {
  const witness = input[side], config = witness.testConfig;
  const p = JSON.parse(config.packageProfileCanonicalJson); mutate(p);
  p.psadtConfigSha256 = qaSha256(canonicalQaJson(p.psadtConfig));
  p.detectionRulesSha256 = qaSha256(canonicalQaJson(p.detectionRules));
  const json = canonicalQaJson(p), hash = qaSha256(json);
  Object.assign(config, {packageProfileCanonicalJson: json, packageProfileSha256: hash, executionProfileSha256: hash,
    psadtConfigSha256: p.psadtConfigSha256, detectionRulesSha256: p.detectionRulesSha256});
  witness.candidatePackageProfileSha256 = hash;
  if (side === 'old') input.expectedOldProfile = hash; else input.expectedNewProfile = hash;
}
describe('corrected repair profile lineage, with no admission side effects', () => {
  it.each(['x64','x86'])('recognizes the exact VC2005 %s corruption without changing either witness', architecture => {
    const f = fixture(architecture), before = structuredClone(f);
    expect(proveRepairProfileCorrection(f)).toEqual({valid: true, oldProfile: f.expectedOldProfile, newProfile: f.expectedNewProfile});
    expect(f).toEqual(before);
  });
  it.each(['contract','expectedOldProfile','expectedNewProfile','requiredPackagerCommit'] as const)('rejects a mismatched %s', field => {
    const f=fixture(); f[field]='invalid'; expect(proveRepairProfileCorrection(f).valid).toBe(false);
  });
  it('rejects tampered canonical bytes even when CAS values are unchanged', () => {
    const f=fixture();f.old.testConfig.packageProfileCanonicalJson+=' ';expect(proveRepairProfileCorrection(f).valid).toBe(false);
  });
  it.each(['arbitrary','non-ascii','outer-msiexec','msi','wix','unchanged'])('rejects the %s argument contract', kind => {
    const f=fixture();change(f,'current',p=>{
      if(kind==='msi'||kind==='wix')p.installer.sourceType=kind;
      else p.installer.silentArgs=kind==='arbitrary'?'/quiet /norestart':kind==='non-ascii'?fixedArgs+' é':kind==='outer-msiexec'?'msiexec.exe /i "vcredist.msi" /quiet':brokenArgs;
    });expect(proveRepairProfileCorrection(f).valid).toBe(false);
  });
  it.each(['uninstall','scope','successCodes','detection','psadt','dependencies','app','toolchain'])('rejects additional %s drift', kind => {
    const f=fixture();change(f,'current',p=>{
      if(kind==='uninstall')p.installer.uninstallCommand='REGISTRY_UNINSTALL:Other';
      if(kind==='scope')p.installer.installScope='user';
      if(kind==='successCodes')p.installer.successCodes=[0,3010];
      if(kind==='detection')p.detectionRules=[];
      if(kind==='psadt')p.psadtConfig.removeExistingInstall=true;
      if(kind==='dependencies')p.packageDependencies=[{wingetId:'Other.App'}];
      if(kind==='app')p.app.version='2';
      if(kind==='toolchain')p.toolchain.templateSha256='B'.repeat(64);
    });expect(proveRepairProfileCorrection(f).valid).toBe(false);
  });
  it('allows only a previously recognized pin moving to the current required pin',()=>{
    const f=fixture();change(f,'old',p=>{p.toolchain.packagerCommit='25849ac512c211e616c135149ef1e059db367ebc';});
    expect(proveRepairProfileCorrection(f).valid).toBe(true);
    change(f,'current',p=>{p.toolchain.packagerCommit='25849ac512c211e616c135149ef1e059db367ebc';});
    expect(proveRepairProfileCorrection(f).valid).toBe(false);
  });
});
