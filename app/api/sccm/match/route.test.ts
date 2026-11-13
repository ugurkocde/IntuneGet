import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), client: vi.fn(), history: vi.fn(), entry: vi.fn(),
}));
vi.mock('@/lib/auth/parse-token', () => ({ getAuthFromRequest: mocks.auth }));
vi.mock('@/lib/supabase', () => ({ createServerClient: mocks.client }));
vi.mock('@/lib/sccm/history-logger', () => ({
  logMigrationHistoryAsync: mocks.history, createAppEntry: mocks.entry,
  createSuccessEntry: vi.fn(),
}));
vi.mock('@/lib/matching/sccm-matcher', () => ({ matchSccmApp: vi.fn() }));
import { PATCH } from './route';

function fixture(found = true) {
  const app = { id: 'app-1', migration_id: 'migration-1', display_name: 'Synthetic App',
    match_status: 'matched', matched_winget_id: 'Synthetic.App' };
  const lookup = { select: vi.fn(), eq: vi.fn(), single: vi.fn() };
  lookup.select.mockReturnValue(lookup); lookup.eq.mockReturnValue(lookup);
  lookup.single.mockResolvedValue({ data: found ? app : null, error: null });
  const write = { update: vi.fn(), eq: vi.fn(), select: vi.fn(), single: vi.fn() };
  write.update.mockReturnValue(write); write.eq.mockReturnValue(write); write.select.mockReturnValue(write);
  write.single.mockImplementation(async () => ({ data: { ...app, ...write.update.mock.calls[0][0] }, error: null }));
  const from = vi.fn().mockReturnValueOnce(lookup).mockReturnValue(write);
  mocks.client.mockReturnValue({ from });
  return { lookup, write, from };
}
function request(body: object) {
  return new NextRequest('https://example.test/api/sccm/match', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  });
}

describe('SCCM exclusion requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1' });
  });
  it.each([{ action: 'exclude' }, { matchStatus: 'excluded' }])(
    'excludes the owned app and records exclusion history for %j', async body => {
      const f = fixture();
      const response = await PATCH(request({ appId: 'app-1', ...body }));
      expect(response.status).toBe(200);
      expect((await response.json()).app.match_status).toBe('excluded');
      expect(f.lookup.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1');
      expect(f.write.update).toHaveBeenCalledWith(expect.objectContaining({ match_status: 'excluded' }));
      expect(mocks.entry.mock.calls[0][3]).toBe('app_excluded');
    },
  );
  it('keeps manual linking behavior', async () => {
    const f = fixture();
    const response = await PATCH(request({ appId: 'app-1', action: 'link', wingetPackageId: 'Synthetic.Other' }));
    expect(response.status).toBe(200);
    expect(f.write.update).toHaveBeenCalledWith(expect.objectContaining({ match_status: 'matched', matched_winget_id: 'Synthetic.Other' }));
    expect(mocks.entry.mock.calls[0][3]).toBe('app_matched_manual');
  });
  it('does not write when the tenant lookup does not find the app', async () => {
    const f = fixture(false);
    expect((await PATCH(request({ appId: 'app-1', action: 'exclude' }))).status).toBe(404);
    expect(f.write.update).not.toHaveBeenCalled();
  });
});
