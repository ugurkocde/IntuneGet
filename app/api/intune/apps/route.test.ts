import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const { graphTokenMock } = vi.hoisted(() => ({ graphTokenMock: vi.fn() }));
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: vi.fn().mockResolvedValue({ userId: 'user-1', tenantId: 'tenant-1' }),
}));
vi.mock('@/lib/supabase', () => ({ getServerClientOrNull: () => null }));
vi.mock('@/lib/intune/graph-client', () => ({ getServicePrincipalToken: graphTokenMock }));

import { GET } from './route';

describe('GET /api/intune/apps', () => {
  it('serves Graph data without Supabase', async () => {
    graphTokenMock.mockResolvedValue('graph-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      value: [{ id: 'app-1', displayName: 'Example App' }],
    }), { status: 200 })));

    const response = await GET(new NextRequest('http://localhost/api/intune/apps'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      apps: [{ id: 'app-1', displayName: 'Example App' }],
      count: 1,
    });
  });
  it('returns a lightweight first page and preserves the opaque continuation', async () => {
    graphTokenMock.mockResolvedValue('graph-token');
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      value: [{ id: 'one', displayName: 'App', largeIcon: { value: 'large-icon' }, detectionRules: ['large-config'] }],
      '@odata.nextLink': 'https://graph.microsoft.com/beta/deviceAppManagement/mobileApps?$skiptoken=next%2Bpage',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(new NextRequest('http://localhost/api/intune/apps?view=list&cursor=start'));
    const data = await response.json();
    expect(data.nextPageToken).toBe('next+page');
    expect(data.apps[0]).toMatchObject({ id: 'one', hasIcon: true });
    expect(data.apps[0]).not.toHaveProperty('largeIcon');
    expect(data.apps[0]).not.toHaveProperty('detectionRules');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('$skiptoken')).toBe('start');
  });

});
