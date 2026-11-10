import fs from 'node:fs';
import crypto from 'node:crypto';
import { expect, it } from 'vitest';
import { historicalFixture } from './installer-security-fixture';

const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/corrected-profile-prerequisite.json', import.meta.url), 'utf8')) as Array<{repairId:string;oldCandidateId:string;app:string;version:string;architecture:string;hash:string;url:string;oldProfile:string;newProfile:string;oldCanonicalJson:string}>;

it.each(fixtures)('prepares only the approved corrected profile without seeding a block: $architecture', async (f) => {
  const { pg } = await historicalFixture();
  const read = (name: string) => fs.readFileSync(new URL('../../supabase/migrations/' + name, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  try {
    await pg.exec('create table public.qa_installer_security_holds(sha256 text,released_at timestamptz); grant all on public.qa_installer_security_holds to service_role;');
    for (const name of ['20261012200751_qa_repair_current_profile_adoption.sql', '20261012225940_qa_deployment_profile_adoption.sql', '20261014222100_qa_terminal_failure_retest_guards.sql', '20261007224438_qa_candidate_conflict_free_insert.sql']) await pg.exec(read(name));
    const dependency = read('20261019125457_qa_vt_dependency_lookup.sql');
    const coverage = dependency.slice(dependency.indexOf('create function public.qa_vt_dependency_coverage'));
    await pg.exec(coverage.slice(0, coverage.indexOf('$$;') + 3));
    await pg.exec('revoke all on function public.qa_vt_dependency_coverage(uuid) from public,anon,authenticated;grant execute on function public.qa_vt_dependency_coverage(uuid) to service_role;');
    await pg.exec(read('20261110051729_qa_corrected_profile_repair.sql'));
    const security = read('20261012153307_qa_installer_security_holds.sql');
    const claimantStart = security.indexOf('do $$\ndeclare definition text; original text; anchor text; curated_anchor text;');
    expect(claimantStart).toBeGreaterThan(0);
    await pg.exec(security.slice(claimantStart, security.indexOf('\n$$;', claimantStart) + 4));
    await pg.exec(read('20261103104500_curated_hold_candidate_only.sql'));
    const claimBefore = (await pg.query<{ definition: string }>("select pg_get_functiondef('public.claim_qa_work(text,uuid,text)'::regprocedure) as definition")).rows[0].definition;
    const migrations = fs.readdirSync(new URL('../../supabase/migrations/', import.meta.url)).filter(n => n.endsWith('_qa_scoped_corrected_profile_retests.sql'));
    expect(migrations.length).toBeLessThanOrEqual(1);
    if (migrations.length) {
      // historicalFixture substitutes its test-only sync secret. Keep an exact
      // fixture pin while the shipped migration retains the deployed source pin.
      const migration = read(migrations[0]);
      const productionReporter = '3dda5c4f2820d93448e66655e39a7ce7e2ce68c3cc1ccd9076632ca018c8768e';
      expect(migration.split(productionReporter)).toHaveLength(2);
      const fixtureMigration = migration.replace(productionReporter, '3d46bbba82435e54602b378b6959c907596b9e2850d215720c5f34a54ba9bbd5');
      for (const signature of ['adopt_qa_repair_corrected_candidate(uuid,jsonb,text,text,text)', 'qa_retest_grant_eligible(uuid)', 'claim_qa_work(text,uuid,text)', 'create_qa_retest_grant(uuid,timestamptz,text)', 'report_qa_candidate_result(text,uuid,text,text)']) {
        await pg.exec('begin');
        await pg.exec('alter function public.' + signature + ' set search_path=public');
        await expect(pg.exec(fixtureMigration), signature).rejects.toThrow(/Reviewed corrected-profile sequence changed/);
        await pg.exec('rollback');
      }
      const anchors = Array.from(fixtureMigration.matchAll(/needle := \$needle\$([\s\S]*?)\$needle\$;/g), m => m[1]);
      expect(anchors).toHaveLength(4);
      for (const [index, needle] of anchors.entries()) {
        await pg.exec('begin');
        const missingAnchor = fixtureMigration.replace('needle := $needle$' + needle, 'needle := $needle$missing_' + needle);
        await expect(pg.exec(missingAnchor), 'missing anchor ' + index).rejects.toThrow(/anchor changed/);
        await pg.exec('rollback;begin');
        const signature = index === 0 ? 'public.adopt_qa_repair_corrected_candidate(uuid,jsonb,text,text,text)' : index === 3 ? 'public.claim_qa_work(text,uuid,text)' : 'public.qa_retest_grant_eligible(uuid)';
        const source = (await pg.query<{ definition: string }>('select pg_get_functiondef($1::regprocedure) as definition', [signature])).rows[0].definition;
        expect(source.split(needle)).toHaveLength(2);
        await pg.exec(source.replace(needle, needle + ' /* ' + needle + ' */'));
        const hash = (await pg.query<{ hash: string }>("select encode(extensions.digest(pg_get_functiondef($1::regprocedure),'sha256'),'hex') as hash", [signature])).rows[0].hash;
        const before = crypto.createHash('sha256').update(source).digest('hex');
        expect(fixtureMigration.split(before)).toHaveLength(2);
        // Only this rollback fixture's pin changes so the second-occurrence
        // anchor guard is reached; the shipped migration pins stay untouched.
        await expect(pg.exec(fixtureMigration.replace(before, hash)), 'duplicate anchor ' + index).rejects.toThrow(/anchor changed/);
        await pg.exec('rollback');
      }
      await pg.exec(fixtureMigration);
    }
    const oldCanonical = f.oldCanonicalJson;
    const corrected = JSON.parse(oldCanonical);
    corrected.installer.silentArgs = '/Q /C:"msiexec /i ""vcredist.msi"" /quiet /norestart"';
    const newCanonical = JSON.stringify(corrected);
    const digest = (s: string) => crypto.createHash('sha256').update(s).digest('hex').toUpperCase();
    expect(digest(oldCanonical)).toBe(f.oldProfile);
    expect(digest(newCanonical)).toBe(f.newProfile);
    const config = (s: string) => ({ profileKind: 'deployment-config', packageProfileCanonicalJson: s, packageProfileSha256: digest(s), psadtConfig: JSON.parse(s).psadtConfig, detectionRules: JSON.parse(s).detectionRules });
    const pin = corrected.toolchain.packagerCommit;
    await pg.query("insert into public.qa_pipeline_control(id,paused,required_packager_commit,scheduler_packager_commit,scheduler_seen_at) values('global',false,$1,$1,now())", [pin]);
    await pg.query("insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,installer_url,test_level,package_profile_sha256,test_config,status,phase,finished_at) values($1,$2,$3,$4,$5,$6,'psadt-package',$7,$8,'failed','publishing',now())", [f.oldCandidateId, f.app, f.version, f.architecture, f.hash, f.url, f.oldProfile, config(oldCanonical)]);
    await pg.query("insert into public.qa_repair_requests(id,candidate_id,winget_id,version,architecture,failure_class,status,prior_requeues) values($1,$2,$3,$4,$5,'app_lifecycle','pending',0)", [f.repairId, f.oldCandidateId, f.app, f.version, f.architecture]);
    await pg.query("insert into public.qa_package_results(package_profile_sha256,winget_id,tested_version,architecture,installer_sha256,outcome) values($1,$2,$3,$4,$5,'Failed')", [f.oldProfile, f.app, f.version, f.architecture, f.hash]);
    await pg.query("insert into public.catalog_file_reputation(sha256,status,malicious,suspicious,total_engines,engine_count_version,checked_at,analyzed_at,retry_after) values(lower($1),'found',0,0,70,2,now(),now(),now()+interval '1 day')", [f.hash]);
    const candidate = { winget_id: f.app, version: f.version, architecture: f.architecture, installer_url: f.url, installer_sha256: f.hash, installer_type: 'exe', installer_file_name: 'vcredist.exe', test_level: 'psadt-package', package_profile_sha256: f.newProfile, test_config: config(newCanonical) };
    const adopt = (repair = f.repairId, input = candidate, oldProfile = f.oldProfile, newProfile = f.newProfile) => pg.query<{ id: string }>('select public.adopt_qa_repair_corrected_candidate($1,$2,$3,$4,$5) as id', [repair, input, oldProfile, newProfile, 'exe-embedded-msi-target@1779']);
    const deniedAdoption = [
      ["budget", "update public.qa_repair_requests set prior_requeues=3"],
      ["pause", "update public.qa_pipeline_control set paused=true"],
      ["heartbeat", "update public.qa_pipeline_control set scheduler_seen_at=now()-interval '10 minutes'"],
      ["pin", "update public.qa_pipeline_control set scheduler_packager_commit=repeat('a',40)"],
      ["positive", "update public.catalog_file_reputation set malicious=1"],
      ["coverage", "update public.catalog_file_reputation set total_engines=null"],
      ["legacy reputation", "update public.catalog_file_reputation set engine_count_version=1"],
      ["stale reputation", "update public.catalog_file_reputation set checked_at=now()-interval '8 days'"],
      ["hold", "insert into public.qa_installer_security_holds(sha256) values(lower($1))"],
      ["exclusion", "insert into public.curated_excluded_apps(winget_id) values($2)"],
      ["eligibility", "insert into public.package_eligibility_blocks(winget_id) values($2)"],
      ["security repair", "update public.qa_repair_requests set failure_class='security'"],
      ["other block", "insert into public.qa_package_blocks(winget_id,version,architecture,installer_sha256,block_code) values($2,$3,$4,$1,'trusted_installer_tuple_unavailable')"],
      ["customer payload", "insert into public.packaging_jobs(winget_id,version,architecture,installer_sha256,status) values($2,$3,$4,$1,'awaiting_qa')"],
      ["old candidate customer", "insert into public.packaging_jobs(qa_candidate_id,status) values($5,'queued')"],
      ["dependency coverage", "create or replace function public.qa_vt_dependency_coverage(p_candidate_id uuid) returns boolean language sql as $$select false$$"],
    ];
    for (const [reason, sql] of deniedAdoption) {
      await pg.exec('begin');
      // Bind only the placeholders used by this fixed fixture mutation.
      const params = [f.hash, f.app, f.version, f.architecture, f.oldCandidateId];
      const used = [...new Set(Array.from(sql.matchAll(/\$(\d+)/g), m => Number(m[1])))].sort((a, b) => a - b);
      const statement = sql.replace(/\$(\d+)/g, (_, n) => '$' + (used.indexOf(Number(n)) + 1));
      await pg.query(statement, used.map(n => params[n - 1]));
      await pg.exec('set local role service_role');
      await expect(adopt(), reason).rejects.toThrow();
      await pg.exec('rollback');
      expect((await pg.query('select count(*)::int n from public.qa_repair_profile_corrections')).rows).toEqual([{ n: 0 }]);
    }
    for (const [oldProfile, newProfile] of [['F'.repeat(64), f.newProfile], [f.oldProfile, 'F'.repeat(64)]]) {
      await expect(adopt(f.repairId, candidate, oldProfile, newProfile)).rejects.toThrow();
    }
    await expect(adopt('00000000-0000-4000-8000-000000000001')).rejects.toThrow();
    // Exercise the complete non-allowlisted adoption, with all other gates met.
    const otherRepair = '00000000-0000-4000-8000-000000000001';
    await pg.exec('begin');
    await pg.query('update public.qa_repair_requests set id=$1', [otherRepair]);
    await expect(adopt(otherRepair)).rejects.toThrow(/owned or active/);
    await pg.exec('rollback;begin');
    // The legacy blocked path must still work after the new migration, even
    // when the repair does not qualify for the two-tuple exception.
    await pg.query('update public.qa_repair_requests set id=$1', [otherRepair]);
    await pg.query("insert into public.qa_package_blocks(winget_id,version,architecture,installer_sha256,block_code) values($1,$2,$3,$4,'failed_managed_lifecycle')", [f.app, f.version, f.architecture, f.hash]);
    await pg.exec('set local role service_role');
    const legacyId = (await adopt(otherRepair)).rows[0].id;
    expect((await pg.query('select public.qa_retest_grant_eligible($1) as allowed', [legacyId])).rows[0]).toEqual({ allowed: false });
    await pg.query("update public.qa_candidates set status='queued',next_retry_at=now() where id=$1", [legacyId]);
    expect((await pg.query<{ result: { reason: string } }>("select public.claim_qa_work('ordinary',$1,$2) as result", [legacyId, pin])).rows[0].result.reason).toBe('package_compatibility_blocked');
    await pg.query("update public.qa_candidates set status='superseded' where id=$1", [legacyId]);
    await pg.query("select public.create_qa_retest_grant($1,now()+interval '1 hour','legacy fixture')", [legacyId]);
    expect((await pg.query('select public.qa_retest_grant_eligible($1) as allowed', [legacyId])).rows[0]).toEqual({ allowed: true });
    await pg.query('update public.qa_retest_grants set closed_at=now()');
    expect((await pg.query('select public.qa_retest_grant_eligible($1) as allowed', [legacyId])).rows[0]).toEqual({ allowed: false });
    await pg.exec('rollback');
    const oldRow = (await pg.query('select to_jsonb(c) as row from public.qa_candidates c where id=$1', [f.oldCandidateId])).rows[0];
    await pg.query("insert into public.packaging_jobs(qa_candidate_id,status) values($1,'qa_failed')", [f.oldCandidateId]);
    const oldCustomers = (await pg.query('select to_jsonb(j) as row from public.packaging_jobs j')).rows;
    await pg.exec('set role service_role');
    const id = (await adopt()).rows[0].id;
    expect((await adopt()).rows[0].id).toBe(id);
    expect((await pg.query('select count(*)::int n from public.qa_package_blocks')).rows).toEqual([{ n: 0 }]);
    expect((await pg.query('select status,priority from public.qa_candidates where package_profile_sha256=$1', [f.newProfile])).rows).toEqual([{ status: 'superseded', priority: 10 }]);
    expect((await pg.query('select count(*)::int n from public.qa_retest_grants')).rows).toEqual([{ n: 0 }]);
    const allowArgs = [f.repairId, f.oldCandidateId, f.oldProfile, f.newProfile, 'exe-embedded-msi-target@1779', f.app, f.version, f.architecture, f.hash];
    const allowed = (args: Array<string | null>) => pg.query<{ allowed: boolean }>('select public.qa_corrected_profile_prerequisite_exception($1,$2,$3,$4,$5,$6,$7,$8,$9) as allowed', args);
    expect((await allowed(allowArgs)).rows[0].allowed).toBe(true);
    for (let i = 0; i < allowArgs.length; i++) {
      const args: Array<string | null> = [...allowArgs]; args[i] = null;
      expect((await allowed(args)).rows[0].allowed, 'NULL argument ' + i).toBe(false);
    }
    for (const [index, value] of [[0, '00000000-0000-4000-8000-000000000001'], [1, '00000000-0000-4000-8000-000000000001'], [2, 'F'.repeat(64)], [3, 'F'.repeat(64)], [4, 'other-contract'], [5, 'Other.App'], [6, '999'], [7, 'arm64'], [8, 'F'.repeat(64)]] as const) {
      const args = [...allowArgs]; args[index] = value;
      expect((await allowed(args)).rows[0].allowed, 'altered tuple field ' + index).toBe(false);
    }
    for (const role of ['anon', 'authenticated']) expect((await pg.query('select has_function_privilege($1,$2,$3) as allowed', [role, 'public.qa_corrected_profile_prerequisite_exception(uuid,uuid,text,text,text,text,text,text,text)', 'EXECUTE'])).rows[0]).toEqual({ allowed: false });
    // The operator route can queue a superseded row. It must not bypass grants.
    await pg.query("update public.qa_candidates set status='queued',next_retry_at=now() where id=$1", [id]);
    const claim = () => pg.query<{ result: { reason?: string; row?: { id: string } } }>("select public.claim_qa_work('ordinary',$1,$2) as result", [id, pin]);
    // The deployed claim admitted this queued lineage without a grant. Prove
    // that exact red behavior in a transaction, then restore the patched claim.
    await pg.exec('reset role;begin'); await pg.exec(claimBefore);
    expect((await claim()).rows[0].result.row?.id).toBe(id);
    await pg.exec('rollback;set role service_role');
    expect((await claim()).rows[0].result.reason).toBe('package_compatibility_blocked');
    await pg.query("update public.qa_candidates set status='superseded' where id=$1", [id]);
    for (const [column, value] of [['qa_candidate_id', id], ['qa_candidate_id', f.oldCandidateId]]) {
      await pg.exec('begin');
      await pg.query(`insert into public.packaging_jobs(${column},status) values($1,'packaging')`, [value]);
      await expect(pg.query("select public.create_qa_retest_grant($1,now()+interval '1 hour','guarded fixture')", [id])).rejects.toThrow();
      await pg.exec('rollback');
    }
    await pg.query("select public.create_qa_retest_grant($1,now()+interval '1 hour','guarded fixture')", [id]);
    const eligible = () => pg.query<{ allowed: boolean }>('select public.qa_retest_grant_eligible($1) as allowed', [id]);
    expect((await eligible()).rows[0].allowed).toBe(true);
    await pg.exec('begin');
    await pg.query("insert into public.qa_candidates(id,winget_id,version,architecture,installer_sha256,test_level,status,priority,enqueued_at,next_retry_at) values(gen_random_uuid(),'Example.Customer','1','x64',repeat('A',64),'psadt-package','queued',2100,now(),now())");
    expect((await claim()).rows[0].result.reason).toBe('higher_priority_work');
    await pg.exec('rollback;begin');
    await pg.query("update public.qa_candidates set status='running' where id=$1", [f.oldCandidateId]);
    expect((await claim()).rows[0].result.reason).toBe('qa_active');
    await pg.exec('rollback');
    for (const [reason, sql] of [
      ['expired grant', "update public.qa_retest_grants set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'"],
      ['closed grant', "update public.qa_retest_grants set closed_at=now()"],
      ['canonical drift', "update public.qa_candidates set test_config=jsonb_set(test_config,'{packageProfileCanonicalJson}',to_jsonb('invalid'::text)) where id=$1"],
      ['config drift', "update public.qa_candidates set test_config=jsonb_set(test_config,'{psadtConfig}','{}') where id=$1"],
      ['profile drift', "update public.qa_candidates set package_profile_sha256=repeat('F',64) where id=$1"],
      ['other block', "insert into public.qa_package_blocks(winget_id,version,architecture,installer_sha256,block_code) select winget_id,version,architecture,installer_sha256,'trusted_installer_tuple_unavailable' from public.qa_candidates where id=$1"],
    ]) {
      await pg.exec('begin');
      await pg.query(sql, sql.includes('$1') ? [id] : []);
      expect((await eligible()).rows[0].allowed, reason).toBe(false);
      await pg.exec('rollback');
    }
    await pg.exec('reset role');
    for (const sql of [
      "update public.qa_repair_profile_corrections set old_profile=repeat('F',64)",
      "update public.qa_candidates set test_config=jsonb_set(test_config,'{packageProfileCanonicalJson}',to_jsonb('invalid'::text)) where id='" + f.oldCandidateId + "'",
      "update public.qa_candidates set test_config=jsonb_set(test_config,'{detectionRules}','[]') where id='" + f.oldCandidateId + "'",
      "update public.qa_candidates set version='999' where id='" + f.oldCandidateId + "'",
      "update public.qa_candidates set installer_sha256=repeat('F',64) where id='" + f.oldCandidateId + "'",
    ]) {
      await pg.exec('begin'); await pg.exec(sql);
      await pg.exec('set local role service_role');
      expect((await eligible()).rows[0].allowed).toBe(false);
      await pg.exec('rollback');
    }
    await pg.exec('begin');
    await expect(pg.exec("update public.qa_repair_profile_corrections set contract='other-contract'")).rejects.toThrow(/contract_check/);
    await pg.exec('rollback;begin');
    await expect(pg.exec('update public.qa_repair_profile_corrections set old_candidate_id=new_candidate_id')).rejects.toThrow();
    await pg.exec('rollback');
    await pg.exec('set role service_role');
    expect((await claim()).rows[0].result.row?.id).toBe(id);
    expect((await claim()).rows[0].result.reason).toBe('qa_active');
    await pg.query("update public.qa_candidates set status='running',phase='installing' where id=$1", [id]);
    await pg.query("select public.report_qa_candidate_result('local-fixture-only',$1,'failed','guarded fixture')", [id]);
    expect((await pg.query('select status,prior_requeues from public.qa_repair_requests')).rows).toEqual([{ status: 'pending', prior_requeues: 1 }]);
    expect((await adopt()).rows[0].id).toBe(id);
    await pg.query('update public.qa_repair_requests set prior_requeues=3');
    await expect(pg.query("select public.create_qa_retest_grant($1,now()+interval '1 hour','budget fixture')", [id])).rejects.toThrow();
    await pg.query('update public.qa_repair_requests set prior_requeues=1');
    await pg.query("select public.create_qa_retest_grant($1,now()+interval '1 hour','verified fixture')", [id]);
    expect((await claim()).rows[0].result.row?.id).toBe(id);
    await pg.query("update public.qa_candidates set status='running',phase='installing' where id=$1", [id]);
    await pg.query("select public.report_qa_candidate_result('local-fixture-only',$1,'passed',null)", [id]);
    expect((await pg.query('select status,prior_requeues from public.qa_repair_requests')).rows).toEqual([{ status: 'resolved', prior_requeues: 1 }]);
    expect((await pg.query('select to_jsonb(c) as row from public.qa_candidates c where id=$1', [f.oldCandidateId])).rows[0]).toEqual(oldRow);
    expect((await pg.query('select to_jsonb(j) as row from public.packaging_jobs j')).rows).toEqual(oldCustomers);
    expect((await pg.query('select count(*)::int n from public.qa_package_blocks')).rows).toEqual([{ n: 0 }]);
    expect((await pg.query('select count(*)::int n from public.curated_apps')).rows).toEqual([{ n: 0 }]);
  } finally { await pg.close(); }
}, 30000);
