import { afterEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { client } = vi.hoisted(() => ({ client: vi.fn(() => { throw new Error('Database must not be read'); }) }));
vi.mock('@/lib/supabase', () => ({ createServerClient: client }));
import { isQaMaintenanceMode } from './maintenance';
import { getQaLiveSnapshot } from './live';
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('requires the explicit server setting and can be switched off', () => {
  vi.stubEnv('QA_MAINTENANCE_MODE', 'true');
  expect(isQaMaintenanceMode()).toBe(true);
  vi.stubEnv('QA_MAINTENANCE_MODE', 'false');
  expect(isQaMaintenanceMode()).toBe(false);
  vi.stubEnv('QA_MAINTENANCE_MODE', '');
  expect(isQaMaintenanceMode()).toBe(false);
});
it('returns no current, queued, historical, or frame data during maintenance', async () => {
  vi.stubEnv('QA_MAINTENANCE_MODE', 'true');
  const snapshot = await getQaLiveSnapshot();
  expect(snapshot).toMatchObject({ active: false, current: null, activity: null, log: null, queue: { count: 0, next: [] }, recent: [], viewer: { available: false, candidateId: null } });
  expect(client).not.toHaveBeenCalled();
});
