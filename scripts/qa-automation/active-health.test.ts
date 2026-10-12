import { describe, expect, it, vi } from 'vitest';
import { activeHealth, reconcileActive } from './active-health.mjs';

const now = Date.parse('2026-09-30T12:00:00Z');
const candidate = { id: 'candidate', status: 'dispatched', dispatched_at: '2026-09-30T11:49:00Z',
  updated_at: '2026-09-30T11:59:59Z' };
const snapshot = () => ({ active: [candidate] });

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
