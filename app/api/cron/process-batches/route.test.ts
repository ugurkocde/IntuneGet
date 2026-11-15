import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorized: vi.fn(), pending: vi.fn(), advance: vi.fn(), webhooks: vi.fn() }));
vi.mock('@/lib/cron-auth', () => ({ isAuthorizedCronRequest: mocks.authorized }));
vi.mock('@/lib/msp/batch-orchestrator', () => ({ processPendingBatches: mocks.pending, advanceInProgressBatches: mocks.advance }));
vi.mock('@/lib/msp/webhook-service', () => ({ processDueWebhookDeliveries: mocks.webhooks }));
import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.invalid');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'fixture');
  mocks.authorized.mockReturnValue(true);
  mocks.pending.mockResolvedValue({ errors: [], batchesProcessed: 1, itemsStarted: 2 });
  mocks.advance.mockResolvedValue({ errors: [], staleItemsRecovered: 0, batchesCompleted: 1 });
  mocks.webhooks.mockResolvedValue(3);
});
afterEach(() => vi.unstubAllEnvs());

describe('batch cron webhook retries', () => {
  it('does not run any worker for an unauthorized request', async () => {
    mocks.authorized.mockReturnValue(false);
    expect((await GET(new Request('https://fixture.invalid'))).status).toBe(401);
    expect(mocks.webhooks).not.toHaveBeenCalled(); expect(mocks.pending).not.toHaveBeenCalled();
  });
  it('returns the bounded worker count after batch processing', async () => {
    const result = await GET(new Request('https://fixture.invalid'));
    expect(await result.json()).toMatchObject({ success: true, processed: 1, started: 2, webhooks: 3 });
  });
  it('preserves the batch result when the webhook worker fails', async () => {
    mocks.webhooks.mockRejectedValue(new Error('fixture'));
    const result = await GET(new Request('https://fixture.invalid'));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ success: true, processed: 1, webhooks: 0 });
  });
});
