/** Display-only request options. Never authorizes deployment or bypasses a hold. */
export interface CustomerJobScope {
  viewScope: 'mine' | 'tenant';
  isMspUser: boolean;
  selectedTenantId?: string | null;
  userId?: string | null;
  userTenantId?: string | null;
}
export interface CustomerJobSnapshot {
  scope: CustomerJobScope;
  snapshotKey: string | null;
  isLoading: boolean;
  error: string | null;
  sessionExpired: boolean;
}
export interface WaitingCustomerJob {
  status: string;
  user_id: string;
  qa_requested_at?: string | null;
  created_at: string;
}
export function customerJobSnapshotKey(scope: CustomerJobScope): string | null {
  if (!scope.userId || !scope.userTenantId) return null;
  return JSON.stringify([scope.viewScope, scope.isMspUser, scope.selectedTenantId ?? null, scope.userId, scope.userTenantId]);
}
function timestamp(value: string | null | undefined): number {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day)
    || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return NaN;
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.${(fraction || '').slice(0, 3).padEnd(3, '0')}${zone}`);
}
export const CUSTOMER_WAIT_MS = 72 * 60 * 60 * 1000;

export function customerWaitSince(job: WaitingCustomerJob, now: number): { fromCreation: boolean; startedAt: string } | null {
  if (!['awaiting_qa', 'blocked_upstream'].includes(job.status) || !Number.isFinite(now)) return null;
  const fromCreation = job.qa_requested_at === null || job.qa_requested_at === undefined;
  const start = timestamp(fromCreation ? job.created_at : job.qa_requested_at);
  return Number.isFinite(start) && now - start >= CUSTOMER_WAIT_MS
    ? { fromCreation, startedAt: new Date(start).toISOString() } : null;
}

export function customerWaitOptions(job: WaitingCustomerJob, context: CustomerJobSnapshot, now: number): { fromCreation: boolean } | null {
  const key = customerJobSnapshotKey(context.scope);
  if (!key || context.snapshotKey !== key || context.isLoading || context.error || context.sessionExpired
    || context.scope.viewScope !== 'mine' || job.user_id !== context.scope.userId) return null;
  const wait = customerWaitSince(job, now);
  return wait ? { fromCreation: wait.fromCreation } : null;
}
