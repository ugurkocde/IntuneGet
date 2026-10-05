import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import { releaseFixture } from '@/lib/curated-catalog/test-fixtures';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
vi.mock('@/lib/github-actions', () => ({ getGitHubActionsConfig: () => ({ owner: 'owner', workflowsRepo: 'qa', token: 'test-token', ref: 'main' }) }));
import { curatedQueueInputs, dispatchCuratedQueue } from './curated-queue';

type Row = Database['public']['Tables']['curated_verification_queue']['Row'];
const candidate = releaseFixture(CURATED_APPS[0]).candidate;
const now = new Date('2026-10-05T12:00:00Z');
const row = (patch: Partial<Row> = {}): Row => ({
  id: '10000000-0000-4000-8000-000000000001', verification_key: `release:${candidate.id}`, app_id: candidate.appId,
  version: candidate.version, kind: 'release', inputs: { candidate: JSON.stringify(candidate), previous: '', app_label: `Chrome [${candidate.id}]` },
  priority: 2000, status: 'queued', enqueued_at: now.toISOString(), dispatched_at: now.toISOString(),
  finished_at: null, github_run_id: null, updated_at: now.toISOString(), ...patch,
});
function client(active: Row | null, next: Row | null, claim: unknown = { row: next }) {
  const updates: unknown[] = [];
  let reads = 0;
  const stub = { rpc: vi.fn(async () => ({ data: claim, error: null })), from: vi.fn(() => ({
    select: () => {
      const data = reads++ === 0 ? active : next;
      const query = { eq: () => query, order: () => query, limit: () => query, maybeSingle: async () => ({ data, error: null }) };
      return query;
    },
    update: (patch: unknown) => {
      updates.push(patch);
      const query = { eq: () => query, then: (resolve: (result: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
      return query;
    },
  })) };
  return { supabase: stub as unknown as SupabaseClient<Database>, rpc: stub.rpc, updates };
}
describe('curated priority dispatch', () => {
  it('uses tested defaults for release tests and rejects unverified overrides or changed identity', () => {
    expect(curatedQueueInputs(row()).psadt_config).toBeUndefined();
    expect(() => curatedQueueInputs(row({ inputs: { ...(row().inputs as object), psadt_config: '{}' } }))).toThrow(/identity/);
    expect(() => curatedQueueInputs(row({ app_id: 'different' }))).toThrow(/identity/);
  });
  it('yields to an older urgent customer request without making a GitHub dispatch', async () => {
    const mock = client(null, row(), { reason: 'higher_priority_work', queue: 'ordinary' });
    const fetchMock = vi.fn();
    expect(await dispatchCuratedQueue(mock.supabase, now, fetchMock)).toMatchObject({ handled: false, dispatched: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('dispatches the atomically claimed curated request through the protected workflow', async () => {
    const mock = client(null, row());
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 204 }));
    expect(await dispatchCuratedQueue(mock.supabase, now, fetchMock)).toMatchObject({ dispatched: true, queue: 'curated' });
    expect(mock.rpc).toHaveBeenCalledWith('claim_qa_work', expect.objectContaining({ p_kind: 'curated', p_id: row().id }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ ref: 'main', inputs: { candidate: JSON.stringify(candidate) } });
  });
  it('keeps ambiguous network failures claimed rather than duplicating a VM run', async () => {
    const mock = client(null, row());
    await expect(dispatchCuratedQueue(mock.supabase, now, vi.fn(async () => { throw new Error('timeout'); }))).rejects.toThrow('timeout');
    expect(mock.updates).toEqual([]);
  });
  it('preserves a currently running verification', async () => {
    const mock = client(row({ status: 'dispatched' }), row());
    const fetchMock = vi.fn(async () => Response.json({ total_count: 1, workflow_runs: [{ id: 42,
      display_title: `Curated verification - Chrome [${candidate.id}]`, status: 'in_progress', created_at: now.toISOString(),
      event: 'workflow_dispatch', head_branch: 'main', path: '.github/workflows/curated-catalog-verification.yml' }] }));
    expect(await dispatchCuratedQueue(mock.supabase, now, fetchMock)).toMatchObject({ dispatched: false, reason: 'qa_active' });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.updates).toEqual([]);
  });
  it('releases a completed claim without treating workflow success as release approval', async () => {
    const mock = client(row({ status: 'dispatched' }), null);
    const fetchMock = vi.fn(async () => Response.json({ total_count: 1, workflow_runs: [{ id: 42,
      display_title: `Curated verification - Chrome [${candidate.id}]`, status: 'completed', created_at: now.toISOString(),
      event: 'workflow_dispatch', head_branch: 'main', path: '.github/workflows/curated-catalog-verification.yml' }] }));
    expect(await dispatchCuratedQueue(mock.supabase, now, fetchMock)).toMatchObject({ handled: false, dispatched: false });
    expect(mock.updates).toEqual([expect.objectContaining({ status: 'completed', github_run_id: '42' })]);
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('keeps a lost claim when the workflow inventory does not cover its dispatch window', async () => {
    const old = new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString();
    const mock = client(row({ status: 'dispatched', dispatched_at: old }), null);
    const fetchMock = vi.fn(async () => Response.json({ total_count: 101, workflow_runs: [{ id: 42,
      display_title: 'Other verification', status: 'completed', created_at: now.toISOString(),
      event: 'workflow_dispatch', head_branch: 'main', path: '.github/workflows/curated-catalog-verification.yml' }] }));
    await expect(dispatchCuratedQueue(mock.supabase, now, fetchMock)).rejects.toThrow('inventory is incomplete');
    expect(mock.updates).toEqual([]);
  });
  it('rejects malformed workflow dates instead of retrying an ambiguous dispatch', async () => {
    const mock = client(row({ status: 'dispatched' }), null);
    const fetchMock = vi.fn(async () => Response.json({ total_count: 1, workflow_runs: [{ id: 42,
      display_title: 'Other verification', status: 'completed', created_at: 'invalid',
      event: 'workflow_dispatch', head_branch: 'main', path: '.github/workflows/curated-catalog-verification.yml' }] }));
    await expect(dispatchCuratedQueue(mock.supabase, now, fetchMock)).rejects.toThrow('Invalid curated workflow inventory');
    expect(mock.updates).toEqual([]);
  });
});
