import { expect, it } from 'vitest';
import { customerWaitOptions, customerJobSnapshotKey, type CustomerJobScope } from './customer-wait-options';

const now = Date.parse('2026-11-13T00:00:00Z');
const scope: CustomerJobScope = { viewScope: 'mine', isMspUser: false, selectedTenantId: null, userId: 'fixture-owner', userTenantId: 'fixture-tenant' };
const context = { scope, snapshotKey: customerJobSnapshotKey(scope), isLoading: false, error: null, sessionExpired: false };
const job = { status: 'awaiting_qa', user_id: 'fixture-owner', qa_requested_at: '2026-11-10T00:00:00Z', created_at: '2026-11-01T00:00:00Z' };
it('offers existing navigation at exactly72h, never before or for future times', () => {
  expect(customerWaitOptions(job, context, now)).toEqual({ fromCreation: false });
  expect(customerWaitOptions(job, context, now - 1)).toBeNull();
  expect(customerWaitOptions({ ...job, qa_requested_at: '2026-11-14T00:00:00Z' }, context, now)).toBeNull();
});
it('uses creation only when request time is absent, never when present invalid', () => {
  expect(customerWaitOptions({ ...job, qa_requested_at: null }, context, now)).toEqual({ fromCreation: true });
  for (const value of ['', 'invalid', '2026-11-01T00:00:00', '2026-02-30T00:00:00Z']) expect(customerWaitOptions({ ...job, qa_requested_at: value }, context, now)).toBeNull();
  expect(customerWaitOptions({ ...job, qa_requested_at: '2026-11-12T00:00:00Z' }, context, now)).toBeNull();
});
it.each(['2026-11-10T00:00:00.123456+00:00', '2026-11-10T00:00:00.12Z', '2026-11-10T00:00:00.123456789Z', '2026-11-10T01:00:00+01:00'])('handles persisted timestamp %s', time => {
  expect(customerWaitOptions({ ...job, qa_requested_at: time }, context, now + 1000)).not.toBeNull();
  expect(customerWaitOptions({ ...job, qa_requested_at: time }, context, now - 1)).toBeNull();
});
it('handles SQLite ISO writes and fails closed for legacy timezone-free dates', () => {
  expect(customerWaitOptions({ ...job, qa_requested_at: null, created_at: '2026-11-10T00:00:00.000Z' }, context, now)).not.toBeNull();
  expect(customerWaitOptions({ ...job, qa_requested_at: null, created_at: '2026-11-01 00:00:00' }, context, now)).toBeNull();
});
it('hides stale successful responses across account, tenant, MSP and view changes', () => {
  for (const patch of [{ userId: 'fixture-other' }, { userTenantId: 'fixture-other-tenant' }, { isMspUser: true }, { selectedTenantId: 'fixture-customer' }, { viewScope: 'tenant' as const }]) expect(customerWaitOptions(job, { ...context, scope: { ...scope, ...patch } }, now)).toBeNull();
  expect(customerWaitOptions(job, { ...context, snapshotKey: null }, now)).toBeNull();
});
it('requires own jobs in mine view and a known session tenant', () => {
  expect(customerWaitOptions({ ...job, user_id: 'fixture-other' }, context, now)).toBeNull();
  const tenant = { ...scope, viewScope: 'tenant' as const };
  expect(customerWaitOptions(job, { ...context, scope: tenant, snapshotKey: customerJobSnapshotKey(tenant) }, now)).toBeNull();
  expect(customerJobSnapshotKey({ ...scope, userTenantId: null })).toBeNull();
});
it('hides on loading, fetch or action error, session expiry and missing time', () => {
  for (const patch of [{ isLoading: true }, { error: 'synthetic action error' }, { sessionExpired: true }]) expect(customerWaitOptions(job, { ...context, ...patch }, now)).toBeNull();
  expect(customerWaitOptions(job, context, NaN)).toBeNull();
});
it('removes options immediately when a held job progresses or terminates', () => {
  for (const status of ['completed', 'deployed', 'failed', 'qa_failed', 'cancelled', 'duplicate_skipped', 'queued', 'packaging', 'uploading']) expect(customerWaitOptions({ ...job, status }, context, now)).toBeNull();
  expect(customerWaitOptions({ ...job, status: 'blocked_upstream' }, context, now)).not.toBeNull();
});
