import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {beforeEach,afterEach,describe,it,expect} from 'vitest';
let db:PGlite;
const migration=readFileSync(new URL('../../supabase/migrations/20261006130101_qa_publication_recovery.sql',import.meta.url),'utf8');
const isolationMigration=readFileSync(new URL('../../supabase/migrations/20261006140531_qa_publication_error_isolation.sql',import.meta.url),'utf8');
const retryMigration=readFileSync(new URL('../../supabase/migrations/20261006142952_qa_publication_retry_fairness.sql',import.meta.url),'utf8');
const terminalMigration=readFileSync(new URL('../../supabase/migrations/20261007111629_qa_publication_terminal_reconciliation.sql',import.meta.url),'utf8');
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
    await db.exec(isolationMigration);
    await db.exec(retryMigration);
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
  it('rolls back a constraint failure for one row and settles the next candidate',async()=>{
    await db.exec(`
      insert into qa_candidates select '00000000-0000-4000-8000-000000000002',winget_id,version,architecture,installer_sha256,'profile2',github_run_url,started_at+interval '1 minute',dispatched_at,finished_at,updated_at,phase_started_at,phase_updated_at,activity_updated_at,log_updated_at,phase,status,test_level,attempts,github_run_id,live_activity,live_log,failure_summary from qa_candidates;
      insert into qa_package_results select 'profile2',winget_id,tested_version,architecture,installer_sha256,github_run_url,tested_at_utc,outcome,virustotal_malicious from qa_package_results;
      alter table qa_candidates add constraint result_check check(id<>'00000000-0000-4000-8000-000000000001' or status<>'passed');
    `);
    expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(1);
    expect((await db.query('select status,attempts,failure_summary from qa_candidates where id=$1',[id])).rows[0]).toEqual({status:'error',attempts:1,failure_summary:'Publication reconciliation deferred (SQLSTATE 23514).'});
    expect((await db.query("select status from qa_candidates where id='00000000-0000-4000-8000-000000000002'")).rows[0]).toEqual({status:'passed'});
  });
  it('propagates an authentication failure from the reporter and rolls back the transition',async()=>{
    await db.exec(`create or replace function report_qa_candidate_result(secret text,candidate uuid,outcome text,summary text) returns boolean language plpgsql as $$
      begin raise insufficient_privilege using message='Invalid reporting credential';end;$$;`);
    await expect(db.query("select reconcile_qa_result_publication('test')")).rejects.toThrow(/credential/);
    expect((await db.query('select status from qa_candidates where id=$1',[id])).rows[0]).toEqual({status:'error'});
  });
  it('lets fresh evidence bypass 100 poisoned rows and retries them after repair without leaking private errors',async()=>{
    const recoverable='00000000-0000-4000-8000-000000000101';
    await db.exec(`
      insert into qa_candidates(id,winget_id,version,architecture,installer_sha256,package_profile_sha256,github_run_url,started_at,phase,status,test_level,attempts)
        select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Example.App','1','x64','hash','profile'||n,
          'https://github.com/owner/repo/actions/runs/123','2026-10-06T00:00Z'::timestamptz+n*interval '1 second','publishing','error','psadt-package',1
        from generate_series(2,101) n;
      insert into qa_package_results
        select 'profile'||n,'Example.App','1','x64','hash','https://github.com/owner/repo/actions/runs/123','2026-10-06T01:00Z','Passed',0
        from generate_series(2,101) n;
      create or replace function report_qa_candidate_result(secret text,candidate uuid,outcome text,summary text) returns boolean language plpgsql as $$
      begin
        if candidate<>'${recoverable}' then raise exception using errcode='23514',message='Private customer value from a constraint';end if;
        update qa_candidates set status=outcome,failure_summary=summary where id=candidate and status='running';return found;
      end;$$;
    `);
    expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(0);
    expect((await db.query<{count:number}>("select count(*)::int count from qa_candidates where failure_summary='Publication reconciliation deferred (SQLSTATE 23514).'")).rows[0].count).toBe(100);
    expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(1);
    expect((await db.query('select status,attempts,github_run_url from qa_candidates where id=$1',[recoverable])).rows[0]).toEqual({status:'passed',attempts:1,github_run_url:'https://github.com/owner/repo/actions/runs/123'});
    expect((await db.query<{leaked:boolean}>("select coalesce(bool_or(failure_summary like '%Private%'),false) leaked from qa_candidates")).rows[0].leaked).toBe(false);
    await db.exec(`create or replace function report_qa_candidate_result(secret text,candidate uuid,outcome text,summary text) returns boolean language plpgsql as $$
      begin update qa_candidates set status=outcome,failure_summary=summary where id=candidate and status='running';return found;end;$$;`);
    expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(100);
    expect((await db.query<{count:number}>("select count(*)::int count from qa_candidates where status='passed' and failure_summary is null and attempts=1")).rows[0].count).toBe(101);
  });
  it('does not reconcile a contradictory passing result with malicious detections',async()=>{
    await db.exec('update qa_package_results set virustotal_malicious=2');
    expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(0);
  });
  describe('terminal reconciliation while another candidate is active or queued',()=>{
    beforeEach(async()=>{
      // Use the production reporter's predicate and parameter names so the
      // guarded migration is exercised, including its exact-evidence gate.
      await db.exec(`
        drop function report_qa_candidate_result(text,uuid,text,text);
        create function report_qa_candidate_result(p_secret text,p_candidate_id uuid,p_outcome text,p_summary text)
        returns boolean language plpgsql as $$
        declare normalized_outcome text := lower(p_outcome);
        begin
          if p_secret <> 'test' then raise insufficient_privilege using message='Invalid reporting credential';end if;
          update public.qa_candidates set status=normalized_outcome,failure_summary=p_summary
          where id = p_candidate_id and status in ('dispatched', 'running');
          return found;
        end;$$;
        create unique index qa_candidates_single_active_idx on qa_candidates ((true)) where status in ('dispatched','running');
        create unique index qa_candidates_one_active_payload_idx on qa_candidates (winget_id,version,architecture,installer_sha256) where status in ('queued','dispatched','running');
      `);
    });
    it('reproduces the active-slot collision, then reconciles without disturbing the running VM',async()=>{
      await db.exec(`insert into qa_candidates(id,winget_id,status,phase,attempts) values('00000000-0000-4000-8000-000000000002','Other.App','running','installing',1)`);
      expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(0);
      expect((await db.query('select failure_summary from qa_candidates where id=$1',[id])).rows[0].failure_summary).toContain('23505');
      await db.exec(terminalMigration);
      expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(1);
      expect((await db.query('select status,attempts,github_run_url from qa_candidates where id=$1',[id])).rows[0]).toEqual({status:'passed',attempts:1,github_run_url:'https://github.com/owner/repo/actions/runs/123'});
      expect((await db.query("select status,phase,attempts from qa_candidates where winget_id='Other.App'")).rows[0]).toEqual({status:'running',phase:'installing',attempts:1});
    });
    it('reconciles without activating a duplicate queued payload',async()=>{
      await db.exec(`insert into qa_candidates(id,winget_id,version,architecture,installer_sha256,status,attempts) values('00000000-0000-4000-8000-000000000002','Example.App','1','x64','hash','queued',0)`);
      await db.exec(terminalMigration);
      expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(1);
      expect((await db.query("select status,attempts from qa_candidates where id='00000000-0000-4000-8000-000000000002'")).rows[0]).toEqual({status:'queued',attempts:0});
    });
    it.each(["tested_version='2'","architecture='x86'","installer_sha256='other'","github_run_url='other'","tested_at_utc='2026-10-05T01:00Z'","outcome='Failed'","virustotal_malicious=1"])
    ('the reporter refuses terminal settlement with mismatched evidence: %s',async change=>{
      await db.exec(terminalMigration);
      await db.exec('update qa_package_results set '+change);
      expect((await db.query<{allowed:boolean}>("select report_qa_candidate_result('test',$1,'passed',null) allowed",[id])).rows[0].allowed).toBe(false);
      expect((await db.query('select status from qa_candidates where id=$1',[id])).rows[0].status).toBe('error');
    });
    it('keeps security classification and authentication on the terminal path',async()=>{
      await db.exec(terminalMigration);
      await expect(db.query("select reconcile_qa_result_publication('bad')")).rejects.toThrow(/credential/);
      await db.exec("update qa_package_results set outcome='Failed',virustotal_malicious=2");
      expect((await db.query<{count:number}>("select reconcile_qa_result_publication('test') count")).rows[0].count).toBe(1);
      expect((await db.query('select status,failure_summary from qa_candidates where id=$1',[id])).rows[0]).toEqual({status:'failed',failure_summary:'VirusTotal blocked the published exact installer.'});
    });
  });
});
