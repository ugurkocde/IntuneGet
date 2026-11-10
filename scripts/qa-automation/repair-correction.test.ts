import fs from 'node:fs';
import crypto from 'node:crypto';
import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

it('preserves atomic adoption, lineage, customer and repair gates for corrected profiles',async()=>{
  const {pg}=await historicalFixture();
  const read=(name:string)=>fs.readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
  try{
    await pg.exec('create table public.qa_installer_security_holds(sha256 text,released_at timestamptz); grant all on public.qa_installer_security_holds to service_role;');
    for(const n of ['20261012200751_qa_repair_current_profile_adoption.sql','20261012225940_qa_deployment_profile_adoption.sql','20261014222100_qa_terminal_failure_retest_guards.sql','20261007224438_qa_candidate_conflict_free_insert.sql'])await pg.exec(read(n));
    const dep=read('20261019125457_qa_vt_dependency_lookup.sql');
    const coverage=dep.slice(dep.indexOf('create function public.qa_vt_dependency_coverage'));
    await pg.exec(coverage.slice(0,coverage.indexOf('$$;')+3));
    await pg.exec('revoke all on function public.qa_vt_dependency_coverage(uuid) from public,anon,authenticated;grant execute on function public.qa_vt_dependency_coverage(uuid) to service_role;');
    const migration=read('20261110051729_qa_corrected_profile_repair.sql');
    await pg.exec(migration);
    const old='11111111-1111-4111-8111-111111111111',repair='22222222-2222-4222-8222-222222222222',hash='A'.repeat(64),pin='b'.repeat(40);
    const args='/Q /C:"msiexec /i ""vcredist.msi"" /quiet /norestart"';
    const canon=(silentArgs:string)=>JSON.stringify({profileKind:'deployment-config',toolchain:{packagerCommit:pin},installer:{sourceType:'exe',installScope:'machine',silentArgs},psadtConfig:{},detectionRules:[]});
    const before=canon('/Q /C:"msiexec "" /quiet /norestart"'),after=canon(args);
    const digest=(s:string)=>crypto.createHash('sha256').update(s).digest('hex').toUpperCase();
    const beforeHash=digest(before),afterHash=digest(after);
    const config=(json:string)=>({profileKind:'deployment-config',packageProfileCanonicalJson:json,packageProfileSha256:digest(json),psadtConfig:{},detectionRules:[]});
    const candidate={winget_id:'Example.App',version:'1',architecture:'x64',installer_url:'https://example.test/setup.exe',installer_sha256:hash,installer_type:'exe',installer_file_name:'setup.exe',test_level:'psadt-package',package_profile_sha256:afterHash,test_config:config(after)};
    const call=(newCandidate=candidate,oldCas=beforeHash,newCas=afterHash,contract='exe-embedded-msi-target@1779')=>pg.query<{id:string}>('select public.adopt_qa_repair_corrected_candidate($1,$2,$3,$4,$5) as id',[repair,newCandidate,oldCas,newCas,contract]);
    async function seed(){
      await pg.query("insert into public.qa_pipeline_control(id,paused,required_packager_commit,scheduler_packager_commit,scheduler_seen_at) values('global',false,$1,$1,now())",[pin]);
      await pg.query("insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,installer_url,test_level,package_profile_sha256,test_config,status,phase,finished_at) values($1,'Example.App','1','x64',$2,$3,'psadt-package',$4,$5,'failed','publishing',now())",[old,hash,candidate.installer_url,beforeHash,config(before)]);
      await pg.query("insert into public.qa_repair_requests(id,candidate_id,winget_id,version,architecture,failure_class,status,prior_requeues) values($1,$2,'Example.App','1','x64','app_lifecycle','in_progress',0)",[repair,old]);
      await pg.query("insert into public.qa_package_results(package_profile_sha256,winget_id,tested_version,architecture,installer_sha256,outcome) values($1,'Example.App','1','x64',$2,'Failed')",[beforeHash,hash]);
      await pg.query("insert into public.qa_package_blocks(winget_id,version,architecture,installer_sha256,block_code) values('Example.App','1','x64',$1,'failed_managed_lifecycle')",[hash]);
      await pg.query("insert into public.catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,engine_count_version,checked_at,analyzed_at,retry_after) values(lower($1),'found',0,0,70,2,now(),now(),now()+interval '1 day')",[hash]);
    }
    await pg.exec('begin');await seed();await pg.exec('set local role service_role');
    const id=(await call()).rows[0].id;
    expect(id).not.toBe(old);expect((await call()).rows[0].id).toBe(id);
    expect((await pg.query('select status,priority from public.qa_candidates where id=$1',[id])).rows[0]).toEqual({status:'superseded',priority:10});
    expect((await pg.query('select status,prior_requeues,candidate_id from public.qa_repair_requests')).rows[0]).toEqual({status:'in_progress',prior_requeues:0,candidate_id:id});
    expect((await pg.query('select count(*)::int n from public.qa_retest_grants')).rows[0]).toEqual({n:0});
    await pg.query("select public.create_qa_retest_grant($1,now()+interval '1 hour','corrected profile fixture')",[id]);
    await pg.query("update public.qa_candidates set status='running',phase='installing' where id=$1",[id]);
    await pg.query("select public.report_qa_candidate_result('local-fixture-only',$1,'failed','managed lifecycle fixture')",[id]);
    expect((await pg.query('select status,prior_requeues from public.qa_repair_requests')).rows[0]).toEqual({status:'pending',prior_requeues:1});
    await pg.query("select public.create_qa_retest_grant($1,now()+interval '1 hour','corrected profile fixture')",[id]);
    await pg.query("update public.qa_candidates set status='running',phase='installing' where id=$1",[id]);
    await pg.query("select public.report_qa_candidate_result('local-fixture-only',$1,'passed',null)",[id]);
    expect((await pg.query('select status,prior_requeues from public.qa_repair_requests')).rows[0]).toEqual({status:'resolved',prior_requeues:1});
    expect((await pg.query('select count(*)::int n from public.qa_package_blocks')).rows[0]).toEqual({n:1});
    expect((await pg.query('select count(*)::int n from public.curated_apps')).rows[0]).toEqual({n:0});
    expect((await pg.query('select status,package_profile_sha256 from public.qa_candidates where id=$1',[old])).rows[0]).toEqual({status:'failed',package_profile_sha256:beforeHash});
    await expect(call(candidate,'F'.repeat(64))).rejects.toThrow(/lineage/);
    await pg.exec('rollback');
    const denials=[
      "delete from public.qa_package_blocks",
      "delete from public.qa_package_results",
      "update public.qa_repair_requests set prior_requeues=3",
      "update public.qa_pipeline_control set scheduler_seen_at=now()-interval '10 minutes'",
      "update public.qa_pipeline_control set paused=true",
      "update public.qa_pipeline_control set scheduler_packager_commit=repeat('a',40)",
      "update public.catalog_file_reputation set malicious=1",
      "update public.catalog_file_reputation set checked_at=now()-interval '8 days'",
      "update public.catalog_file_reputation set total_engines=0",
      "insert into public.qa_installer_security_holds(sha256) values(lower(repeat('A',64)))",
      "insert into public.package_eligibility_blocks(winget_id) values('Example.App')",
      "insert into public.curated_excluded_apps(winget_id) values('Example.App')",
      "insert into public.packaging_jobs(winget_id,version,architecture,installer_sha256,status) values('Example.App','1','x64',repeat('A',64),'awaiting_qa')",
      "insert into public.packaging_jobs(qa_candidate_id,status) values('11111111-1111-4111-8111-111111111111','queued')",
    ];
    for(const sql of denials){
      await pg.exec('begin');await seed();await pg.exec(sql);await pg.exec('set local role service_role');
      await expect(call(),sql).rejects.toThrow();await pg.exec('rollback');
      expect((await pg.query('select count(*)::int n from public.qa_candidates')).rows[0]).toEqual({n:0});
    }
    for(const mutate of [
      (p:Record<string,any>)=>{p.installer.silentArgs='/quiet';},
      (p:Record<string,any>)=>{p.installer.sourceType='msi';},
      (p:Record<string,any>)=>{p.installer.silentArgs=args+' é';},
      (p:Record<string,any>)=>{p.installer.uninstallCommand='other';},
      (p:Record<string,any>)=>{p.psadtConfig.removeExistingInstall=true;},
    ]){
      const p=JSON.parse(after);mutate(p);const json=JSON.stringify(p),sha=digest(json);
      const changed={...candidate,package_profile_sha256:sha,test_config:config(json)};
      await pg.exec('begin');await seed();await pg.exec('set local role service_role');
      await expect(call(changed,beforeHash,sha)).rejects.toThrow();await pg.exec('rollback');
    }
    for(const role of ['anon','authenticated']){
      await pg.exec('begin');await seed();await pg.exec('set local role '+role);
      await expect(call()).rejects.toThrow(/permission denied/);await pg.exec('rollback');
    }
    await pg.exec('alter function public.adopt_qa_repair_current_candidate(uuid,uuid) set search_path=public');
    // A drifted source is rejected before the new function can be generated.
    await pg.exec('drop function public.adopt_qa_repair_corrected_candidate(uuid,jsonb,text,text,text);drop table public.qa_repair_profile_corrections;');
    await expect(pg.exec(migration)).rejects.toThrow(/Reviewed diagnostic adoption function changed/);
  }finally{await pg.close();}
},30000);
