import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'crypto';

const mocks = vi.hoisted(() => ({ notify: vi.fn(), userCount: 25 }));
vi.mock('@/lib/cron-auth', () => ({ isAuthorizedCronRequest: () => true }));
vi.mock('@/lib/email/service', () => ({ isEmailConfigured: () => true }));
vi.mock('@/lib/notifications/notify-user', () => ({ notifyUserOfPendingUpdates: mocks.notify }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from(table: string) {
    let after = false;
    const query = {
      select() { return query; }, eq() { return query; }, in() { return query; },
      is() { return query; }, order() { return query; },
      gt() { after = true; return query; },
      limit() {
        const users = Array.from({ length: mocks.userCount }, (_, i) => `fixture-${i}`);
        return Promise.resolve({ error: null, data: after ? [] :
          table === 'notification_preferences' ? users.map(user_id => ({ user_id })) :
          table === 'update_check_results' ? users.map((user_id, i) => ({
            id: String(i), user_id, detected_at: '2026-11-24T00:00:00Z',
          })) : [] });
      },
    };
    return query;
  } }),
}));
import { GET } from './route';

const start = new Date('2026-11-24T04:00:00Z');
const ok = () => ({ emailsSent: 1, webhooksSent: 0, notifiedUpdateIds: ['fixture'], errors: [] });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  const response = GET(new Request('https://fixture.invalid/api/cron/send-notifications'));
  await vi.runAllTimersAsync();
  return (await response).json();
}

describe('notification cron pacing', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(start);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-test-value');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.userCount = 25; mocks.notify.mockReset();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('starts users at least 500ms apart without overlapping deliveries', async () => {
    const starts: number[] = []; let active = 0; let peak = 0;
    mocks.notify.mockImplementation(async () => {
      starts.push(Date.now()); peak = Math.max(peak, ++active);
      await sleep(50); active--; return ok();
    });
    const body = await run();
    expect(body.emailsSent).toBe(25); expect(peak).toBe(1);
    expect(starts.slice(1).every((t, i) => t - starts[i] >= 500)).toBe(true);
  });

  it('adds no pacing delay to users already taking longer than the interval', async () => {
    mocks.userCount = 3; const starts: number[] = [];
    mocks.notify.mockImplementation(async () => { starts.push(Date.now()); await sleep(800); return ok(); });
    await run();
    expect(starts.map(t => t - start.getTime())).toEqual([0, 800, 1600]);
    expect(Date.now() - start.getTime()).toBe(2400);
  });

  it('keeps delivery errors and proceeds to later users', async () => {
    mocks.userCount = 3;
    mocks.notify.mockResolvedValue(ok()).mockResolvedValueOnce({
      emailsSent: 0, webhooksSent: 0, notifiedUpdateIds: [], errors: ['Synthetic provider rate limit'],
    });
    const body = await run();
    expect(mocks.notify).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ success: false, emailsSent: 2, updatesProcessed: 2,
      errors: ['Synthetic provider rate limit'] });
  });

  it('leaves unreached users pending when the processing budget expires', async () => {
    mocks.userCount = 300; const starts: number[] = [];
    mocks.notify.mockImplementation(async () => { starts.push(Date.now()); await sleep(1000); return ok(); });
    const body = await run();
    expect(Math.max(...starts) - start.getTime()).toBeLessThan(240000);
    expect(body.usersRemaining).toBeGreaterThan(0); expect(body.success).toBe(false);
    expect(body.usersProcessed + body.usersRemaining).toBe(300);
    expect(console.warn).toHaveBeenCalled();
  });

  it('checks the budget again after a pacing wait', async () => {
    mocks.userCount = 2;
    mocks.notify.mockResolvedValue(ok());
    const original = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementationOnce(() => start.getTime())
      .mockImplementation(() => original() + 239750);
    const body = await run();
    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({ usersProcessed: 1, usersRemaining: 1, success: false });
  });

  it('retains the stable daily shuffle', async () => {
    mocks.userCount = 5; mocks.notify.mockResolvedValue(ok());
    await run();
    const day = Math.floor(start.getTime() / 86400000);
    const rank = (id: string) => createHash('sha256').update(`${day}:${id}`).digest('hex');
    const expected = Array.from({ length: 5 }, (_, i) => `fixture-${i}`)
      .sort((a, b) => rank(a).localeCompare(rank(b)) || a.localeCompare(b));
    expect(mocks.notify.mock.calls.map(call => call[1])).toEqual(expected);
  });

  it('returns immediately when no updates are pending', async () => {
    mocks.userCount = 0;
    expect(await run()).toMatchObject({ success: true, message: 'No pending updates to notify' });
    expect(mocks.notify).not.toHaveBeenCalled(); expect(Date.now()).toBe(start.getTime());
  });
});
