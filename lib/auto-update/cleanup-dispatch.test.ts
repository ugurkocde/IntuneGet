import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ job: {} as Record<string, unknown>, writes: [] as string[], changes: [] as { table: string; value: Record<string, unknown> }[] }));
vi.mock('@/lib/notification-service', () => ({ notifyAutoUpdatePaused: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table: string) => {
  const query = {
    select: () => query, eq: () => query,
    single: async () => ({ error: null, data: table === 'packaging_jobs' ? fixture.job
      : table === 'auto_update_history' ? { status: 'pending' } : { consecutive_failures: 0, policy_type: 'auto_update' } }),
    update: (value: Record<string, unknown>) => { fixture.writes.push(table + ':update'); fixture.changes.push({ table, value }); return query; },
    delete: () => { fixture.writes.push(table + ':delete'); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  return query;
} }) }));
import { handleAutoUpdateJobCompletion } from './cleanup';
afterEach(() => { fixture.writes.length = 0; fixture.changes.length = 0; vi.unstubAllEnvs(); });
it.each(['WORKFLOW_DISPATCH_UNCONFIRMED', 'WORKFLOW_DISPATCH_UNRECONCILED'].flatMap(code => ['failed', 'cancelled'].map(status => [code, status] as const)))(
  'records %s/%s failure while retaining checkpoint and policy version', async (error_code, status) => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service');
    fixture.job = { id: 'job', is_auto_update: true, auto_update_policy_id: 'policy',
      package_config: { autoUpdateHistoryId: 'history' }, error_code, github_run_id: null, callback_run_id: null };
    await handleAutoUpdateJobCompletion('job', status as 'failed' | 'cancelled', 'fixture');
    expect(fixture.changes).toContainEqual({ table: 'auto_update_history', value: { status, error_message: 'fixture', completed_at: expect.any(String) } });
    const policy = fixture.changes.find(c => c.table === 'app_update_policies')!.value;
    expect(policy).toMatchObject({ consecutive_failures: 1 });
    expect(policy).not.toHaveProperty('last_auto_update_version');
    expect(fixture.changes).toContainEqual({ table: 'packaging_jobs', value: { archived_at: expect.any(String) } });
    expect(fixture.writes).not.toContain('packaging_jobs:delete');
    expect(fixture.writes).not.toContain('msp_batch_deployment_items:update');
  },
);
it.each(['callback_run_id', 'github_run_id'])('still completes cleanup when %s establishes the run', async runField => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service');
  fixture.job = { id: 'job', is_auto_update: true, auto_update_policy_id: 'policy',
    package_config: { autoUpdateHistoryId: 'history' }, error_code: 'WORKFLOW_DISPATCH_UNCONFIRMED',
    github_run_id: null, callback_run_id: null, [runField]: '123' };
  await handleAutoUpdateJobCompletion('job', 'failed', 'fixture');
  expect(fixture.writes).toContain('app_update_policies:update');
  expect(fixture.writes).toContain('packaging_jobs:delete');
});
