import { afterEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ job: {} as Record<string, unknown>, writes: [] as string[] }));
vi.mock('@/lib/notification-service', () => ({ notifyAutoUpdatePaused: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: (table: string) => {
  const query = {
    select: () => query, eq: () => query,
    single: async () => ({ error: null, data: table === 'packaging_jobs' ? fixture.job
      : table === 'auto_update_history' ? { status: 'pending' } : { consecutive_failures: 0, policy_type: 'auto_update' } }),
    update: () => { fixture.writes.push(table + ':update'); return query; },
    delete: () => { fixture.writes.push(table + ':delete'); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  return query;
} }) }));
import { handleAutoUpdateJobCompletion } from './cleanup';
afterEach(() => { fixture.writes.length = 0; vi.unstubAllEnvs(); });
it.each(['WORKFLOW_DISPATCH_UNCONFIRMED', 'WORKFLOW_DISPATCH_UNRECONCILED'])(
  'retains an unresolved %s checkpoint and policy version marker', async error_code => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service');
    fixture.job = { id: 'job', is_auto_update: true, auto_update_policy_id: 'policy',
      package_config: { autoUpdateHistoryId: 'history' }, error_code, github_run_id: null, callback_run_id: null };
    await handleAutoUpdateJobCompletion('job', 'failed', 'fixture');
    expect(fixture.writes).toEqual([]);
  },
);
it('still completes cleanup after a callback has established the run', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service');
  fixture.job = { id: 'job', is_auto_update: true, auto_update_policy_id: 'policy',
    package_config: { autoUpdateHistoryId: 'history' }, error_code: 'WORKFLOW_DISPATCH_UNCONFIRMED',
    github_run_id: null, callback_run_id: '123' };
  await handleAutoUpdateJobCompletion('job', 'failed', 'fixture');
  expect(fixture.writes).toContain('app_update_policies:update');
  expect(fixture.writes).toContain('packaging_jobs:delete');
});
