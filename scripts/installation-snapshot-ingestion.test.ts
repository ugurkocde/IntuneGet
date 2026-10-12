import { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeSnapshot } from '../.github/scripts/scan-snapshot-ingest.mjs';

type Scan = ReturnType<typeof scan>;
function scan(status: 'completed' | 'failed' | 'skipped', version = '1.0') {
  return {
    winget_id: 'Example.Application', version, status,
    scanned_at: '2026-10-01T12:00:00Z', scan_duration_seconds: 12,
    error: status === 'completed' ? null : `${status} current attempt`,
    registry_changes: { added: [status], modified: [], removed: [] },
    file_changes: { added: [status], modified: [], removed: [] },
    shortcuts_created: [], services_created: [],
    install_path: status === 'completed' ? 'C:\\Example' : null,
    uninstall_string: status === 'completed' ? 'uninstall-example' : null,
    quiet_uninstall_string: null, installed_size_bytes: 100,
    os_version: 'Windows', architecture: 'x64',
  };
}

const workflow = parse(readFileSync(new URL('../.github/workflows/scan-apps.yml', import.meta.url), 'utf8'));
const ingestionStep = workflow.jobs.upload.steps.find((step: { name?: string }) => step.name === 'Upload validated results to Supabase');
const inlineSource = ingestionStep.run.match(/node <<'NODE'\n([\s\S]*?)\nNODE\s*$/)?.[1];
if (!inlineSource) throw new Error('Workflow ingestion source not found');
// Await the actual workflow entrypoint without invoking process.exit in the test host.
const source = inlineSource.replace(/main\(\)\.catch\(error => \{ console\.error\(error\); process\.exit\(1\); \}\);\s*$/, 'await main();')
  .replace("await import('./.github/scripts/scan-snapshot-ingest.mjs')", "require('scan-snapshot-ingest')");
if (source === inlineSource) throw new Error('Workflow entrypoint changed; update the ingestion harness');

let db: PGlite;
const jsonColumns = new Set(['registry_changes', 'file_changes', 'shortcuts_created', 'services_created']);
beforeAll(async () => {
  db = new PGlite();
  const migration = readFileSync(new URL('../supabase/migrations/004_curated_app_catalog.sql', import.meta.url), 'utf8');
  const definition = migration.match(/CREATE TABLE IF NOT EXISTS installation_snapshots \([\s\S]*?\n\);/)?.[0];
  if (!definition) throw new Error('Snapshot table definition not found');
  await db.exec(definition);
  const quietColumn = readFileSync(new URL('../supabase/migrations/005_add_quiet_uninstall_string.sql', import.meta.url), 'utf8')
    .match(/ALTER TABLE installation_snapshots\s+ADD COLUMN IF NOT EXISTS quiet_uninstall_string TEXT;/)?.[0];
  if (!quietColumn) throw new Error('Quiet uninstall column migration not found');
  await db.exec(quietColumn);
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () => db.exec('truncate installation_snapshots restart identity'));

type Request = { url: URL; method: string; prefer: string; body: Record<string, unknown> };
async function ingest(results: Scan[], beforeRequest?: (request: Request) => Promise<Response | void>) {
  const requests: Request[] = [];
  let sync: Record<string, unknown> | undefined;
  let summary: { completed: number; failed: number; skipped: number; uploaded: number; preserved: number; results: Scan[] } | undefined;
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false }, global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      const prefer = headers.get('Prefer') ?? '';
      const request = { url, method: init?.method ?? 'GET', prefer, body };
      requests.push(request);
      const intercepted = await beforeRequest?.(request);
      if (intercepted) return intercepted;
      if (url.pathname.endsWith('/curated_sync_status')) {
        sync = body;
        return new Response(null, { status: 201 });
      }
      if (!url.pathname.endsWith('/installation_snapshots')) throw new Error('Unexpected ingestion request');
      if (request.method === 'GET') {
        expect(url.searchParams.get('select')).toBe('id,scan_status');
        const result = await db.query('select id,scan_status from installation_snapshots where winget_id=$1 and version=$2',
          [url.searchParams.get('winget_id')?.slice(3), url.searchParams.get('version')?.slice(3)]);
        return new Response(JSON.stringify(result.rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const columns = Object.keys(body);
      if (columns.some(column => !/^[a-z_]+$/.test(column))) throw new Error('Invalid column identifier');
      const quoted = columns.map(column => `"${column}"`);
      const values = columns.map(column => jsonColumns.has(column) ? JSON.stringify(body[column]) : body[column]);
      let result;
      if (request.method === 'PATCH') {
        expect(url.searchParams.get('or')).toBe('(scan_status.is.null,scan_status.neq.completed)');
        expect(url.searchParams.get('select')).toBe('id');
        expect(prefer).toContain('return=representation');
        result = await db.query(`update installation_snapshots set ${quoted.map((column, i) => `${column}=$${i + 1}`).join(',')}
          where winget_id=$${columns.length + 1} and version=$${columns.length + 2} and scan_status is distinct from 'completed' returning id`,
        [...values, url.searchParams.get('winget_id')?.slice(3), url.searchParams.get('version')?.slice(3)]);
      } else {
        expect(request.method).toBe('POST');
        expect(url.searchParams.get('on_conflict')).toBe('winget_id,version');
        const update = prefer.includes('resolution=ignore-duplicates') ? 'nothing' : `update set ${quoted.map(column => `${column} = excluded.${column}`).join(',')}`;
        result = await db.query(`insert into installation_snapshots (${quoted.join(',')}) values (${columns.map((_, i) => `$${i + 1}`).join(',')}) on conflict (winget_id,version) do ${update} returning id`, values);
      }
      return prefer.includes('return=representation')
        ? new Response(JSON.stringify(result.rows), { status: 201, headers: { 'Content-Type': 'application/json' } })
        : new Response(null, { status: 201 });
    } },
  });
  const process = { env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'test-key', EXPECTED_COUNT: String(results.length) }, exitCode: 0 };
  const fs = {
    existsSync: () => true,
    readdirSync: () => results.map((_, i) => `${i}.json`),
    readFileSync: (path: string) => JSON.stringify(results[Number(path.match(/(\d+)\.json$/)?.[1])]),
    writeFileSync: (_path: string, content: string) => { summary = JSON.parse(content); },
  };
  const require = (name: string) => {
    if (name === 'node:fs') return fs;
    if (name === 'node:path') return { join: (...parts: string[]) => parts.join('/') };
    if (name === '@supabase/supabase-js') return { createClient: () => client };
    if (name === 'scan-snapshot-ingest') return { writeSnapshot };
    throw new Error(`Unexpected dependency ${name}`);
  };
  await runInNewContext(`(async () => { ${source} })()`, { require, process, console, Date });
  return { requests, sync, summary, exitCode: process.exitCode };
}

async function stored(version = '1.0') {
  return (await db.query('select * from installation_snapshots where winget_id=$1 and version=$2', ['Example.Application', version])).rows[0];
}

describe('actual scan workflow ingestion with local PostgreSQL', () => {
  it.each(['failed', 'skipped'] as const)('preserves all completed evidence after a %s rescan', async status => {
    await ingest([scan('completed')]);
    const before = await stored();
    const current = await ingest([{ ...scan(status), scanned_at: '2026-10-02T12:00:00Z' }]);
    expect(await stored()).toEqual(before);
    expect(current.summary?.results[0].status).toBe(status);
    expect(current.summary?.completed).toBe(0);
    expect(current.sync?.last_run_status).toBe(status === 'failed' ? 'failed' : 'partial');
    expect(current.exitCode).toBe(status === 'failed' ? 1 : 0);
    expect(current.summary?.uploaded).toBe(0);
    expect(current.summary?.preserved).toBe(1);
    expect(current.sync?.metadata).toMatchObject({ uploaded: 0, preserved: 1 });
  });

  it.each(['failed', 'skipped'] as const)('inserts a new %s snapshot and later promotes it on completion', async status => {
    await ingest([scan(status)]);
    expect((await stored()).scan_status).toBe(status);
    await ingest([scan('completed')]);
    expect((await stored()).scan_status).toBe('completed');
    expect((await stored()).install_path).toBe('C:\\Example');
  });

  it('updates completed evidence when another completed scan succeeds', async () => {
    await ingest([scan('completed')]);
    await ingest([{ ...scan('completed'), install_path: 'C:\\Updated', scanned_at: '2026-10-03T12:00:00Z' }]);
    expect((await stored()).install_path).toBe('C:\\Updated');
  });

  it.each(['failed', 'skipped', 'pending', null])('refreshes a noncompleted %s row with the current failure', async previous => {
    await ingest([scan('failed')]);
    await db.query('update installation_snapshots set scan_status=$1', [previous]);
    const current = await ingest([{ ...scan('failed'), error: 'Latest attempt', scanned_at: '2026-10-04T12:00:00Z' }]);
    expect(await stored()).toMatchObject({ scan_status: 'failed', scan_error: 'Latest attempt', scanned_at: new Date('2026-10-04T12:00:00Z') });
    expect(current.summary?.uploaded).toBe(1);
    expect(current.summary?.preserved).toBe(0);
  });

  it.each(['completed', 'failed'] as const)('reconciles a competing %s insert between update and insert-ignore', async competing => {
    let injected = false;
    const current = await ingest([{ ...scan('failed'), error: 'Latest attempt' }], async request => {
      if (!injected && request.method === 'POST' && request.prefer.includes('resolution=ignore-duplicates')) {
        injected = true;
        await ingest([scan(competing)]);
      }
    });
    expect(injected).toBe(true);
    expect((await stored()).scan_status).toBe(competing);
    expect((await stored()).scan_error).toBe(competing === 'completed' ? null : 'Latest attempt');
    expect(current.summary?.preserved).toBe(competing === 'completed' ? 1 : 0);
  });

  it('fails bounded reconciliation rather than reporting an unverified preserved row', async () => {
    let updates = 0;
    await expect(ingest([scan('failed')], async request => {
      if (request.method === 'PATCH') { updates++; await db.exec('delete from installation_snapshots'); }
      if (request.method === 'POST' && request.prefer.includes('resolution=ignore-duplicates')) await ingest([scan('failed')]);
    })).rejects.toThrow('Installation snapshot reconciliation did not converge');
    expect(updates).toBe(3);
  });

  it('propagates a persistence error without claiming upload or preservation success', async () => {
    await expect(ingest([scan('failed')], async () => new Response(JSON.stringify({ code: '42501', message: 'Fixture permission failure' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    }))).rejects.toMatchObject({ code: '42501' });
    expect(await stored()).toBeUndefined();
  });

  it('keeps a failed new version separate from the completed prior version', async () => {
    await ingest([scan('completed'), scan('failed', '2.0')]);
    expect((await stored()).scan_status).toBe('completed');
    expect((await stored('2.0')).scan_status).toBe('failed');
  });

  it.each([
    ['completed', 'failed'], ['failed', 'completed'], ['completed', 'skipped'], ['skipped', 'completed'],
  ] as const)('retains completed state for request ordering %s then %s', async (first, second) => {
    await ingest([scan(first), scan(second)]);
    expect((await stored()).scan_status).toBe('completed');
  });
});
