import { beforeEach, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { sendDeploymentWaitingNotices } from './deployment-waiting-notices';

const now = Date.parse('2026-11-13T12:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const job = (n: number, patch: Record<string, unknown> = {}) => ({
  id: id(n), user_id: 'fixture-owner', user_email: 'owner@example.test',
  display_name: 'Fixture App', winget_id: 'Fixture.App', status: 'awaiting_qa',
  created_at: '2026-10-01T12:00:00Z', qa_requested_at: null, archived_at: null, ...patch,
});
type Job = ReturnType<typeof job>;
let jobs: Job[];
let requests: URL[];
let notices: Map<string, Record<string, unknown>>;
let writes: Array<{ rows: Record<string, unknown>[]; prefer: string }>;
let queryError: boolean;
let insertError: boolean;

function client() {
  const fixtureFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (url.pathname.endsWith('/user_notifications')) {
      if (insertError) return Response.json({ code: '23514', message: 'synthetic CHECK error' }, { status: 400 });
      const rows = JSON.parse(String(init?.body)) as Record<string, unknown>[];
      writes.push({ rows, prefer: new Headers(init?.headers).get('prefer') || '' });
      const inserted = rows.filter(row => !notices.has(String(row.id)));
      for (const row of inserted) notices.set(String(row.id), { ...row, read_at: null });
      return Response.json(inserted.map(row => ({ id: row.id })));
    }
    if (queryError) return Response.json({ code: '57014', message: 'synthetic query failure' }, { status: 400 });
    const fromCreation = url.searchParams.get('qa_requested_at') === 'is.null';
    const column = fromCreation ? 'created_at' : 'qa_requested_at';
    const cutoff = url.searchParams.get(column)?.replace(/^lte\./, '') || '';
    const cursor = url.searchParams.get('or');
    const cursorTime = cursor?.match(/\.lt\."([^"]+)"/)?.[1];
    const cursorId = cursor?.match(/id\.lt\.([0-9a-f-]+)/)?.[1];
    const rows = jobs.filter(j => (j.qa_requested_at === null) === fromCreation
      && ['awaiting_qa', 'blocked_upstream'].includes(j.status) && !j.archived_at
      && Date.parse(String(j[column])) <= Date.parse(cutoff)
      && (!cursorTime || Date.parse(String(j[column])) < Date.parse(cursorTime)
        || (Date.parse(String(j[column])) === Date.parse(cursorTime) && j.id < String(cursorId))))
      .sort((a, b) => Date.parse(String(b[column])) - Date.parse(String(a[column])) || b.id.localeCompare(a.id));
    return Response.json(rows.slice(0, Number(url.searchParams.get('limit'))));
  };
  return createClient('https://example.test', 'fixture-only', {
    global: { fetch: fixtureFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

beforeEach(() => {
  jobs = []; requests = []; notices = new Map(); writes = []; queryError = false; insertError = false;
  vi.restoreAllMocks();
});

it('notifies the existing old backlog on both timestamp branches, to each job owner only', async () => {
  jobs = [job(1), job(2, { qa_requested_at: '2026-10-14T12:00:00+00:00', status: 'blocked_upstream', user_id: 'other-owner', user_email: 'other@example.test' })];
  expect(await sendDeploymentWaitingNotices(client(), now)).toMatchObject({ eligible: 2, inserted: 2, truncated: false, errors: [] });
  const rows = [...notices.values()];
  expect(rows.map(r => [r.user_id, r.user_email])).toEqual([['fixture-owner', 'owner@example.test'], ['other-owner', 'other@example.test']]);
  expect(rows[0].data).toMatchObject({ job_id: id(1), winget_id: 'Fixture.App', from_creation: true });
  expect(rows[1].data).toMatchObject({ job_id: id(2), from_creation: false });
  for (const r of rows) expect(r.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (const url of requests.filter(u => u.pathname.endsWith('/packaging_jobs'))) {
    expect(url.searchParams.get('archived_at')).toBe('is.null');
    expect(url.searchParams.get('status')).toBe('in.(awaiting_qa,blocked_upstream)');
  }
});

it('uses the request timestamp when present and includes exactly72h but no future or invalid times', async () => {
  jobs = [job(1, { created_at: '2026-11-10T12:00:00Z' }),
    job(2, { created_at: '2026-11-10T12:00:00.001Z' }),
    job(3, { qa_requested_at: '2026-11-12T12:00:00Z' }),
    job(4, { qa_requested_at: 'invalid' }), job(5, { qa_requested_at: '2026-11-14T12:00:00Z' }),
    job(6, { archived_at: '2026-11-01T12:00:00Z' }), job(7, { status: 'deployed' })];
  expect(await sendDeploymentWaitingNotices(client(), now)).toMatchObject({ inserted: 1 });
  expect([...notices.values()][0].data).toMatchObject({ job_id: id(1) });
});

it('inserts once and never restores the unread state after the user reads the notice', async () => {
  jobs = [job(1)];
  const db = client();
  expect((await sendDeploymentWaitingNotices(db, now)).inserted).toBe(1);
  const firstId = [...notices.keys()][0]; notices.get(firstId)!.read_at = '2026-11-13T12:00:01Z';
  expect((await sendDeploymentWaitingNotices(db, now + 300_000)).inserted).toBe(0);
  expect([...notices.keys()]).toEqual([firstId]);
  expect(notices.get(firstId)!.read_at).toBe('2026-11-13T12:00:01Z');
  for (const write of writes) {
    expect(write.prefer).toContain('resolution=ignore-duplicates');
    expect(write.rows[0]).not.toHaveProperty('read_at');
  }
});

it('skips missing owners and emails and bounds the customer title', async () => {
  jobs = [job(1, { user_id: '' }), job(2, { user_email: '  ' }), job(3, { display_name: 'A'.repeat(300) })];
  expect(await sendDeploymentWaitingNotices(client(), now)).toMatchObject({ inserted: 1, skippedNoOwner: 1, skippedNoEmail: 1 });
  expect(String([...notices.values()][0].title).length).toBeLessThanOrEqual(200);
});

it('fails soft on query and CHECK errors without exposing the raw error', async () => {
  queryError = true;
  const queried = await sendDeploymentWaitingNotices(client(), now);
  expect(queried.errors.length).toBeGreaterThan(0);
  expect(queried.error).not.toContain('synthetic');
  const throwing = { from: () => { throw new Error('synthetic unavailable client'); } } as unknown as ReturnType<typeof client>;
  expect((await sendDeploymentWaitingNotices(throwing, now)).errors).toHaveLength(2);
  queryError = false; insertError = true; jobs = [job(1)];
  expect(await sendDeploymentWaitingNotices(client(), now)).toMatchObject({ inserted: 0, errors: expect.any(Array), error: expect.any(String) });
});

it('uses a timestamp and id keyset across tied dates and reports a full branch cap', async () => {
  jobs = Array.from({ length: 1001 }, (_, i) => job(i + 1, { created_at: '2026-10-01T12:00:00+00:00' }));
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(await sendDeploymentWaitingNotices(client(), now)).toMatchObject({ scanned: 1000, inserted: 1000, truncated: true });
  expect(notices.size).toBe(1000);
  const pages = requests.filter(u => u.pathname.endsWith('/packaging_jobs') && u.searchParams.get('qa_requested_at') === 'is.null');
  expect(pages).toHaveLength(2);
  expect(pages[1].searchParams.get('or')).toContain('created_at.lt."2026-10-01T12:00:00+00:00"');
  expect(log).toHaveBeenCalled();
});
