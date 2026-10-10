import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadPendingBatchItems } from './batch-orchestrator';
import type { Database } from '@/types/database';
vi.mock('@/lib/supabase', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDatabase: vi.fn() }));
let db: PGlite;
const batchId = '10000000-0000-4000-8000-000000000001';
const otherBatch = '10000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  db = new PGlite();
  await db.exec('create table msp_batch_deployments(id uuid primary key); create table packaging_jobs(id uuid primary key);');
  const migration = await readFile(new URL('../../supabase/migrations/0151_msp_batch_and_webhooks.sql', import.meta.url), 'utf8');
  const definition = migration.match(/CREATE TABLE IF NOT EXISTS msp_batch_deployment_items \([\s\S]*?\n\);/)?.[0];
  expect(Boolean(definition)).toBe(true);
  await db.exec(definition!);
  await db.query('insert into msp_batch_deployments(id) values ($1),($2)', [batchId, otherBatch]);
  for (const [suffix, batch, name, status] of [
    ['3', batchId, 'Bravo', 'pending'], ['2', batchId, 'Alpha', 'pending'],
    ['1', batchId, 'Alpha', 'pending'], ['4', batchId, 'Aaron', 'completed'],
    ['5', otherBatch, 'Aaron', 'pending'],
  ]) await db.query('insert into msp_batch_deployment_items(id,batch_id,tenant_id,tenant_display_name,status) values ($1,$2,$3,$4,$5)',
    [`20000000-0000-4000-8000-00000000000${suffix}`, batch, `tenant-${suffix}`, name, status]);
}, 30_000);
afterAll(async () => db?.close());

describe('pending MSP tenant selection against migration 015', () => {
  it('reproduces the missing timestamp as SQLSTATE 42703', async () => {
    await expect(db.query('select id from msp_batch_deployment_items order by created_at')).rejects.toMatchObject({ code: '42703' });
  });

  it('executes the actual PostgREST query with pending/batch filters, stable ties and available capacity', async () => {
    let requested: URL | undefined;
    const client = createClient<Database>('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
      fetch: async input => {
        requested = new URL(String(input));
        const order = requested.searchParams.get('order')!;
        // Translate the actual request into PostgreSQL, including any nonexistent column.
        const ordering = order.split(',').map(term => {
          const [column, direction] = term.split('.');
          if (!/^[a-z_]+$/.test(column) || !['asc', 'desc'].includes(direction)) throw new Error('Unexpected ordering syntax');
          return `"${column}" ${direction.toUpperCase()}`;
        }).join(',');
        try {
          const result = await db.query(`select * from msp_batch_deployment_items where batch_id = $1 and status = $2 order by ${ordering} limit $3`,
            [requested.searchParams.get('batch_id')?.slice(3), requested.searchParams.get('status')?.slice(3), Number(requested.searchParams.get('limit'))]);
          return new Response(JSON.stringify(result.rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } catch (error) {
          return new Response(JSON.stringify({ code: (error as { code?: string }).code, message: 'Pending item schema query failed' }), { status: 400 });
        }
      },
    } });
    const { data, error } = await loadPendingBatchItems(client, batchId, 2);
    expect(error).toBeNull();
    expect(data?.map(row => row.id)).toEqual(['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002']);
    expect(requested?.searchParams.get('order')).toBe('tenant_display_name.asc,id.asc');
    expect(requested?.searchParams.get('limit')).toBe('2');
    expect(requested?.searchParams.get('batch_id')).toBe(`eq.${batchId}`);
    expect(requested?.searchParams.get('status')).toBe('eq.pending');
  });
});
