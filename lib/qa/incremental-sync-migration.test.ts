import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

describe('bounded nondeleting QA publication sync in PostgreSQL', () => {
  let db: PGlite;
  const secret = 'synthetic-local-test-only';
  const stamp = '2026-10-11T14:00:00Z';
  const recipe = [{ winget_id: 'Vendor.App', definition_path: 'qa/apps/vendor.app.json', architecture: 'x64', installer_type: 'exe' }];
  const row = (extra: Record<string, unknown> = {}) => ({ winget_id: 'Vendor.App', display_name: 'App', publisher: 'Vendor', tested_version: '1', architecture: 'x64', outcome: 'Passed', tested_at_utc: stamp, synced_at: stamp, profile_kind: 'catalog-default', test_level: 'installer-preflight', environment: { executionContext: 'LocalSystem' }, ...extra });
  beforeAll(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create schema extensions; create extension pgcrypto with schema extensions;
create table public.curated_sync_status (id text,last_run_started_at timestamptz,last_run_completed_at timestamptz,last_run_status text,items_processed integer,error_message text,metadata jsonb,updated_at timestamptz,last_successful_sync_at timestamptz,primary key(id));
create table public.qa_results (winget_id text,display_name text,publisher text,tested_version text,architecture text,outcome text,tested_at_utc timestamptz,overall_duration_seconds numeric,installer_type text,install_command text,uninstall_command text,detection jsonb,phase_results jsonb,changes jsonb,relevant_event_count integer,environment jsonb,test_id text,github_run_id text,github_run_attempt integer,qa_schema_version integer,synced_at timestamptz,installer_sha256 text,test_level text,package_profile_sha256 text,psadt_version text,psadt_template_sha256 text,psadt_config_sha256 text,detection_rules_sha256 text,packager_commit text,package_content_sha256 text,effective_configuration jsonb,virustotal_status text,virustotal_malicious integer,virustotal_suspicious integer,virustotal_total_engines integer,virustotal_scanned_at_utc timestamptz,primary key(winget_id));
create table public.qa_recipes (winget_id text,definition_path text,architecture text,installer_type text,active boolean,updated_at timestamptz,primary key(winget_id));
create table public.qa_package_results (package_profile_sha256 text,winget_id text,tested_version text,architecture text,installer_sha256 text,outcome text,tested_at_utc timestamptz,psadt_version text,psadt_template_sha256 text,psadt_config_sha256 text,detection_rules_sha256 text,packager_commit text,package_content_sha256 text,github_run_id text,github_run_url text,synced_at timestamptz,overall_duration_seconds numeric,display_name text,publisher text,installer_type text,install_command text,uninstall_command text,detection jsonb,phase_results jsonb,changes jsonb,relevant_event_count integer,environment jsonb,effective_configuration jsonb,qa_schema_version integer,profile_kind text,virustotal_status text,virustotal_malicious integer,virustotal_suspicious integer,virustotal_total_engines integer,virustotal_scanned_at_utc timestamptz,primary key(package_profile_sha256));
create table public.qa_sync_watermarks (id text,source_synced_at timestamptz,accepted_at timestamptz,primary key(id));
      insert into qa_sync_watermarks values ('canonical-results','2026-10-10T00:00:00Z',now());
      insert into qa_results(winget_id,tested_at_utc,outcome) values ('Vendor.Existing','2026-10-10T00:00:00Z','Failed');`);
    // The fixture substitutes only the credential hash with a local synthetic
    // value; no production credential is read, requested or used by this test.
    const sql = readFileSync('supabase/migrations/20261011142500_bounded_qa_publication_sync.sql', 'utf8')
      .replaceAll('becb40ddd30dcf9fc45551f1ff4e515ea1512cb9692d977f44f0323a216d0921', createHash('sha256').update(secret).digest('hex'));
    await db.exec(sql);
  });
  afterAll(async () => { await db?.close(); });
  const sync = (rows: unknown[], credential = secret) => db.query('select sync_qa_results_incremental($1,$2::jsonb,$3::jsonb) result', [credential, JSON.stringify(rows), JSON.stringify(recipe)]);
  it('upserts without deleting omitted records or changing the full-snapshot watermark', async () => {
    await sync([row()]);
    expect((await db.query('select winget_id from qa_results order by winget_id')).rows).toEqual([{ winget_id: 'Vendor.App' }, { winget_id: 'Vendor.Existing' }]);
    expect((await db.query("select source_synced_at::text stamp from qa_sync_watermarks")).rows[0]).toEqual({ stamp: '2026-10-10 00:00:00+00' });
  });
  it('allows truthful same-time corrections and refuses a stale overwrite', async () => {
    await sync([row({ outcome: 'Failed' })]);
    await sync([row({ outcome: 'Passed', tested_at_utc: '2026-10-09T00:00:00Z' })]);
    expect((await db.query("select outcome from qa_results where winget_id='Vendor.App'")).rows[0]).toEqual({ outcome: 'Failed' });
  });
  it('rejects bad and empty credentials', async () => {
    await expect(sync([row()], 'wrong')).rejects.toThrow(/credential/);
    await expect(sync([row()], '')).rejects.toThrow(/credential/);
  });
  it('retains exact profile identity and security evidence across retries', async () => {
    const profile = row({ test_level: 'psadt-package', profile_kind: 'deployment-config', package_profile_sha256: 'A'.repeat(64), installer_sha256: 'B'.repeat(64), virustotal_status: 'flagged', virustotal_malicious: 2, outcome: 'Failed' });
    await sync([profile]); await sync([profile]);
    await sync([{ ...profile, tested_at_utc: '2026-10-09T00:00:00Z', outcome: 'Passed', virustotal_status: 'clean', virustotal_malicious: 0 }]);
    expect((await db.query('select outcome,virustotal_status,virustotal_malicious from qa_package_results')).rows).toEqual([{ outcome: 'Failed', virustotal_status: 'flagged', virustotal_malicious: 2 }]);
  });
  it('rejects empty, oversized and malformed batches before any write', async () => {
    await expect(sync([])).rejects.toThrow(/bounds/);
    await expect(sync(Array.from({ length: 101 }, () => row()))).rejects.toThrow(/bounds/);
    await expect(sync([row({ changes: { text: 'x'.repeat(1_000_001) } })])).rejects.toThrow(/bounds/);
    await expect(db.query("select sync_qa_results_incremental($1,'{}'::jsonb,$2::jsonb)", [secret, JSON.stringify(recipe)])).rejects.toThrow();
  });
  it('does not expose private helpers to the public execution roles', async () => {
    expect((await db.query("select has_function_privilege('anon','sync_qa_results_incremental(text,jsonb,jsonb)','execute') api, has_function_privilege('anon','sync_qa_results_incremental_base(text,jsonb,boolean)','execute') helper")).rows[0]).toEqual({ api: true, helper: false });
  });
  it('keeps package rows private while permitting bounded secret authenticated page reads', async () => {
    expect((await db.query("select has_table_privilege('anon','qa_package_results','select') allowed")).rows[0]).toEqual({ allowed: false });
    await db.exec('set role anon');
    try {
      await expect(db.query('select * from qa_package_results')).rejects.toThrow(/permission denied/);
      await expect(db.query('select * from read_qa_package_results_page($1,$2,$3)', ['wrong', null, 500])).rejects.toThrow(/credential/);
      await expect(db.query('select * from read_qa_package_results_page($1,$2,$3)', [secret, null, 501])).rejects.toThrow(/bounds/);
      const first = await db.query<{ result: { package_profile_sha256: string } }>('select read_qa_package_results_page($1,$2,$3) result', [secret, null, 1]);
      expect(first.rows[0].result.package_profile_sha256).toBe('A'.repeat(64));
      expect((await db.query('select * from read_qa_package_results_page($1,$2,$3)', [secret, 'A'.repeat(64), 500])).rows).toEqual([]);
    } finally { await db.exec('reset role'); }
  });
  it('normalizes empty canonical profiles consistently with hashes and VirusTotal evidence', async () => {
    await sync([row({ winget_id: 'Vendor.Empty', installer_sha256: 'C'.repeat(64), outcome: 'Failed' })]);
    await sync([row({ winget_id: 'Vendor.Empty', profile_kind: '', test_level: 'psadt-package', package_profile_sha256: 'D'.repeat(64), installer_sha256: 'E'.repeat(64), tested_at_utc: '2026-10-11T15:00:00Z', display_name: 'Updated app', virustotal_status: 'clean', virustotal_malicious: 0 })]);
    expect((await db.query("select outcome,display_name,installer_sha256,tested_at_utc::text stamp,virustotal_status from qa_results where winget_id='Vendor.Empty'")).rows[0]).toEqual({ outcome: 'Passed', display_name: 'Updated app', installer_sha256: 'E'.repeat(64), stamp: '2026-10-11 15:00:00+00', virustotal_status: 'clean' });
    expect((await db.query("select profile_kind from qa_package_results where winget_id='Vendor.Empty'")).rows[0]).toEqual({ profile_kind: 'catalog-default' });
  });
  it('rejects duplicate canonical identities after empty profile normalization', async () => {
    await expect(sync([row({ winget_id: 'Vendor.Duplicate', profile_kind: '' }), row({ winget_id: 'Vendor.Duplicate', profile_kind: 'catalog-default' })])).rejects.toThrow(/must be present and unique/);
    expect((await db.query("select winget_id from qa_results where winget_id='Vendor.Duplicate'")).rows).toEqual([]);
  });
});
