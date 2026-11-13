import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Nothing behind the authorization check may run for a rejected request.
const work = vi.hoisted(() => vi.fn(() => { throw new Error('cron work must not start'); }));

vi.mock('@supabase/supabase-js', () => ({ createClient: work }));
vi.mock('@/lib/msp/batch-orchestrator', () => ({
  processPendingBatches: work,
  advanceInProgressBatches: work,
}));
vi.mock('@/lib/features', () => ({ getFeatureFlags: work }));
vi.mock('@/lib/runner-loss-reconciliation', () => ({ reconcileRunnerLosses: work }));
vi.mock('@/lib/auto-update/cleanup', () => ({ handleAutoUpdateJobCompletion: work }));
vi.mock('@/lib/email/service', () => ({ isEmailConfigured: work }));
vi.mock('@/lib/notifications/notify-user', () => ({ notifyUserOfPendingUpdates: work }));
vi.mock('./sync-packages/select-apps', () => ({ selectAppsToSync: work }));

import { GET as processBatches } from './process-batches/route';
import { GET as cleanupStaleJobs } from './cleanup-stale-jobs/route';
import { GET as sendNotifications } from './send-notifications/route';
import { GET as syncPackages } from './sync-packages/route';

const routes: Array<[string, (request: Request) => Promise<Response>]> = [
  ['process-batches', processBatches],
  ['cleanup-stale-jobs', cleanupStaleJobs],
  ['send-notifications', sendNotifications],
  ['sync-packages', syncPackages],
];

const request = (name: string, authorization?: string) => new Request(`https://example.test/api/cron/${name}`, {
  headers: authorization === undefined ? {} : { authorization },
});

beforeEach(() => {
  work.mockClear();
  // With no Supabase configuration an authorized request stops right after
  // the authorization check, before any work.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe.each(routes)('cron route %s', (name, GET) => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('rejects "Bearer undefined" and a missing header when CRON_SECRET is %s', async (_label, value) => {
    vi.stubEnv('CRON_SECRET', value);

    for (const authorization of ['Bearer undefined', undefined, 'Bearer ', 'Bearer null']) {
      const response = await GET(request(name, authorization));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'Unauthorized' });
    }
    expect(work).not.toHaveBeenCalled();
  });

  it('rejects a wrong value of the same length and a missing header when the secret is set', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');

    for (const authorization of ['Bearer correct-secreT', 'Bearer undefined', undefined]) {
      const response = await GET(request(name, authorization));
      expect(response.status).toBe(401);
    }
    expect(work).not.toHaveBeenCalled();
  });

  it('lets the configured secret through', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');

    const response = await GET(request(name, 'Bearer correct-secret'));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Missing Supabase configuration' });
  });
});
