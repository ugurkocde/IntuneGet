import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';

let db: PGlite;
const canonical=JSON.stringify({toolchain:{packagerCommit:'a'.repeat(40)}});
const profile=createHash('sha256').update(canonical).digest('hex').toUpperCase();
const row={winget_id:'Example.App',version:'1.0',architecture:'x64',sha256:'b'.repeat(64),profile_sha256:profile,
  run_id:'123',packager_commit:'a'.repeat(40),own:true,carried:false,outcome:'Passed',vt_status:'clean',malicious:0,suspicious:0,engines:50,engine_version:2};
const call=async(rows:object[]=[row],secret='local-fixture-only')=>(await db.query<{v:{admitted:boolean;rows:{reason:string}[]}}>(
  'select check_qa_result_publication_admission($1,$2) v',[secret,JSON.stringify(rows)])).rows[0].v;
beforeAll(async()=>{
 db=new PGlite({extensions:{pgcrypto}});
 await db.exec(`create schema extensions;create extension pgcrypto with schema extensions;create role anon;create role authenticated;create role service_role;
 create function authenticate_qa_installer_recheck(text) returns void language plpgsql as $$begin if $1 is distinct from 'local-fixture-only' then raise exception 'QA authentication rejected';end if;end$$;
 create table qa_candidates(winget_id text,version text,architecture text,installer_sha256 text,test_level text,package_profile_sha256 text,github_run_id text,test_config jsonb);
 create table qa_installer_security_holds(sha256 text,released_at timestamptz);
 create table package_eligibility_blocks(winget_id text);
 create table qa_package_blocks(winget_id text,version text,architecture text,installer_sha256 text);
 create table curated_excluded_apps(winget_id text,reason text);
 create table catalog_file_reputation(sha256 text,status text,malicious int,suspicious int,engine_count_version int,total_engines int);`);
 if(!process.env.QA_PUBLICATION_BASELINE)await db.exec(await readFile(new URL('../../supabase/migrations/20261113032500_qa_publication_allrow_admission.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
 await db.exec('truncate qa_candidates,qa_installer_security_holds,package_eligibility_blocks,qa_package_blocks,curated_excluded_apps,catalog_file_reputation');
 await db.query('insert into qa_candidates values($1,$2,$3,$4,$5,$6,$7,$8)',[row.winget_id,row.version,row.architecture,row.sha256,'psadt-package',profile,row.run_id,JSON.stringify({packageProfileCanonicalJson:canonical})]);
 await db.query("insert into catalog_file_reputation values($1,'found',0,0,2,50)",[row.sha256]);
});
afterAll(async()=>db?.close());
it('admits a fully bound clean own result and twenty already-main carried rows without truncation',async()=>{
 const rows=[row,...Array.from({length:20},(_,i)=>({...row,own:false,carried:true,run_id:String(i+1000),profile_sha256:i.toString(16).toUpperCase().padStart(64,'0'),vt_status:'not_found',malicious:null,engines:null}))];
 expect(await call(rows)).toMatchObject({admitted:true});expect((await call(rows)).rows).toHaveLength(21);
 await expect(call([...rows,{...rows[1]}])).rejects.toThrow(/bound/);
});
it.each(['hash','app','tuple','excluded'])('denies every carried or own row with an active %s hold',async kind=>{
 const queries={hash:"insert into qa_installer_security_holds values($1,null)",app:'insert into package_eligibility_blocks values($1)',tuple:'insert into qa_package_blocks values($1,$2,$3,$4)',excluded:"insert into curated_excluded_apps values($1,'fixture')"};
 const args=kind==='hash'?[row.sha256]:kind==='tuple'?[row.winget_id,row.version,row.architecture,row.sha256.toUpperCase()]:[row.winget_id.toLowerCase()];
 await db.query(queries[kind as keyof typeof queries],args);expect((await call([row,{...row,own:false,carried:true}])).admitted).toBe(false);
});
it.each(['not_found','error','skipped','suspicious'])('denies an own Passed %s verdict without changing it',async vt_status=>{
 expect((await call([{...row,vt_status}])).rows[0].reason).toBe('record_verdict_unproved');
});
it('checks a held carried hash even when the exact own row is clear',async()=>{
 const carried={...row,own:false,carried:true,sha256:'c'.repeat(64)};
 await db.query('insert into qa_installer_security_holds values($1,null)',[carried.sha256]);
 const result=await call([row,carried]);expect(result.admitted).toBe(false);
 expect(result.rows.map(r=>r.reason)).toEqual(['clear','hash_held']);
});
it('denies missing candidates, canonical profile changes and a non-clean live cache',async()=>{
 await db.exec('delete from qa_candidates');expect((await call()).admitted).toBe(false);
});
it('rejects a claimed profile that does not match the exact canonical candidate',async()=>{
 expect((await call([{...row,profile_sha256:'F'.repeat(64)}])).rows[0].reason).toBe('identity_profile_unproved');
});
it('does not treat a clean record as a clean current reputation proof',async()=>{
 await db.exec("update catalog_file_reputation set status='not_found'");expect((await call()).rows[0].reason).toBe('cached_verdict_unproved');
});
it('authenticates before inspecting rows and exposes no caller table privileges',async()=>{
 await expect(call([], 'wrong')).rejects.toThrow(/authentication/);
 expect((await db.query<{v:boolean}>("select has_function_privilege('anon','check_qa_result_publication_admission(text,jsonb)','EXECUTE') v")).rows[0].v).toBe(true);
 expect((await db.query<{v:boolean}>("select has_table_privilege('anon','qa_candidates','SELECT') v")).rows[0].v).toBe(false);
});
