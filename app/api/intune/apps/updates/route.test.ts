import { NextRequest } from 'next/server';

const {
  createServerClientMock,
  resolveTargetTenantIdMock,
  matchAppToWingetMock,
  matchAppToWingetWithDatabaseMock,
} = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  resolveTargetTenantIdMock: vi.fn(),
  matchAppToWingetMock: vi.fn(),
  matchAppToWingetWithDatabaseMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
}));

vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: resolveTargetTenantIdMock,
}));

vi.mock('@/lib/app-matching', () => ({
  matchAppToWinget: matchAppToWingetMock,
  matchAppToWingetWithDatabase: matchAppToWingetWithDatabaseMock,
}));

import { GET } from '@/app/api/intune/apps/updates/route';

function buildToken(payload: Record<string, string>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `header.${encoded}.signature`;
}

function createSupabaseMock(curatedRows: Array<{ winget_id: string; latest_version: string }>) {
  return {
    from: (table: string) => {
      if (table === 'tenant_consent') {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(async () => ({ data: { id: 'consent-1' }, error: null }));
        return chain;
      }

      if (table === 'curated_apps') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async () => ({ data: curatedRows, error: null })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe('GET /api/intune/apps/updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AZURE_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
    process.env.AZURE_CLIENT_SECRET = 'test-secret';
    resolveTargetTenantIdMock.mockResolvedValue({
      tenantId: 'tenant-1',
      errorResponse: null,
    });
  });

  it('compares updates using newest app object per Winget ID', async () => {
    createServerClientMock.mockReturnValue(
      createSupabaseMock([{ winget_id: 'Microsoft.Edge', latest_version: '2.5.0' }])
    );

    matchAppToWingetMock.mockReturnValue({
      confidence: 'high',
      wingetId: 'Microsoft.Edge',
      matchReason: 'Known app mapping',
    });
    matchAppToWingetWithDatabaseMock.mockResolvedValue(null);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'graph-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              id: 'app-old',
              displayName: 'Edge Old',
              publisher: 'Microsoft',
              displayVersion: '1.0.0',
              lastModifiedDateTime: '2026-02-01T00:00:00Z',
            },
            {
              id: 'app-new',
              displayName: 'Edge New',
              publisher: 'Microsoft',
              displayVersion: '2.0.0',
              lastModifiedDateTime: '2026-02-02T00:00:00Z',
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest('http://localhost:3000/api/intune/apps/updates', {
      headers: {
        Authorization: `Bearer ${buildToken({ oid: 'user-1', tid: 'tenant-1' })}`,
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updateCount).toBe(1);
    expect(body.updates[0].intuneApp.id).toBe('app-new');
    expect(body.updates[0].currentVersion).toBe('2.0.0');
    expect(body.updates[0].latestVersion).toBe('2.5.0');
    expect(
      body.checkedApps.some((item: { result: string }) =>
        item.result.includes('Older tenant app object')
      )
    ).toBe(true);
  });

  it('falls back to database matcher when synchronous matching misses', async () => {
    createServerClientMock.mockReturnValue(
      createSupabaseMock([{ winget_id: 'VideoLAN.VLC', latest_version: '4.0.0' }])
    );

    matchAppToWingetMock.mockReturnValue(null);
    matchAppToWingetWithDatabaseMock.mockResolvedValue({
      confidence: 'high',
      wingetId: 'VideoLAN.VLC',
      matchReason: 'Curated apps database match',
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'graph-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [
            {
              id: 'app-1',
              displayName: 'VLC media player',
              publisher: 'VideoLAN',
              displayVersion: '3.0.0',
              lastModifiedDateTime: '2026-02-02T00:00:00Z',
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest('http://localhost:3000/api/intune/apps/updates', {
      headers: {
        Authorization: `Bearer ${buildToken({ oid: 'user-1', tid: 'tenant-1' })}`,
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updateCount).toBe(1);
    expect(body.updates[0].wingetId).toBe('VideoLAN.VLC');
    expect(matchAppToWingetWithDatabaseMock).toHaveBeenCalled();
  });
});
