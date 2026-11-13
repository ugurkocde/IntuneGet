import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { beforeAll, beforeEach, afterAll, expect, it } from 'vitest';

let db: PGlite;
const id='11111111-1111-4111-8111-111111111111';
const lease='2026-11-13T05:11:12.345678+00:00';
const call=async(run='123',at=lease,secret='local-fixture-only')=>(await db.query<{v:string}>(
 'select public.release_qa_candidate_dispatch_lease($1,$2,$3,$4) v',[secret,id,run,at])).rows[0].v;
const snapshot=async()=>(await db.query<{v:object}>('select to_jsonb(c) v from public.qa_candidates c')).rows[0].v;
let pinned: object;
const pins=async()=>(await db.query<{v:object}>(`select jsonb_object_agg(p.oid::text,pg_get_functiondef(p.oid)) v
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
 and p.proname in('report_qa_candidate_result','claim_qa_work','mark_qa_candidate_running')`)).rows[0].v;
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;
 create function public.authenticate_qa_installer_recheck(text) returns void language plpgsql as $$begin
 if $1 is distinct from 'local-fixture-only' then raise insufficient_privilege using message='QA authentication rejected';end if;end$$;
 create table public.qa_candidates(id uuid primary key,status text,dispatched_at timestamptz,started_at timestamptz,
 github_run_id text,test_level text,attempts int,next_retry_at timestamptz,phase text,phase_started_at timestamptz,
 phase_updated_at timestamptz,failure_summary text,updated_at timestamptz,recovery_attempts int,recovery_history jsonb);
 create function public.report_qa_candidate_result() returns text language sql as $$select 'pinned report'::text$$;
 create function public.claim_qa_work() returns text language sql as $$select 'pinned claim'::text$$;
 create function public.mark_qa_candidate_running() returns text language sql as $$select 'pinned running'::text$$;`);
 pinned=await pins();
 if(!process.env.QA_LEASE_BASELINE)await db.exec(await readFile(new URL('../../supabase/migrations/20261113053000_qa_dispatch_lease_release.sql',import.meta.url),'utf8'));
},30000);
beforeEach(async()=>{
 await db.exec('truncate public.qa_candidates');
 await db.query(`insert into public.qa_candidates values($1,'dispatched',$2,null,null,'psadt-package',1,
 '2026-11-13T05:00:00.123456Z',null,null,null,null,'2026-11-13T05:11:12Z',0,'[]')`,[id,lease]);
});
afterAll(async()=>{await db?.close();});
it('releases the exact unstarted lease without spending or resetting budgets',async()=>{
 const before=await snapshot();expect(await call()).toBe('released');const after=await snapshot() as Record<string,unknown>;
 expect(after.status).toBe('queued');expect(after.dispatched_at).toBeNull();expect(after.phase).toBeNull();
 for(const key of ['attempts','next_retry_at','recovery_attempts','recovery_history'])expect(after[key]).toEqual((before as Record<string,unknown>)[key]);
 expect(await call()).toBe('not_owned');
});
it('keeps microsecond lease identity and a later dispatch byte-identical',async()=>{
 const before=await snapshot();expect(await call('123','2026-11-13T05:11:12.345679Z')).toBe('not_owned');expect(await snapshot()).toEqual(before);
});
it('recognizes a committed mark only for the same run and exact lease without a write',async()=>{
 await db.exec("update public.qa_candidates set status='running',github_run_id='123',started_at=now()");
 const before=await snapshot();expect(await call()).toBe('owned_running');expect(await snapshot()).toEqual(before);
 expect(await call('124')).toBe('not_owned');expect(await snapshot()).toEqual(before);
});
it.each([
 "attempts=2", "started_at=now()", "github_run_id='124'", "test_level='installer-preflight'", "status='passed'",
])('does not release an exhausted or non-own lease: %s',async patch=>{
 await db.exec('update public.qa_candidates set '+patch);const before=await snapshot();expect(await call()).toBe('not_owned');expect(await snapshot()).toEqual(before);
});
it('authenticates before inspecting or changing a lease',async()=>{
 const before=await snapshot();await expect(call('123',lease,'wrong-fixture-value')).rejects.toMatchObject({code:'42501'});expect(await snapshot()).toEqual(before);
});
it('retains the existing function definitions and grants execute only to the QA anon caller',async()=>{
 expect(await pins()).toEqual(pinned);
 for(const [role,allowed]of[['anon',true],['authenticated',false],['service_role',false]] as const){
  const r=await db.query<{ok:boolean}>('select has_function_privilege($1,\'public.release_qa_candidate_dispatch_lease(text,uuid,text,timestamptz)\',\'EXECUTE\') ok',[role]);expect(r.rows[0].ok).toBe(allowed);
 }
});
