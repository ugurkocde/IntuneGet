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
});
