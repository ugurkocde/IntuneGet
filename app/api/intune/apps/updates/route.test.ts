import { NextRequest } from 'next/server';
import { invalidateServicePrincipalToken } from '@/lib/intune/graph-client';

const {
  parseAccessTokenMock,
  createServerClientMock,
  resolveTargetTenantIdMock,
  matchAppToWingetMock,
  matchAppToWingetWithDatabaseMock,
  isSupabaseConfiguredMock,
  getDatabaseMock,
  getHistoryMock,
  getCatalogSourceMock,
  getAppsByWingetIdsMock,
} = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  createServerClientMock: vi.fn(),
  resolveTargetTenantIdMock: vi.fn(),
  matchAppToWingetMock: vi.fn(),
  matchAppToWingetWithDatabaseMock: vi.fn(),
  isSupabaseConfiguredMock: vi.fn(),
  getDatabaseMock: vi.fn(),
  getHistoryMock: vi.fn(),
  getCatalogSourceMock: vi.fn(),
  getAppsByWingetIdsMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
  // getCatalogSource() branches on isSupabaseConfigured(), and so does the
  // route itself now, so each case decides which mode it runs in.
  isSupabaseConfigured: isSupabaseConfiguredMock,
}));

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}));

// The catalog picks its own backing store from isSupabaseConfigured(); mock it
// so the Supabase-less cases don't reach for a real snapshot file.
vi.mock('@/lib/catalog', () => ({
  getCatalogSource: getCatalogSourceMock,
}));

vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: resolveTargetTenantIdMock,
}));

vi.mock('@/lib/app-matching', () => ({
  matchAppToWinget: matchAppToWingetMock,
  matchAppToWingetWithDatabase: matchAppToWingetWithDatabaseMock,
}));

import { GET } from '@/app/api/intune/apps/updates/route';

function createSupabaseMock(
  curatedRows: Array<{ winget_id: string; latest_version: string }>,
  options: {
    claimedRows?: Array<{
      intune_app_id: string | null;
      discovered_app_name: string;
      winget_package_id: string;
    }>;
    manualMappingRows?: Array<{
      discovered_app_name: string;
      winget_package_id: string;
    }>;
    uploadHistoryRows?: Array<{
      intune_app_id: string;
      winget_id: string;
      version: string | null;
    }>;
  } = {}
) {
  // Deployment history moved to the db abstraction (it exists in both
  // backends), so the same options object wires that mock rather than a
  // supabase table branch.
  getHistoryMock.mockResolvedValue(options.uploadHistoryRows || []);
  // Latest versions come from the catalog abstraction, which serves a local
  // snapshot when Supabase is absent.
  getAppsByWingetIdsMock.mockResolvedValue(curatedRows);

  return {
    from: (table: string) => {
      if (table === 'tenant_consent') {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.single = vi.fn(async () => ({ data: { id: 'consent-1' }, error: null }));
        return chain;
      }

      if (table === 'claimed_apps') {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
          Promise.resolve({ data: options.claimedRows || [], error: null }).then(resolve);
        return chain;
      }

      if (table === 'manual_app_mappings') {
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.or = vi.fn(() => chain);
        chain.then = (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
          Promise.resolve({ data: options.manualMappingRows || [], error: null }).then(resolve);
        return chain;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe('GET /api/intune/apps/updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isSupabaseConfiguredMock.mockReturnValue(true);
    getDatabaseMock.mockReturnValue({
      uploadHistory: { getByUserIdAndTenantId: getHistoryMock },
    });
    getHistoryMock.mockResolvedValue([]);
    getCatalogSourceMock.mockReturnValue({ getAppsByWingetIds: getAppsByWingetIdsMock });
    getAppsByWingetIdsMock.mockResolvedValue([]);
    // The shared service-principal token helper caches per tenant; clear it so
    // each case's mocked token fetch is exercised fresh.
    invalidateServicePrincipalToken('tenant-1');
    process.env.AZURE_CLIENT_ID = '00000000-0000-0000-0000-000000000001';
    process.env.AZURE_CLIENT_SECRET = 'test-secret';
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-1',
      userName: 'Test User',
    });
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
        Authorization: 'Bearer mock-token',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updateCount).toBe(1);
    expect(body.updates[0].intuneApp.id).toBe('app-new');
    expect(body.updates[0].currentVersion).toBe('2.0.0');
    expect(body.updates[0].latestVersion).toBe('2.5.0');
    // Matched only by the fuzzy matcher -> not IntuneGet-managed
    expect(body.updates[0].isManaged).toBe(false);
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
        Authorization: 'Bearer mock-token',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updateCount).toBe(1);
    expect(body.updates[0].wingetId).toBe('VideoLAN.VLC');
    // Database fuzzy matcher is still a heuristic match -> not managed
    expect(body.updates[0].isManaged).toBe(false);
    expect(matchAppToWingetWithDatabaseMock).toHaveBeenCalled();
  });

  it('uses explicit manual mappings before fuzzy matching', async () => {
    createServerClientMock.mockReturnValue(
      createSupabaseMock(
        [{ winget_id: 'Contoso.CustomApp', latest_version: '2.0.0' }],
        {
          manualMappingRows: [
            {
              discovered_app_name: 'contoso custom app',
              winget_package_id: 'Contoso.CustomApp',
            },
          ],
        }
      )
    );

    // Fuzzy matchers would produce a wrong match; they must not be consulted
    matchAppToWingetMock.mockReturnValue({
      confidence: 'high',
      wingetId: 'Wrong.Package',
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
              id: 'app-1',
              displayName: 'Contoso Custom App',
              publisher: 'Contoso',
              displayVersion: '1.0.0',
              lastModifiedDateTime: '2026-02-02T00:00:00Z',
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest('http://localhost:3000/api/intune/apps/updates', {
      headers: {
        Authorization: 'Bearer mock-token',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updateCount).toBe(1);
    expect(body.updates[0].wingetId).toBe('Contoso.CustomApp');
    // Explicit manual mapping -> IntuneGet-managed
    expect(body.updates[0].isManaged).toBe(true);
    expect(matchAppToWingetMock).not.toHaveBeenCalled();
    expect(matchAppToWingetWithDatabaseMock).not.toHaveBeenCalled();
  });

  it('uses claimed app links before fuzzy matching', async () => {
    createServerClientMock.mockReturnValue(
      createSupabaseMock(
        [{ winget_id: 'Fabrikam.Tool', latest_version: '3.1.0' }],
        {
          claimedRows: [
            {
              intune_app_id: 'app-claimed',
              discovered_app_name: 'Fabrikam Tool',
              winget_package_id: 'Fabrikam.Tool',
            },
          ],
        }
      )
    );

    matchAppToWingetMock.mockReturnValue(null);
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
              id: 'app-claimed',
              displayName: 'Fabrikam Tool Renamed',
              publisher: 'Fabrikam',
              displayVersion: '3.0.0',
              lastModifiedDateTime: '2026-02-02T00:00:00Z',
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest('http://localhost:3000/api/intune/apps/updates', {
      headers: {
        Authorization: 'Bearer mock-token',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updateCount).toBe(1);
    expect(body.updates[0].wingetId).toBe('Fabrikam.Tool');
    // Explicit claimed-app link -> IntuneGet-managed
    expect(body.updates[0].isManaged).toBe(true);
    expect(matchAppToWingetMock).not.toHaveBeenCalled();
    expect(matchAppToWingetWithDatabaseMock).not.toHaveBeenCalled();
  });

  it('tags deployment-history matches as managed without fuzzy matching', async () => {
    createServerClientMock.mockReturnValue(
      createSupabaseMock(
        [{ winget_id: 'Git.Git', latest_version: '2.45.0' }],
        {
          uploadHistoryRows: [
            { intune_app_id: 'app-git', winget_id: 'Git.Git', version: '2.40.0' },
          ],
        }
      )
    );

    matchAppToWingetMock.mockReturnValue(null);
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
              id: 'app-git',
              displayName: 'Git',
              publisher: 'The Git Development Community',
              displayVersion: '2.40.0',
              lastModifiedDateTime: '2026-02-02T00:00:00Z',
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest('http://localhost:3000/api/intune/apps/updates', {
      headers: {
        Authorization: 'Bearer mock-token',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updateCount).toBe(1);
    expect(body.updates[0].wingetId).toBe('Git.Git');
    // Deployment history is authoritative provenance -> managed, fuzzy skipped
    expect(body.updates[0].isManaged).toBe(true);
    expect(matchAppToWingetMock).not.toHaveBeenCalled();
    expect(matchAppToWingetWithDatabaseMock).not.toHaveBeenCalled();
  });

  it('checks for updates without Supabase (DATABASE_MODE=sqlite self-hosting)', async () => {
    // Regression: the route refused every request with a blanket 503 when
    // Supabase was absent, so the App Updates page in a self-hosted install
    // could only ever report "all apps are up to date". Nothing in the
    // comparison needs Supabase: deployed apps come from Graph, latest
    // versions from the catalog (snapshot-backed in this mode) and deployment
    // history from the db abstraction.
    isSupabaseConfiguredMock.mockReturnValue(false);
    getHistoryMock.mockResolvedValue([
      { intune_app_id: 'app-git', winget_id: 'Git.Git', version: '2.40.0' },
    ]);
    getAppsByWingetIdsMock.mockResolvedValue([
      { winget_id: 'Git.Git', latest_version: '2.45.0' },
    ]);

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
              id: 'app-git',
              displayName: 'Git',
              publisher: 'The Git Development Community',
              displayVersion: '2.40.0',
              lastModifiedDateTime: '2026-02-02T00:00:00Z',
            },
          ],
        }),
      });

    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest('http://localhost:3000/api/intune/apps/updates', {
      headers: {
        Authorization: 'Bearer mock-token',
      },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.updateCount).toBe(1);
    expect(body.updates[0].wingetId).toBe('Git.Git');
    expect(body.updates[0].latestVersion).toBe('2.45.0');
    // No Supabase client is created, and the tenant falls back to the token's
    // own tenant instead of going through MSP resolution.
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(resolveTargetTenantIdMock).not.toHaveBeenCalled();
    expect(getHistoryMock).toHaveBeenCalledWith('user-1', 'tenant-1');
  });
});
