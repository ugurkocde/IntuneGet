import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
let db:PGlite;
const migration=readFileSync(new URL('../../supabase/migrations/20261006130101_qa_publication_recovery.sql',import.meta.url),'utf8');
const id='00000000-0000-4000-8000-000000000001';
describe('publication recovery against exact persisted evidence',()=>{
  beforeEach(async()=>{
    db=new PGlite();
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema extensions;
      create function extensions.digest(value text,algorithm text) returns bytea language sql as $$
        select decode(case when value='test' then 'becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921' else repeat('0',64) end,'hex')
      $$;
      create table qa_candidates(id uuid primary key,winget_id text,version text,architecture text,installer_sha256 text,package_profile_sha256 text,github_run_url text,started_at timestamptz,dispatched_at timestamptz,finished_at timestamptz,updated_at timestamptz,phase_started_at timestamptz,phase_updated_at timestamptz,activity_updated_at timestamptz,log_updated_at timestamptz,phase text,status text,test_level text,attempts integer,github_run_id text,live_activity jsonb,live_log jsonb,failure_summary text);
      create table qa_package_results(package_profile_sha256 text primary key,winget_id text,tested_version text,architecture text,installer_sha256 text,github_run_url text,tested_at_utc timestamptz,outcome text,virustotal_malicious integer);
      create function report_qa_candidate_result(secret text,candidate uuid,outcome text,summary text) returns boolean language plpgsql as $$
      begin update qa_candidates set status=outcome,failure_summary=summary where id=candidate and status='running';return found;end;$$;
      insert into qa_candidates(id,winget_id,version,architecture,installer_sha256,package_profile_sha256,github_run_url,started_at,phase,status,test_level,attempts) values ('00000000-0000-4000-8000-000000000001','Example.App','1','x64','hash','profile','https://github.com/owner/repo/actions/runs/123','2026-10-06T00:00Z','publishing','error','psadt-package',1);
      insert into qa_package_results values('profile','Example.App','1','x64','hash','https://github.com/owner/repo/actions/runs/123','2026-10-06T01:00Z','Passed',0);
    `);
    await db.exec(migration);
  });
  afterEach(async()=>{await db.close();});
  it('rejects an invalid credential',async()=>{await expect(db.query("select reconcile_qa_result_publication('bad')")).rejects.toThrow(/credential/);});
  it('reconciles exact published evidence without changing the run or attempt count',async()=>{
    expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(1);
    expect((await db.query("select status,attempts,github_run_url from qa_candidates")).rows[0]).toMatchObject({status:'passed',attempts:1,github_run_url:'https://github.com/owner/repo/actions/runs/123'});
    expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(0);
  });
  it.each(["tested_version='2'","architecture='x86'","installer_sha256='other'","package_profile_sha256='other'","github_run_url='https://github.com/owner/repo/actions/runs/124'","tested_at_utc='2026-10-05T01:00Z'"])('refuses mismatched evidence: %s',async change=>{
    await db.exec('update qa_package_results set '+change);
    expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(0);
  });
  it('prevents operator recovery from rerunning a pending publication',async()=>{
    const result=await db.query<{allowed:boolean}>("select recover_qa_candidate('test',$1) allowed",[id]);
    expect(result.rows[0].allowed).toBe(false);
  });
  it('rolls back a rejected transition and still reconciles independent candidates',async()=>{
    await db.exec(`
      insert into qa_candidates select '00000000-0000-4000-8000-000000000002',winget_id,version,architecture,installer_sha256,'profile2',github_run_url,started_at,dispatched_at,finished_at,updated_at,phase_started_at,phase_updated_at,activity_updated_at,log_updated_at,phase,status,test_level,attempts,github_run_id,live_activity,live_log,failure_summary from qa_candidates;
      insert into qa_package_results select 'profile2',winget_id,tested_version,architecture,installer_sha256,github_run_url,tested_at_utc,outcome,virustotal_malicious from qa_package_results;
      create or replace function report_qa_candidate_result(secret text,candidate uuid,outcome text,summary text) returns boolean language plpgsql as $$
      begin if candidate='00000000-0000-4000-8000-000000000001' then raise exception 'Canonical mirror not ready';end if;
      update qa_candidates set status=outcome where id=candidate and status='running';return found;end;$$;
    `);
    expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(1);
    expect((await db.query('select status from qa_candidates where id=$1',[id])).rows[0]).toEqual({status:'error'});
  });
  it('retains security classification when reconciling a failed result',async()=>{
    await db.exec("update qa_package_results set outcome='Failed',virustotal_malicious=2");
    await db.query("select reconcile_qa_result_publication('test')");
    expect((await db.query("select status,failure_summary from qa_candidates")).rows[0]).toMatchObject({status:'failed',failure_summary:'VirusTotal blocked the published exact installer.'});
  });
  it('does not reconcile a contradictory passing result with malicious detections',async()=>{
    await db.exec('update qa_package_results set virustotal_malicious=2');
    expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(0);
  });
});
