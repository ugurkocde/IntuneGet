import { describe, expect, it, vi } from 'vitest';
import { readStableLiveQaInventory, type ReadQaRunPage } from './live-workflow-inventory';
import { classifyForeignQaRuns } from './foreign-workflow-runs';

const run = (id: number, status = 'queued') => ({ id, status, path: '.github/workflows/intune-qa.yml' });
const payload = (...workflow_runs: unknown[]) => ({ total_count: workflow_runs.length, workflow_runs });
const empty = () => payload();

describe('bounded stable live QA workflow reader', () => {
  it('uses exactly twenty reads at the maximum complete inventory', async () => {
    const statuses = ['queued', 'waiting', 'pending', 'requested', 'in_progress'];
    const items = statuses.flatMap((status, index) =>
      Array.from({ length: 200 }, (_, i) => run(index * 200 + i + 1, status)));
    const read = vi.fn<ReadQaRunPage>(async q => ({
      total_count: 200,
      workflow_runs: items.filter(r => r.status === q.status).slice((q.page - 1) * 100, q.page * 100),
    }));
    expect(await readStableLiveQaInventory(read)).toEqual({
      state: 'complete', inventory: { total_count: 1000, workflow_runs: items },
    });
    expect(read).toHaveBeenCalledTimes(20);
  });
  it('rejects a truncated second page even when the total remains stable', async () => {
    const read = vi.fn<ReadQaRunPage>(async q => ({
      total_count: 101,
      workflow_runs: q.page === 1 ? Array.from({ length: 100 }, (_, i) => run(i + 1)) : [],
    }));
    expect(await readStableLiveQaInventory(read)).toEqual({ state: 'unknown' });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('reads each live status twice without querying completed history', async () => {
    const read = vi.fn<ReadQaRunPage>(async () => empty());
    expect(await readStableLiveQaInventory(read)).toEqual({ state: 'complete', inventory: empty() });
    expect(read).toHaveBeenCalledTimes(10);
    expect(read.mock.calls.map(([q]) => q.status)).toEqual([
      'queued', 'waiting', 'pending', 'requested', 'in_progress',
      'queued', 'waiting', 'pending', 'requested', 'in_progress',
    ]);
    expect(read.mock.calls.every(([q]) => q.workflow === 'intune-qa.yml' && q.per_page === 100 && q.page === 1)).toBe(true);
  });
  it('returns evidence usable by the ownership classifier without guessing null ids', async () => {
    const read: ReadQaRunPage = async q => q.status === 'waiting' ? payload(run(11, 'waiting')) : empty();
    const result = await readStableLiveQaInventory(read);
    expect(result.state).toBe('complete');
    if (result.state !== 'complete') throw Error('missing inventory');
    expect(classifyForeignQaRuns(result.inventory, ['11'])).toEqual({ state: 'clear', runIds: [] });
    expect(classifyForeignQaRuns(result.inventory, [null])).toEqual({ state: 'foreign', runIds: [11] });
  });
  it('collects the complete second page in both sweeps within the read budget', async () => {
    const items = Array.from({ length: 200 }, (_, i) => run(i + 1));
    const read = vi.fn<ReadQaRunPage>(async q => q.status === 'queued'
      ? { total_count: 200, workflow_runs: items.slice((q.page - 1) * 100, q.page * 100) } : empty());
    const result = await readStableLiveQaInventory(read);
    expect(result).toEqual({ state: 'complete', inventory: { total_count: 200, workflow_runs: items } });
    expect(read).toHaveBeenCalledTimes(12);
  });
  it('does not let harmless ordering changes make the inventory unstable', async () => {
    let calls = 0;
    const read: ReadQaRunPage = async q => q.status === 'queued'
      ? (++calls === 1 ? payload(run(12), run(11)) : payload(run(11), run(12))) : empty();
    expect((await readStableLiveQaInventory(read)).state).toBe('complete');
  });
  it.each([null, {}, { total_count: -1, workflow_runs: [] }, { total_count: 1.5, workflow_runs: [] },
    { total_count: 201, workflow_runs: [] }, { total_count: 1, workflow_runs: [] },
    { total_count: 0, workflow_runs: [run(1)] }, payload(null), payload(run(1), run(1)),
    payload(run(0)), payload(run(Number.MAX_SAFE_INTEGER + 1)), payload(run(1, 'completed')),
    payload({ ...run(1), path: '.github/workflows/other.yml' }),
    payload({ ...run(1), path: '.github/workflows/intune-qa.yml@refs/heads/main' }),
  ])('defers invalid, truncated, wrong-workflow or out-of-bound evidence %#', async data => {
    const read = vi.fn<ReadQaRunPage>(async () => data);
    expect(await readStableLiveQaInventory(read)).toEqual({ state: 'unknown' });
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('defers a total count change during pagination', async () => {
    const items = Array.from({ length: 100 }, (_, i) => run(i + 1));
    const read: ReadQaRunPage = async q => ({ total_count: q.page === 1 ? 101 : 100, workflow_runs: q.page === 1 ? items : [] });
    expect(await readStableLiveQaInventory(read)).toEqual({ state: 'unknown' });
  });
  it('defers a duplicate across page boundaries', async () => {
    const items = Array.from({ length: 100 }, (_, i) => run(i + 1));
    const read: ReadQaRunPage = async q => ({ total_count: 101, workflow_runs: q.page === 1 ? items : [run(100)] });
    expect(await readStableLiveQaInventory(read)).toEqual({ state: 'unknown' });
  });
  it('defers a run that changes status during a sweep', async () => {
    const read: ReadQaRunPage = async q => q.status === 'queued' ? payload(run(11))
      : q.status === 'in_progress' ? payload(run(11, 'in_progress')) : empty();
    expect(await readStableLiveQaInventory(read)).toEqual({ state: 'unknown' });
  });
  it.each(['appears', 'disappears', 'changes_status'])('defers a run that %s between sweeps', async change => {
    let calls = 0;
    const read: ReadQaRunPage = async q => {
      const second = calls++ >= 5;
      if (change === 'appears') return second && q.status === 'queued' ? payload(run(11)) : empty();
      if (change === 'disappears') return !second && q.status === 'queued' ? payload(run(11)) : empty();
      return q.status === (second ? 'in_progress' : 'queued') ? payload(run(11, q.status)) : empty();
    };
    expect(await readStableLiveQaInventory(read)).toEqual({ state: 'unknown' });
  });
  it('defers a failed transport without leaking error text', async () => {
    expect(await readStableLiveQaInventory(async () => { throw Error('private transport detail'); })).toEqual({ state: 'unknown' });
  });
});
