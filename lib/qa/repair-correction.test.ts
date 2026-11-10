import { beforeEach, expect, it, vi } from 'vitest';
import { adoptRepairCorrectedCandidate, parseRepairCorrectionRequest } from './repair-correction';
import { canonicalQaJson, normalizeQaWorkflowPackageInput, qaSha256 } from './package-profile';
import { buildQaCatalogTestConfig } from './test-config';
import { buildQaDeploymentTestConfig, QA_DEPLOYMENT_TEST_PSADT_CONFIG } from './deployment-test-config';
import { enforceInstallerPreflight } from '@/lib/installer-preflight';
import { arePackageDependenciesCovered } from './dependency-reputation';
vi.mock('@/lib/installer-preflight',()=>({enforceInstallerPreflight:vi.fn(async()=>({}))}));
vi.mock('./dependency-reputation',()=>({arePackageDependenciesCovered:vi.fn(async()=>true)}));
vi.mock('@/lib/winget-dependencies',async original=>({...await original<typeof import('@/lib/winget-dependencies')>(),resolveWingetPackageDependencies:vi.fn(async()=>[])}));
const rid='22222222-2222-4222-8222-222222222222',cid='33333333-3333-4333-8333-333333333333';
beforeEach(()=>vi.clearAllMocks());
function fixture(){
  const app={winget_id:'Example.App',name:'Example',publisher:'Example'};
  const installer={Architecture:'x64',InstallerType:'exe',InstallerUrl:'https://example.test/setup.exe',InstallerSha256:'A'.repeat(64),Scope:'machine',ProductCode:'{AD8A2FA1-06E7-4B0D-927D-6E54B3D31028}'};
  const manifest={PackageIdentifier:'Example.App',PackageVersion:'1',InstallerType:'exe',Scope:'machine',InstallerSwitches:{Silent:'/Q /C:"msiexec /i ""vcredist.msi"" /quiet /norestart"'},Installers:[installer]};
  const trusted=buildQaCatalogTestConfig({app:{...app,wingetId:app.winget_id,version:'1'},manifest,installer});
  const normalized=normalizeQaWorkflowPackageInput({wingetId:'Example.App',displayName:app.name,publisher:app.publisher,version:'1',architecture:'x64',installerSha256:installer.InstallerSha256,installerType:trusted.sourceInstallerType,silentSwitches:trusted.silentArgs,installerSuccessCodes:trusted.successCodes,uninstallCommand:trusted.uninstallCommand,installScope:trusted.scope,nestedInstallerType:trusted.nestedInstallerType,nestedInstallerPath:'',psadtConfig:JSON.stringify(QA_DEPLOYMENT_TEST_PSADT_CONFIG),detectionRules:'[]',packageDependencies:[]});
  const current=buildQaDeploymentTestConfig(normalized,[]),canonical=JSON.parse(current.packageProfileCanonicalJson);
  canonical.installer.silentArgs='/Q /C:"msiexec "" /quiet /norestart"';
  const json=canonicalQaJson(canonical),hash=qaSha256(json);
  const old={id:'11111111-1111-4111-8111-111111111111',winget_id:'Example.App',version:'1',architecture:'x64',installer_sha256:installer.InstallerSha256,installer_url:installer.InstallerUrl,package_profile_sha256:hash,test_config:{...current,packageProfileCanonicalJson:json,packageProfileSha256:hash,executionProfileSha256:hash}};
  const repair={id:rid,candidate_id:old.id,winget_id:'Example.App',version:'1',architecture:'x64',status:'in_progress',failure_class:'app_lifecycle',prior_requeues:0};
  const rows:Record<string,unknown>={qa_repair_requests:repair,qa_candidates:old,curated_apps:app,qa_recipes:null,qa_repair_profile_corrections:null};
  const from=vi.fn((table:string)=>{const q:Record<string,unknown>={};for(const m of ['select','eq'])q[m]=vi.fn(()=>q);q.maybeSingle=vi.fn(async()=>({data:rows[table],error:null}));return q;});
  const rpc=vi.fn(async()=>({data:cid,error:null}));
  const request={repairId:rid,contract:'exe-embedded-msi-target@1779' as const,expectedOldProfile:hash,expectedNewProfile:current.packageProfileSha256};
  return {rows,old,repair,request,rpc,db:{from,rpc} as never,client:{fetchInstallerManifest:vi.fn(async()=>manifest)}};
}
it('accepts exactly the four operator fields and rejects executable inputs',()=>{
  const f=fixture();expect(parseRepairCorrectionRequest(f.request)).toEqual(f.request);
  for(const key of ['silentArgs','candidate','psadtConfig','force','id'])expect(()=>parseRepairCorrectionRequest({...f.request,[key]:'unexpected'})).toThrow();
  for(const value of [null,[],{}, {...f.request,repairId:'not-a-uuid'}, {...f.request,expectedNewProfile:'a'.repeat(64)}, {...f.request,contract:'other'}])expect(()=>parseRepairCorrectionRequest(value)).toThrow();
});
it('derives the current profile and preflights before the single guarded RPC',async()=>{
  const f=fixture();expect(await adoptRepairCorrectedCandidate(f.db,f.client,f.request)).toEqual({outcome:'adopted',candidateId:cid});
  expect(enforceInstallerPreflight).toHaveBeenCalledOnce();expect(f.rpc).toHaveBeenCalledOnce();
  const [name,args]=f.rpc.mock.calls[0] as unknown as [string,{p_candidate:{test_config:{packageProfileCanonicalJson:string}}}];
  expect(name).toBe('adopt_qa_repair_corrected_candidate');
  expect(JSON.parse(args.p_candidate.test_config.packageProfileCanonicalJson).installer.silentArgs).toBe('/Q /C:"msiexec /i ""vcredist.msi"" /quiet /norestart"');
  expect(vi.mocked(enforceInstallerPreflight).mock.invocationCallOrder[0]).toBeLessThan(f.rpc.mock.invocationCallOrder[0]);
});
it('refuses stale CAS before fetching the manifest or running preflight',async()=>{
  const f=fixture();f.request.expectedOldProfile='B'.repeat(64);expect(await adoptRepairCorrectedCandidate(f.db,f.client,f.request)).toMatchObject({outcome:'denied'});
  expect(f.client.fetchInstallerManifest).not.toHaveBeenCalled();expect(enforceInstallerPreflight).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();
});
it('does not insert or preflight when clean covered reputation is missing',async()=>{
  const f=fixture();vi.mocked(arePackageDependenciesCovered).mockResolvedValueOnce(false);
  expect(await adoptRepairCorrectedCandidate(f.db,f.client,f.request)).toEqual({outcome:'denied',reason:'security_or_dependency_coverage_missing'});
  expect(f.rpc).not.toHaveBeenCalled();expect(enforceInstallerPreflight).not.toHaveBeenCalled();
});
it('does not insert when payload preflight rejects the manifest/hash/signature contract',async()=>{
  const f=fixture();vi.mocked(enforceInstallerPreflight).mockRejectedValueOnce(new Error('preflight refused'));
  await expect(adoptRepairCorrectedCandidate(f.db,f.client,f.request)).rejects.toThrow('preflight refused');expect(f.rpc).not.toHaveBeenCalled();
});
it('consumes an unchanged committed lineage idempotently without any new operation',async()=>{
  const f=fixture();f.repair.candidate_id=cid;f.repair.status='resolved';
  f.rows.qa_repair_profile_corrections={old_profile:f.request.expectedOldProfile,new_profile:f.request.expectedNewProfile,new_candidate_id:cid,contract:f.request.contract};
  expect(await adoptRepairCorrectedCandidate(f.db,f.client,f.request)).toEqual({outcome:'adopted',candidateId:cid});
  expect(f.client.fetchInstallerManifest).not.toHaveBeenCalled();expect(f.rpc).not.toHaveBeenCalled();expect(enforceInstallerPreflight).not.toHaveBeenCalled();
});
