import { describe, expect, it } from 'vitest';
import { classifyForeignQaRuns } from './foreign-workflow-runs';

const run = (id: number, status = 'queued') => ({ id, status, path: '.github/workflows/intune-qa.yml' });
const inventory = (...workflow_runs: unknown[]) => ({ total_count: workflow_runs.length, workflow_runs });

describe('foreign QA workflow inventory classification', () => {
  it.each(['queued', 'waiting', 'pending', 'requested', 'in_progress'])('holds an unlinked %s run', status => {
    expect(classifyForeignQaRuns(inventory(run(10, status)), ['11'])).toEqual({ state: 'foreign', runIds: [10] });
  });
  it('does not confuse a linked candidate run with foreign work', () => {
    expect(classifyForeignQaRuns(inventory(run(10)), ['10'])).toEqual({ state: 'clear', runIds: [] });
  });
  it('keeps a completed unrelated lifecycle out of the busy inventory', () => {
    expect(classifyForeignQaRuns(inventory(run(10, 'completed')), [])).toEqual({ state: 'clear', runIds: [] });
  });
  it('does not guess ownership for a candidate whose run id is not known yet', () => {
    expect(classifyForeignQaRuns(inventory(run(10)), [null])).toEqual({ state: 'foreign', runIds: [10] });
  });
  it('is clear for a complete empty inventory', () => {
    expect(classifyForeignQaRuns(inventory(), [])).toEqual({ state: 'clear', runIds: [] });
  });
  it.each([null, {}, { total_count: 2, workflow_runs: [run(10)] }, { total_count: 1, workflow_runs: [] },
    { total_count: -1, workflow_runs: [] }, inventory(null), inventory(run(10), run(10)),
    inventory(run(10, 'unknown')), inventory({ ...run(10), path: '.github/workflows/other.yml' }),
    inventory(run(Number.MAX_SAFE_INTEGER + 1)), inventory(run(0))])('defers incomplete or ambiguous evidence %#', payload => {
    expect(classifyForeignQaRuns(payload, [])).toEqual({ state: 'unknown', runIds: [] });
  });
  it.each(['0', '0010', 'invalid', '9007199254740992'])('defers invalid linked identity %s', id => {
    expect(classifyForeignQaRuns(inventory(run(10)), [id])).toEqual({ state: 'unknown', runIds: [] });
  });
});
