import { describe, expect, it, vi } from 'vitest';
import { activeHealth, reconcileActive, completedHourStarts } from './active-health.mjs';

const now = Date.parse('2026-09-30T12:00:00Z');
const candidate = { id: 'candidate', status: 'dispatched', dispatched_at: '2026-09-30T11:49:00Z',
  updated_at: '2026-09-30T11:59:59Z' };
const snapshot = () => ({ active: [candidate] });

describe('completed UTC-hour Execute step evidence', () => {
  const now = Date.parse('2026-11-14T11:00:00Z');
  const observe = (started_at: string | null, conclusion = 'success', status = 'completed') => completedHourStarts({ now,
    runs: [{ id: 1, status: 'completed' }], jobsByRun: { 1: { total_count: 1, jobs: [{ name: 'qa', steps: [{ name: 'Execute isolated QA test', started_at, conclusion, status }] }] } } });
  it.each([['2026-11-14T09:59:59.999Z', 0], ['2026-11-14T10:00:00.000Z', 1],
    ['2026-11-14T10:59:59.999Z', 1], ['2026-11-14T11:00:00.000Z', 0]])('counts the half-open hour boundary %s', (started, count) => {
    expect(observe(started as string)).toMatchObject({ executeStarts: count, state: count ? 'started' : 'zero' });
  });
  it('counts an in-progress or failed Execute step without claiming a VM boot', () => {
    expect(observe('2026-11-14T10:30:00Z', 'failure')).toMatchObject({ executeStarts: 1 });
    expect(observe('2026-11-14T10:30:00Z', null as any, 'in_progress')).toMatchObject({ executeStarts: 1 });
  });
  it('does not turn cancelled, malformed or incomplete evidence into zero', () => {
    expect(observe('2026-11-14T10:30:00Z', 'cancelled')).toMatchObject({ state: 'unknown', executeStarts: null });
    expect(observe('invalid')).toMatchObject({ state: 'unknown', executeStarts: null });
    expect(completedHourStarts({ now, complete: false })).toMatchObject({ state: 'unknown', executeStarts: null });
    expect(completedHourStarts({ now, runs: [{ id: 1 }], jobsByRun: { 1: { total_count: 2, jobs: [] } } })).toMatchObject({ state: 'unknown', executeStarts: null });
  });
  it('excludes skipped and never-started steps and reports only the last completed hour', () => {
    expect(observe('2026-11-14T10:30:00Z', 'skipped')).toMatchObject({ executeStarts: 0 });
    expect(observe(null)).toMatchObject({ executeStarts: 0 });
    expect(completedHourStarts({ now: now - 1, runs: [], jobsByRun: {} }).window).toEqual({ start: '2026-11-14T09:00:00.000Z', end: '2026-11-14T10:00:00.000Z' });
  });
});

describe('execution-based guardian health', () => {
  it('does not mistake a dispatch or fresh bookkeeping for VM execution', () => {
    expect(activeHealth(candidate, now)).toMatchObject({ action: 'active_stalled', stale: true });
    expect(activeHealth({ ...candidate, dispatched_at: '2026-09-30T11:59:00Z' }, now))
      .toMatchObject({ action: 'awaiting_runner', stale: false });
    expect(activeHealth({ ...candidate, dispatched_at: null }, now)).toMatchObject({ stale: true });
  });
  it('uses the newest execution heartbeat, not a stale activity field', () => {
    expect(activeHealth({ ...candidate, status: 'running', activity_updated_at: '2026-09-30T11:00:00Z',
      phase_updated_at: '2026-09-30T11:59:00Z' }, now)).toMatchObject({ action: 'active_healthy' });
  });
  it('escalates HTTP 200/qa_active when reconciliation did not restore execution', async () => {
    const invokeCron = vi.fn(async () => ({ status: 200, body: { reason: 'qa_active' } }));
    expect(await reconcileActive({ candidate, invokeCron, snapshot, now })).toMatchObject({
      action: 'repair_required', repairRequired: true, repairKey: 'qa-execution-stalled',
    });
    expect(invokeCron).toHaveBeenCalledOnce();
  });
  it('rechecks the candidate after recovery and accepts actual VM progress', async () => {
    const invokeCron = async () => ({ status: 200, body: { reason: 'qa_active' } });
    const snapshot = async () => ({ active: [{ ...candidate, status: 'running', phase_updated_at: '2026-09-30T11:59:00Z' }] });
    expect(await reconcileActive({ candidate, invokeCron, snapshot, now })).toMatchObject({ action: 'active_healthy' });
  });
  it.each(['stale_waiting_run_cancelled', 'github_actions_unavailable'])('waits for bounded recovery/dependency status: %s', async reason => {
    const invokeCron = async () => ({ status: 200, body: { reason } });
    expect(await reconcileActive({ candidate, invokeCron, snapshot, now })).not.toHaveProperty('repairRequired');
  });
  it('is read-only in dry run and does not swallow provider failures', async () => {
    const invokeCron = vi.fn(async () => { throw new Error('GitHub cooldown'); });
    expect(await reconcileActive({ candidate, invokeCron, snapshot, now, dryRun: true })).toMatchObject({ action: 'would_reconcile_active' });
    expect(invokeCron).not.toHaveBeenCalled();
    await expect(reconcileActive({ candidate, invokeCron, snapshot, now })).rejects.toThrow('GitHub cooldown');
  });
});
