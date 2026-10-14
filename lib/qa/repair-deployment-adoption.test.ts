import { expect,it,vi } from 'vitest';
import { adoptRepairCurrentCandidate } from './repair-adoption';
import { normalizeQaWorkflowPackageInput,canonicalQaJson,qaSha256 } from './package-profile';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import * as profiles from './package-profile';

vi.mock('@/lib/winget-dependencies',async original=>({...await original<typeof import('@/lib/winget-dependencies')>(),resolveWingetPackageDependencies:vi.fn(async()=>[])}));
const hash='A'.repeat(64),repairId='22222222-2222-4222-8222-222222222222';
function fixture() {
 const normalized=normalizeQaWorkflowPackageInput({wingetId:'Example.App',displayName:'Example',publisher:'Example',version:'1',architecture:'x64',installerSha256:hash,installerType:'exe',silentSwitches:'/quiet',uninstallCommand:'REGISTRY_UNINSTALL:Example',installScope:'machine',detectionRules:'[]',psadtConfig:JSON.stringify({...DEFAULT_PSADT_CONFIG,deployMode:'Auto',progressDialog:{enabled:true,statusMessage:'IntuneGet is validating this application package.',windowLocation:'BottomRight'}})});
 const prior=JSON.parse(normalized.identity.canonicalJson);prior.toolchain.packagerCommit='25849ac512c211e616c135149ef1e059db367ebc';const canonical=canonicalQaJson(prior),profile=qaSha256(canonical);
 const config={mode:'psadt-package',profileKind:'deployment-config',packageProfileCanonicalJson:canonical,packageProfileSha256:profile,executionProfileSha256:profile,psadtConfigSha256:normalized.identity.psadtConfigSha256,detectionRulesSha256:normalized.identity.detectionRulesSha256,psadtConfig:normalized.psadtConfig,detectionRules:normalized.detectionRules};
 const old={id:'old',winget_id:'Example.App',version:'1',architecture:'x64',installer_sha256:hash,installer_url:'https://example.test/setup.exe',package_profile_sha256:profile,test_config:config};
 const rows:Record<string,unknown>={qa_candidates:old,qa_repair_requests:{id:repairId,candidate_id:'old',winget_id:'Example.App',version:'1',architecture:'x64',status:'in_progress',failure_class:'app_lifecycle',prior_requeues:0},curated_apps:{winget_id:'Example.App',name:'Example',publisher:'Example',latest_version:'2'},qa_recipes:null};
 const from=vi.fn((table:string)=>{const q:Record<string,unknown>={};for(const m of ['select','eq'])q[m]=vi.fn(()=>q);q.maybeSingle=vi.fn(async()=>({data:rows[table],error:null}));return q;});
 const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>name==='insert_qa_candidate_if_absent'?{data:{outcome:'inserted',candidate:{...args.p_candidate as object,id:'new'}},error:null}:{data:'new',error:null});
 const manifest={PackageIdentifier:'Example.App',PackageVersion:'1',InstallerType:'exe',InstallerSwitches:{Silent:'/quiet'},Installers:[{Architecture:'x64',InstallerSha256:hash,InstallerUrl:old.installer_url}]};
 return{old,normalized,db:{from,rpc} as never,rpc,client:{fetchInstallerManifest:vi.fn(async()=>manifest)}};
}
it('adopts a verified deployment profile whose scope is only in its hashed canonical',async()=>{
 const f=fixture();expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toEqual({outcome:'adopted',candidateId:'new'});
 const config=(f.rpc.mock.calls[0][1].p_candidate as Record<string,unknown>).test_config as Record<string,unknown>;
 expect(config.profileKind).toBe('deployment-config');expect(config.scope).toBeUndefined();
 const old=JSON.parse(f.old.test_config.packageProfileCanonicalJson),current=JSON.parse(config.packageProfileCanonicalJson as string);delete old.toolchain.packagerCommit;delete current.toolchain.packagerCommit;expect(current).toEqual(old);
 expect(config.psadtConfig).toEqual(f.old.test_config.psadtConfig);expect(config.detectionRules).toEqual(f.old.test_config.detectionRules);
});
it('rejects a tampered historical deployment canonical before inserting anything',async()=>{
 const f=fixture();f.old.test_config.packageProfileCanonicalJson+=' ';expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({outcome:'denied',reason:'recorded_profile_invalid'});expect(f.rpc).not.toHaveBeenCalled();
});
type Witness = { schemaVersion:number;toolchain:Record<string,unknown>;installer:Record<string,unknown>;psadtConfig:Record<string,unknown>;detectionRules:unknown[];psadtConfigSha256:string;detectionRulesSha256:string };
function changeWitness(f:ReturnType<typeof fixture>,change:(profile:Witness)=>void) {
 const p=JSON.parse(f.old.test_config.packageProfileCanonicalJson);change(p);
 p.psadtConfigSha256=qaSha256(canonicalQaJson(p.psadtConfig));p.detectionRulesSha256=qaSha256(canonicalQaJson(p.detectionRules));
 const canonical=canonicalQaJson(p),hash=qaSha256(canonical);Object.assign(f.old.test_config,{packageProfileCanonicalJson:canonical,packageProfileSha256:hash,executionProfileSha256:hash,psadtConfigSha256:p.psadtConfigSha256,detectionRulesSha256:p.detectionRulesSha256});f.old.package_profile_sha256=hash;
}
it.each(['silentArgs','uninstallCommand'])('does not carry a customer %s override from a valid historical canonical',async field=>{
 const f=fixture();changeWitness(f,p=>{p.installer[field]='customer-command';});expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({reason:'recorded_profile_unverifiable'});expect(f.rpc).not.toHaveBeenCalled();
});
it('rejects customer detection rules even when their recorded hash validates',async()=>{
 const f=fixture();changeWitness(f,p=>{p.detectionRules.push({type:'file',path:'C:\\customer',fileOrFolderName:'arbitrary'});});expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({reason:'execution_profile_changed'});expect(f.rpc).not.toHaveBeenCalled();
});
it('does not publish customer branding retained in a historical presentation',async()=>{
 const f=fixture();Object.assign(f.old.test_config.psadtConfig,{appName:'Contoso'});expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({reason:'execution_profile_changed'});expect(f.rpc).not.toHaveBeenCalled();
});
it('denies changed normalization without a catalog-default fallback',async()=>{
 const f=fixture(),original=profiles.normalizeQaWorkflowPackageInput;const spy=vi.spyOn(profiles,'normalizeQaWorkflowPackageInput').mockImplementation(input=>{const n=original(input),p=JSON.parse(n.identity.canonicalJson);p.installer.silentArgs+=' /drift';n.identity.canonicalJson=canonicalQaJson(p);n.identity.packageProfileSha256=qaSha256(n.identity.canonicalJson);return n;});
 try{expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({reason:'execution_profile_changed'});expect(f.rpc).not.toHaveBeenCalled();}finally{spy.mockRestore();}
});
it('denies a user-scope witness when the manifest provides only a machine installer',async()=>{
 const f=fixture();changeWitness(f,p=>{p.installer.installScope='user';});expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({reason:'recorded_profile_unverifiable'});expect(f.rpc).not.toHaveBeenCalled();
});
it('denies drift in server-resolved dependencies',async()=>{
 const f=fixture();changeWitness(f,p=>{p.installer.packageDependencies=[{packageIdentifier:'Example.Dependency',version:'1',sha256:'B'.repeat(64),fileName:'dependency.exe'}];p.installer.dependenciesSha256=qaSha256(canonicalQaJson(p.installer.packageDependencies));});expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({reason:'execution_profile_changed'});expect(f.rpc).not.toHaveBeenCalled();
});
it.each(['pin','schema'])('rejects an unapproved historical %s',async field=>{
 const f=fixture();changeWitness(f,p=>{if(field==='pin')p.toolchain.packagerCommit='f'.repeat(40);else p.schemaVersion=3;});expect(await adoptRepairCurrentCandidate(f.db,f.client,repairId)).toMatchObject({reason:'recorded_profile_invalid'});expect(f.rpc).not.toHaveBeenCalled();
});
