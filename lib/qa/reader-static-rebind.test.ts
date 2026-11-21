import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {beforeAll,beforeEach,afterAll,expect,it} from 'vitest';

let db:PGlite, originals:string, patch:string, guards:string[];
const id='de979d31-562f-40ef-9dd1-3752fa091953';
const hash='7bec66953457f6bc78bce9f0a1dcdde1c4cf2a8f8ac26f73fcecf5738f42f307';
const signatures=['public.reserve_qa_vt_candidate_request(text,uuid,text,text,uuid)',
 'public.report_qa_vt_candidate_rate_limit(text,uuid,uuid,timestamptz)'];
const pins=['d82f5cd1df5c869f330f267988052c6c9d0bd2f82a705d4430fcb41b3d19455c',
 'ffaaf313f296124c509c6e0bd38c2827df2a54a3a403488eb723ca296bb89e7f'];
const cutoff='2026-11-14 08:00:00+00';
const defs=async()=>Promise.all(signatures.map(async s=>(await db.query<{v:string}>(
 'select pg_get_functiondef($1::regprocedure) v',[s])).rows[0].v));
const properties=async()=>(await db.query<{v:object}>(`select jsonb_agg(jsonb_build_array(
 proowner,proacl::text,prosecdef,proconfig,provolatile) order by proname) v from pg_proc
 where oid in('${signatures[0]}'::regprocedure,'${signatures[1]}'::regprocedure)`)).rows[0].v;
const call=async(secret='local-fixture-only')=>db.query('select public.reserve_qa_vt_candidate_request($1,$2,$3,$4)',[secret,id,hash,'hash_lookup']);
const unchanged=async()=>(await db.query<{v:object}>(`select jsonb_build_array(
 (select to_jsonb(c) from public.qa_candidates c),(select to_jsonb(h) from public.qa_installer_security_holds h)) v`)).rows[0].v;
async function clock(value:string){for(const source of await defs())await db.exec(source.replace(
 /(clock_timestamp\(\) >= |reserved_at < )'[^']+'::timestamptz/,
 (_,prefix:string)=>prefix+"'"+value+"'::timestamptz"));}

beforeAll(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema extensions;
 create function extensions.digest(text,text) returns bytea language sql as $$select sha256(convert_to($1,'UTF8'))$$;
 create table public.qa_candidates(id uuid,status text,winget_id text,version text,architecture text,test_level text,
 installer_sha256 text,package_profile_sha256 text,attempts int);
 create table public.qa_installer_security_holds(sha256 text,released_at timestamptz,malicious_verdicts int);
 create table public.catalog_file_reputation(sha256 text,status text);
 create table public.qa_vt_requests(id uuid,sha256 text,operation text,candidate_id uuid,recheck_lease uuid,reserved_at timestamptz default clock_timestamp());
 create table public.qa_vt_request_budget(blocked_until timestamptz);
 create function public.authenticate_qa_installer_recheck(text) returns void language plpgsql as $$begin
 if $1 is distinct from 'local-fixture-only' then raise insufficient_privilege;end if;end$$;
 create function public.reserve_qa_vt_request(text,text) returns jsonb language plpgsql as $$declare r uuid:='11111111-1111-4111-8111-111111111111';begin
 insert into public.qa_vt_requests(id,sha256,operation) values(r,$1,$2);return jsonb_build_object('reservationId',r);end$$;
 create function public.defer_qa_vt_requests_until(uuid,timestamptz) returns void language sql as $$insert into public.qa_vt_request_budget values($2)$$;`);
 const source=(await readFile(new URL('../../supabase/migrations/20261111044500_qa_reader_static_scan_reservation.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 guards=[...source.matchAll(/guard text := \$guard\$([\s\S]*?)\$guard\$;/g)].map(x=>x[1]);
 expect(guards).toHaveLength(2);
 originals=`create or replace function ${signatures[0].replace('(text,uuid,text,text,uuid)','(p_secret text,p_candidate_id uuid,p_sha256 text,p_operation text,p_lease uuid default null)')}
 returns jsonb language plpgsql security definer set search_path='' as $body$
 declare c public.qa_candidates%rowtype;reservation jsonb;request_id uuid;
 begin perform public.authenticate_qa_installer_recheck(p_secret);
 select * into c from public.qa_candidates where id=p_candidate_id for update;
 ${guards[0]}raise exception 'ordinary fixture';end;$body$;
 create or replace function ${signatures[1].replace('(text,uuid,uuid,timestamptz)','(p_secret text,p_candidate_id uuid,p_reservation uuid,p_retry_at timestamptz)')}
 returns void language plpgsql security definer set search_path='' as $body$
 declare c public.qa_candidates%rowtype;
 begin perform public.authenticate_qa_installer_recheck(p_secret);
 select * into c from public.qa_candidates where id=p_candidate_id for update;
 ${guards[1]}raise exception 'ordinary fixture';end;$body$;`;
 await db.exec(originals);
 for(const s of signatures)await db.exec(`revoke all on function ${s} from public,authenticated,service_role;grant execute on function ${s} to anon;`);
 patch=(await readFile(new URL('../../supabase/migrations/20261113083400_qa_reader_static_scan_rebind.sql',import.meta.url),'utf8')).replaceAll('\r\n','\n');
 // Match the existing PostgreSQL fixture convention: normalize only the
 // disposable function anchors. The shipped migration pins never change.
 for(let i=0;i<2;i++){
  const h=(await db.query<{v:string}>("select encode(extensions.digest(replace(pg_get_functiondef($1::regprocedure),$2,''),'sha256'),'hex') v",[signatures[i],guards[i]])).rows[0].v;
  expect(patch.split(pins[i])).toHaveLength(2);patch=patch.replace(pins[i],h);
 }
},30000);
beforeEach(async()=>{
 await db.exec(originals);
 await db.exec(`truncate public.qa_candidates,public.qa_installer_security_holds,public.catalog_file_reputation,public.qa_vt_requests,public.qa_vt_request_budget;
 insert into public.qa_candidates values('${id}','queued','Adobe.Acrobat.Reader.64-bit','26.003.22075','x64','psadt-package','${hash}','BE9876C429C9ADB461675ADC80E58E7890A7F5F41C26275BDD3DDA694C48CDCA',0);
 insert into public.qa_installer_security_holds values('${hash}',null,0);`);
});
afterAll(async()=>{await db?.close();});

it('changes only the proposed cutoff and retains grants and the original uniqueness floor',async()=>{
 const before=await defs(),acl=await properties();await db.exec(patch);const after=await defs();
 expect(after).toEqual(before.map(s=>s.replaceAll('2026-11-11 21:00:00+00',cutoff)));
 expect(after.every(s=>s.includes('2026-11-11 00:00:00+00'))).toBe(true);expect(await properties()).toEqual(acl);
});
it('fails atomically on drift in the second function and refuses a repeated migration',async()=>{
 const old=await defs();await db.exec(old[1].replace('ordinary fixture','drifted fixture'));const before=await defs();
 await expect(db.exec(patch)).rejects.toThrow('Reader rebind source mismatch');await db.exec('rollback');expect(await defs()).toEqual(before);
 await db.exec(originals);await db.exec(patch);const after=await defs();await expect(db.exec(patch)).rejects.toThrow('Reader rebind source mismatch');await db.exec('rollback');expect(await defs()).toEqual(after);
});
it('allows one fresh lookup without candidate or hold writes and refuses a second',async()=>{
 await db.exec(patch);await clock('infinity');const before=await unchanged();await call();await expect(call()).rejects.toThrow('QA VirusTotal scan-only binding rejected');
 expect(await unchanged()).toEqual(before);expect((await db.query<{n:number}>('select count(*)::int n from public.qa_vt_requests')).rows[0].n).toBe(1);
});
it('keeps a Nov 11 lookup consumed across the new binding and rejects auth drift',async()=>{
 await db.exec(patch);await clock('infinity');await expect(call('wrong-fixture-only')).rejects.toMatchObject({code:'42501'});
 await db.exec(`insert into public.qa_vt_requests(id,sha256,operation,candidate_id,reserved_at) values('22222222-2222-4222-8222-222222222222','${hash}','hash_lookup','${id}','2026-11-11T10:00:00Z')`);
 await expect(call()).rejects.toThrow('QA VirusTotal scan-only binding rejected');
});
it('refuses the new expired window without a lookup reservation',async()=>{
 await db.exec(patch);await clock('2000-01-01 00:00:00+00');await expect(call()).rejects.toThrow('QA VirusTotal scan-only binding rejected');
 expect((await db.query<{n:number}>('select count(*)::int n from public.qa_vt_requests')).rows[0].n).toBe(0);
});
it('propagates an in-window 429 after expiry but rejects an out-of-window reservation',async()=>{
 await db.exec(patch);await clock('infinity');await call();
 const now=Date.now();
 await db.query('update public.qa_vt_requests set reserved_at=$1',[new Date(now-60000).toISOString()]);
 // A recent reservation remains reportable after the disposable cutoff.
 await clock(new Date(now-30000).toISOString());
 const args=['local-fixture-only',id,'11111111-1111-4111-8111-111111111111','2026-11-14T10:00:00Z'];
 await db.query('select public.report_qa_vt_candidate_rate_limit($1,$2,$3,$4)',args);
 expect((await db.query<{n:number}>('select count(*)::int n from public.qa_vt_request_budget')).rows[0].n).toBe(1);
 await db.query('update public.qa_vt_requests set reserved_at=$1',[new Date(now+60000).toISOString()]);
 await expect(db.query('select public.report_qa_vt_candidate_rate_limit($1,$2,$3,$4)',args)).rejects.toThrow('QA VirusTotal scan-only rate limit binding rejected');
});
