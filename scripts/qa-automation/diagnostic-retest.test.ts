import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { it } from 'vitest';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
it('executes the diagnostic grant and settlement guards in rolled-back PostgreSQL transactions', async () => {
const root=new URL('./',import.meta.url),read=(n: string)=>fs.readFileSync(new URL(n,root),'utf8');
const pg=new PGlite({extensions:{pgcrypto}}),passed: string[]=[];
const sql=async (q: string)=>pg.exec(q).catch(e=>{throw Error(e.message);}),query=async(q: string,params: unknown[]=[])=>pg.query<Record<string, any>>(q,params).catch(e=>{throw Error(e.message);});
await sql('create schema extensions; create extension pgcrypto with schema extensions; create role anon; create role authenticated; create role service_role bypassrls;');
for(const t of JSON.parse(read('fixtures/diagnostic-retest-schema.json'))){
 const columns=t.columns.map((c: {name: string; data_type: string; format: string})=>`"${c.name}" ${c.data_type==='ARRAY'?c.format.slice(1)+'[]':c.data_type==='USER-DEFINED'?'text':c.data_type}${c.name==='id'&&c.data_type==='uuid'?' default gen_random_uuid()':''}`);
 if(t.columns.some((c: {name: string})=>c.name==='id'))columns.push('primary key(id)');
 if(t.name==='public.qa_repair_requests')columns.push('unique(candidate_id)');
 await sql(`create table ${t.name} (${columns.join(',')});`);
}
await sql('grant usage on schema public,extensions to service_role; grant all on all tables in schema public to service_role;');
const baseline=JSON.parse(read('fixtures/diagnostic-retest-functions.json'));
await sql(baseline.claimant);
// Synthetic test credential only; the deployed authorization predicate is preserved.
const testSecret='local-fixture-only',digest=crypto.createHash('sha256').update(testSecret).digest('hex');
await sql(baseline.reporter.replace(/expected_secret_hash constant text := '[a-f0-9]{64}'/,`expected_secret_hash constant text := '${digest}'`));
await sql(read('../../supabase/migrations/20261011075101_qa_guarded_diagnostic_retests.sql').replace(/\r\n/g,'\n'));
const id='11111111-1111-4111-8111-111111111111',repair='22222222-2222-4222-8222-222222222222',sha='A'.repeat(64),pin='b'.repeat(40),canonical=JSON.stringify({toolchain:{packagerCommit:pin}}),profile=crypto.createHash('sha256').update(canonical).digest('hex').toUpperCase();
async function seed(){
 await query(`insert into public.qa_pipeline_control(id,paused,required_packager_commit,scheduler_packager_commit,scheduler_seen_at) values('global',false,$1,$1,now())`,[pin]);
 await query(`insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,test_level,package_profile_sha256,test_config,status,attempts,priority,enqueued_at,next_retry_at) values($1,'Example.App','1','x64',$2,'psadt-package',$3,$4,'superseded',0,10,now()-interval '1 hour',now())`,[id,sha,profile,{packageProfileCanonicalJson:canonical,profileKind:'catalog-default'}]);
 await query(`insert into public.qa_repair_requests(id,candidate_id,winget_id,version,architecture,failure_class,status,prior_requeues) values($1,$2,'Example.App','1','x64','app_lifecycle','in_progress',0)`,[repair,id]);
 await query(`insert into public.qa_package_blocks(winget_id,version,architecture,installer_sha256,block_code) values('Example.App','1','x64',$1,'failed_managed_lifecycle')`,[sha]);
}
async function test(name: string,fn: () => Promise<void>){await sql('begin');try{await seed();await fn();passed.push(name);}finally{await sql('rollback');}}
async function grant(){return (await query('select public.create_qa_retest_grant($1,now()+interval \'1 hour\',\'bounded diagnostic\') as id',[id])).rows[0].id;}
async function eligible(){return (await query('select public.qa_retest_grant_eligible($1) as ok',[id])).rows[0].ok;}
await test('service-only RLS and function access',async()=>{
 assert.equal((await query("select has_table_privilege('anon','public.qa_retest_grants','SELECT') as ok")).rows[0].ok,false);
 assert.equal((await query("select has_function_privilege('authenticated','public.create_qa_retest_grant(uuid,timestamptz,text)','EXECUTE') as ok")).rows[0].ok,false);
 await sql('set local role service_role');await grant();assert.equal(await eligible(),true);
});
await test('locked claim preserves block without grant',async()=>{await query("update public.qa_candidates set status='queued' where id=$1",[id]);assert.equal((await query('select public.claim_qa_work(\'ordinary\',$1,$2) as r',[id,pin])).rows[0].r.reason,'package_compatibility_blocked');});
await test('exact grant claims existing fair candidate and keeps quarantine',async()=>{await grant();assert.equal((await query('select public.claim_qa_work(\'ordinary\',$1,$2) as r',[id,pin])).rows[0].r.row.status,'dispatched');assert.equal((await query('select count(*)::int as n from public.qa_package_blocks')).rows[0].n,1);});
for(const [name,change] of [
 ['expired',"update public.qa_retest_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'"],
 ['closed',"update public.qa_retest_grants set closed_at=now()"],
 ['wrong installer',"update public.qa_candidates set installer_sha256=repeat('C',64)"],
 ['wrong profile',"update public.qa_candidates set package_profile_sha256=repeat('D',64)"],
 ['budget exhausted',"update public.qa_repair_requests set prior_requeues=3"],
 ['security hold',"update public.qa_package_blocks set block_code='security'"],
 ['customer awaiting QA',`insert into public.packaging_jobs(id,winget_id,version,architecture,installer_sha256,status) values(gen_random_uuid(),'Example.App','1','x64','${sha}','awaiting_qa')`],
 ['VT suspicious',`insert into public.qa_package_results(installer_sha256,virustotal_suspicious) values('${sha}',1)`],
 ['app exclusion',"insert into public.curated_excluded_apps(winget_id) values('Example.App')"],
 ['linked customer with null SHA',`insert into public.packaging_jobs(id,winget_id,qa_candidate_id,status) values(gen_random_uuid(),'Example.App','${id}','awaiting_qa')`],
 ['security repair',"update public.qa_repair_requests set failure_class='security'"],
])await test(name+' rejects locked claim without charging an attempt',async()=>{await grant();await sql(change);assert.equal(await eligible(),false);assert.equal((await query('select public.claim_qa_work(\'ordinary\',$1,$2) as r',[id,pin])).rows[0].r.reason,'package_compatibility_blocked');assert.equal((await query('select attempts from public.qa_candidates')).rows[0].attempts,0);});
await test('global one open grant rejects a second candidate',async()=>{await grant();await assert.rejects(query(`insert into public.qa_retest_grants(candidate_id,repair_request_id,winget_id,version,architecture,installer_sha256,package_profile_sha256,expires_at,reason) values($1,$2,'Example.App','1','x64',$3,$4,now()+interval '1 hour','second')`,[id,repair,sha,profile]),/duplicate key/);});
for(const [name,change] of [
 ['stale heartbeat',"update public.qa_pipeline_control set scheduler_seen_at=now()-interval '6 minutes'"],
 ['wrong profile canonical hash',"update public.qa_candidates set package_profile_sha256=repeat('D',64)"],
 ['exhausted recovery',"update public.qa_candidates set recovery_attempts=5"],
 ['repair budget3',"update public.qa_repair_requests set prior_requeues=3"],
])await test(name+' rejects grant creation',async()=>{await sql(change);await assert.rejects(grant());});
await test('failed diagnostic charges exactly one repair requeue',async()=>{await grant();await query("update public.qa_candidates set status='running',phase='publishing' where id=$1",[id]);await query('select public.report_qa_candidate_result($1,$2,\'failed\',\'managed failure\')',[testSecret,id]);assert.deepEqual((await query('select status,prior_requeues from public.qa_repair_requests')).rows[0],{status:'pending',prior_requeues:1});});
await test('first retry keeps grant; second nonpublishing retry closes without budget',async()=>{await grant();await query("update public.qa_candidates set status='running',phase='installing',attempts=1 where id=$1",[id]);await query('select public.report_qa_candidate_result($1,$2,\'retry\',\'infra\')',[testSecret,id]);assert.equal((await query('select closed_at from public.qa_retest_grants')).rows[0].closed_at,null);await query("update public.qa_candidates set status='running',phase='installing',attempts=2 where id=$1",[id]);await query('select public.report_qa_candidate_result($1,$2,\'retry\',\'infra\')',[testSecret,id]);assert.notEqual((await query('select closed_at from public.qa_retest_grants')).rows[0].closed_at,null);assert.equal((await query('select prior_requeues from public.qa_repair_requests')).rows[0].prior_requeues,0);});
await test('service update on candidate without grant succeeds',async()=>{await sql('set local role service_role');await query("update public.qa_candidates set status='error',phase='installing' where id=$1",[id]);});
await test('outcomeless supersede after expiration restores repair without budget charge',async()=>{await grant();await sql("update public.qa_retest_grants set closed_at=now();");await query("update public.qa_candidates set status='superseded' where id=$1",[id]);assert.deepEqual((await query('select status,prior_requeues from public.qa_repair_requests')).rows[0],{status:'in_progress',prior_requeues:0});});
await test('publishing error retains grant for publication recovery',async()=>{await grant();await query("update public.qa_candidates set status='error',phase='publishing' where id=$1",[id]);assert.equal((await query('select closed_at from public.qa_retest_grants')).rows[0].closed_at,null);});
await test('passed diagnostic closes grant without catalog promotion',async()=>{await grant();await query("update public.qa_candidates set status='running',phase='publishing' where id=$1",[id]);assert.equal((await query('select public.report_qa_candidate_result($1,$2,\'passed\',null) as ok',[testSecret,id])).rows[0].ok,true);assert.equal((await query('select count(*)::int as n from public.curated_apps')).rows[0].n,0);assert.equal((await query('select count(*)::int as n from public.qa_package_blocks')).rows[0].n,1);});
await test('expired open grant is swept and later supersede restores its repair',async()=>{await grant();await sql("update public.qa_retest_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'; update public.qa_retest_grants set closed_at=now() where closed_at is null and expires_at<=now();");await query("update public.qa_candidates set status='superseded' where id=$1",[id]);assert.equal((await query('select status from public.qa_repair_requests')).rows[0].status,'in_progress');});
await test('publication error reconciles Passed after grant expiry without promotion',async()=>{await grant();await query("update public.qa_candidates set status='error',phase='publishing',github_run_url='https://example.invalid/run',started_at=now()-interval '1 hour' where id=$1",[id]);await sql("update public.qa_retest_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour';");await query(`insert into public.qa_package_results(package_profile_sha256,winget_id,tested_version,architecture,installer_sha256,outcome,github_run_url,tested_at_utc) values($1,'Example.App','1','x64',$2,'Passed','https://example.invalid/run',now())`,[profile,sha]);assert.equal((await query('select public.report_qa_candidate_result($1,$2,\'passed\',null) as ok',[testSecret,id])).rows[0].ok,true);assert.equal((await query('select count(*)::int as n from public.version_history')).rows[0].n,0);assert.equal((await query('select status from public.qa_repair_requests')).rows[0].status,'resolved');});
await test('deployment-profile diagnostic pass retains quarantine and customer state',async()=>{
 await query("update public.qa_candidates set test_config=jsonb_set(test_config,'{profileKind}','\"deployment-config\"') where id=$1",[id]);
 await query("insert into public.packaging_jobs(id,winget_id,status) values(gen_random_uuid(),'Unrelated.App','failed')");
 const before=(await query('select id,status from public.packaging_jobs')).rows;
 await grant();await query("update public.qa_candidates set status='running',phase='publishing' where id=$1",[id]);
 assert.equal((await query("select public.report_qa_candidate_result($1,$2,'passed',null) as ok",[testSecret,id])).rows[0].ok,true);
 assert.equal((await query('select count(*)::int as n from public.curated_apps')).rows[0].n,0);
 assert.equal((await query('select count(*)::int as n from public.qa_package_blocks')).rows[0].n,1);
 assert.deepEqual((await query('select id,status from public.packaging_jobs')).rows,before);
});
await pg.close();assert.equal(passed.length,28);
}, 30000);
