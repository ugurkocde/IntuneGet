import fs from 'node:fs';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export async function historicalFixture() {
  const pg = new PGlite({ extensions: { pgcrypto } });
  const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  await pg.exec('create schema extensions; create extension pgcrypto with schema extensions; create role anon; create role authenticated; create role service_role bypassrls;');
  for (const table of JSON.parse(read('./fixtures/diagnostic-retest-schema.json'))) {
    const columns = table.columns.map((column: { name: string; data_type: string; format: string }) => `"${column.name}" ${column.data_type === 'ARRAY' ? column.format.slice(1) + '[]' : column.data_type === 'USER-DEFINED' ? 'text' : column.data_type}${column.name === 'id' && column.data_type === 'uuid' ? ' default gen_random_uuid()' : ''}`);
    if (table.columns.some((column: { name: string }) => column.name === 'id')) columns.push('primary key(id)');
    if (table.name === 'public.qa_repair_requests') columns.push('unique(candidate_id)');
    await pg.exec(`create table ${table.name} (${columns.join(',')});`);
  }
  await pg.exec('create table public.catalog_file_reputation(sha256 text primary key,status text,malicious integer,suspicious integer,total_engines integer,analyzed_at timestamptz,checked_at timestamptz,retry_after timestamptz,engine_count_version integer); grant usage on schema public,extensions to service_role; grant all on all tables in schema public to service_role;');
  const baseline = JSON.parse(read('./fixtures/diagnostic-retest-functions.json'));
  await pg.exec(baseline.claimant);
  await pg.exec(baseline.reporter.replace(/expected_secret_hash constant text := '[a-f0-9]{64}'/, `expected_secret_hash constant text := '${crypto.createHash('sha256').update('local-fixture-only').digest('hex')}'`));
  await pg.exec(read('../../supabase/migrations/20261011075101_qa_guarded_diagnostic_retests.sql').replace(/\r\n/g, '\n'));
  return { pg, read };
}
