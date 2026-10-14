import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { it } from 'vitest';

it('adopts a deployment profile without resetting repair history or creating a grant', async () => {
  const root = new URL('./', import.meta.url);
    const read = (path: string) => fs.readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
  const pg = new PGlite({ extensions: { pgcrypto } });
  try {
    await pg.exec('create schema extensions; create extension pgcrypto with schema extensions; create role anon; create role authenticated; create role service_role bypassrls;');
    for (const table of JSON.parse(read('fixtures/diagnostic-retest-schema.json'))) {
      const columns = table.columns.map((column: { name: string; data_type: string; format: string }) =>
        `"${column.name}" ${column.data_type === 'ARRAY' ? column.format.slice(1) + '[]' : column.data_type === 'USER-DEFINED' ? 'text' : column.data_type}${column.name === 'id' && column.data_type === 'uuid' ? ' default gen_random_uuid()' : ''}`);
      if (table.columns.some((column: { name: string }) => column.name === 'id')) columns.push('primary key(id)');
      if (table.name === 'public.qa_repair_requests') columns.push('unique(candidate_id)');
      await pg.exec(`create table ${table.name} (${columns.join(',')});`);
    }
    await pg.exec('create table public.qa_installer_security_holds(sha256 text,released_at timestamptz); create table public.catalog_file_reputation(sha256 text,status text,malicious integer,suspicious integer); grant usage on schema public,extensions to service_role; grant all on all tables in schema public to service_role;');
    const baseline = JSON.parse(read('fixtures/diagnostic-retest-functions.json'));
    await pg.exec(baseline.claimant);
    await pg.exec(baseline.reporter);
    await pg.exec(read('../../supabase/migrations/20261011075101_qa_guarded_diagnostic_retests.sql'));
    const migrations = fs.readdirSync(new URL('../../supabase/migrations/', root)).filter(name => (name.endsWith('_qa_repair_current_profile_adoption.sql') || name.endsWith('_qa_deployment_profile_adoption.sql')));
    for (const migration of migrations) await pg.exec(read('../../supabase/migrations/' + migration));
    await pg.exec(read('../../supabase/migrations/20261014222100_qa_terminal_failure_retest_guards.sql'));
    const old = '11111111-1111-4111-8111-111111111111', current = '33333333-3333-4333-8333-333333333333', repair = '22222222-2222-4222-8222-222222222222';
    const sha = 'A'.repeat(64), pin = 'b'.repeat(40);
    const canonical = JSON.stringify({profileKind:'deployment-config',toolchain:{packagerCommit:pin},installer:{installScope:'machine',silentArgs:'/quiet'},psadtConfig:{},detectionRules:[]});
    const priorCanonical = canonical.replace(pin,'a'.repeat(40));
    const priorProfile = crypto.createHash('sha256').update(priorCanonical).digest('hex').toUpperCase();
    const profile = crypto.createHash('sha256').update(canonical).digest('hex').toUpperCase();
    const call = () => pg.query('select public.adopt_qa_repair_current_candidate($1,$2) as id', [repair, current]);
    const seed = async () => {
      await pg.query("insert into public.qa_pipeline_control(id,paused,required_packager_commit,scheduler_packager_commit,scheduler_seen_at) values('global',false,$1,$1,now())", [pin]);
      for (const id of [old, current]) await pg.query("insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,installer_url,test_level,package_profile_sha256,test_config,status,failure_summary,finished_at,next_retry_at) values($1,'Example.App','1','x64',$2,'https://example.test/setup.exe','psadt-package',$3,$4,'superseded',$5,now(),now())", [id,sha,id===old?priorProfile:profile,{profileKind:'deployment-config',psadtConfig:{},detectionRules:[],packageProfileCanonicalJson:id===old?priorCanonical:canonical,packageProfileSha256:id===old?priorProfile:profile},id === old ? 'Old profile' : 'Awaiting diagnostic retest grant']);
      await pg.query("insert into public.qa_repair_requests(id,candidate_id,winget_id,version,architecture,failure_class,status,prior_requeues,updated_at,resolution) values($1,$2,'Example.App','1','x64','app_lifecycle','in_progress',2,now()-interval '3 hours','Unconfirmed')", [repair,old]);
      await pg.query("insert into public.qa_package_blocks(winget_id,version,architecture,installer_sha256,block_code) values('Example.App','1','x64',$1,'failed_managed_lifecycle')", [sha]);
    };
    await pg.exec('begin');
    try {
      await seed();
      const before = (await pg.query('select status,prior_requeues,updated_at,resolution from public.qa_repair_requests')).rows[0];
      await pg.exec('set local role service_role');
      assert.equal((await call()).rows[0].id,current);
      assert.deepEqual((await pg.query('select status,prior_requeues,updated_at,resolution from public.qa_repair_requests')).rows[0],before);
      assert.equal((await pg.query('select count(*)::int as n from public.qa_retest_grants')).rows[0].n,0);
      assert.equal((await pg.query('select status from public.qa_candidates where id=$1',[current])).rows[0].status,'superseded');
      assert.equal((await pg.query('select count(*)::int as n from public.qa_package_blocks')).rows[0].n,1);
    } finally { await pg.exec('rollback'); }
    const denials = [
      "update public.qa_candidates set package_profile_sha256=repeat('E',64) where id='"+old+"'",
      "update public.qa_candidates set test_config=jsonb_set(test_config,'{profileKind}','\"catalog-default\"') where id='"+old+"'",
      "update public.qa_candidates set test_config=jsonb_set(test_config,'{detectionRules}','[{\"type\":\"file\"}]') where id='"+current+"'",
      "update public.qa_candidates set test_config=jsonb_set(test_config,'{packageProfileCanonicalJson}',to_jsonb(jsonb_set((test_config->>'packageProfileCanonicalJson')::jsonb,'{installer,silentArgs}','\"/changed\"')::text)) where id='"+current+"'; update public.qa_candidates set package_profile_sha256=upper(encode(extensions.digest(test_config->>'packageProfileCanonicalJson','sha256'),'hex')) where id='"+current+"'; update public.qa_candidates set test_config=jsonb_set(test_config,'{packageProfileSha256}',to_jsonb(package_profile_sha256)) where id='"+current+"'",
      "update public.qa_repair_requests set prior_requeues=3",
      "update public.qa_repair_requests set status='blocked'",
      "update public.qa_repair_requests set failure_class='security'",
      "delete from public.qa_package_blocks",
      "update public.qa_candidates set phase='publishing' where id='"+old+"'",
      "update public.qa_candidates set status='queued' where id='"+old+"'",
      "update public.qa_candidates set installer_sha256=repeat('C',64) where id='"+current+"'",
      "update public.qa_candidates set installer_url='https://example.test/changed' where id='"+current+"'",
      "update public.qa_candidates set version='2' where id='"+current+"'",
      "update public.qa_candidates set architecture='x86' where id='"+current+"'",
      "update public.qa_candidates set test_config=jsonb_set(test_config,'{psadtConfig}','{\"customer\":true}') where id='"+current+"'",
      "update public.qa_candidates set package_profile_sha256=repeat('D',64) where id='"+current+"'",
      "update public.qa_candidates set test_config=jsonb_set(test_config,'{packageProfileSha256}','\"mismatch\"') where id='"+current+"'",
      "update public.qa_candidates set test_config=jsonb_set(test_config,'{profileKind}','\"catalog-default\"') where id='"+current+"'",
      "update public.qa_candidates set failure_summary='Foreign superseded row' where id='"+current+"'",
      "update public.qa_pipeline_control set paused=true",
      "update public.qa_pipeline_control set scheduler_seen_at=now()-interval '6 minutes'",
      "update public.qa_pipeline_control set required_packager_commit=repeat('c',40)",
      "insert into public.qa_installer_security_holds values(lower(repeat('A',64)),null)",
      "insert into public.catalog_file_reputation values(lower(repeat('A',64)),'found',1,0)",
      "insert into public.catalog_file_reputation values(lower(repeat('A',64)),'found',0,1)",
      "insert into public.qa_package_results(installer_sha256,virustotal_malicious) values(repeat('A',64),1)",
      "insert into public.qa_package_results(package_profile_sha256) select package_profile_sha256 from public.qa_candidates where id='"+current+"'",
      "insert into public.curated_excluded_apps(winget_id) values('Example.App')",
      "insert into public.package_eligibility_blocks(winget_id) values('Example.App')",
      "insert into public.packaging_jobs(id,qa_candidate_id,status) values(gen_random_uuid(),'"+old+"','awaiting_qa')",
      "insert into public.packaging_jobs(id,winget_id,version,architecture,installer_sha256,status) values(gen_random_uuid(),'Example.App','1','x64',repeat('A',64),'queued')",
      "insert into public.qa_repair_requests(id,candidate_id,status) values(gen_random_uuid(),'"+current+"','pending')",
      "insert into public.qa_retest_grants(candidate_id,repair_request_id,winget_id,version,architecture,installer_sha256,package_profile_sha256,expires_at,reason) select id,'"+repair+"',winget_id,version,architecture,installer_sha256,package_profile_sha256,now()+interval '1 hour','existing' from public.qa_candidates where id='"+old+"'",
    ];
    for (const change of denials) {
      await pg.exec('begin');
      try { await seed();await pg.exec(change);await assert.rejects(call(),undefined,change); }
      finally { await pg.exec('rollback'); }
    }
    for (const role of ['anon','authenticated']) assert.equal((await pg.query("select has_function_privilege($1,'public.adopt_qa_repair_current_candidate(uuid,uuid)','EXECUTE') as ok",[role])).rows[0].ok,false);
    assert.equal((await pg.query("select has_function_privilege('service_role','public.adopt_qa_repair_current_candidate(uuid,uuid)','EXECUTE') as ok")).rows[0].ok,true);
    const security = (await pg.query("select prosecdef,proconfig from pg_proc where oid='public.adopt_qa_repair_current_candidate(uuid,uuid)'::regprocedure")).rows[0];
    assert.equal(security.prosecdef,false);assert.deepEqual(security.proconfig,['search_path=""']);
  } finally { await pg.close(); }
},30000);
