import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { parseAccessTokenMock, getServerClientOrNullMock } = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  getServerClientOrNullMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  getServerClientOrNull: getServerClientOrNullMock,
}));

import { GET } from '@/app/api/intune/esp-profiles/route';

vi.mock('@/lib/msp/tenant-resolution', () => ({ resolveTargetTenantId: vi.fn().mockResolvedValue({ tenantId: 'fixture-tenant' }) }));
vi.mock('@/lib/graph-token', () => ({ acquireGraphToken: vi.fn().mockResolvedValue({ accessToken: 'fixture-token' }) }));

const consent = vi.fn();
beforeEach(() => {
  parseAccessTokenMock.mockResolvedValue({ userId: 'fixture-user', tenantId: 'fixture-tenant' });
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: consent };
  getServerClientOrNullMock.mockReturnValue({ from: () => chain });
  consent.mockResolvedValue({ data: { is_active: true }, error: null });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ESP access error responses', () => {
  const request = () => new NextRequest('http://localhost/api/intune/esp-profiles');
  it('returns actionable 403 without exposing or logging Graph details', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const json = vi.fn().mockResolvedValue({ error: { message: 'private-tenant fixture@example.invalid' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, statusText: 'Forbidden', json }));
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'esp_graph_forbidden', error: expect.stringContaining('existing DeviceManagementServiceConfig.ReadWrite.All admin consent') });
    expect(json).not.toHaveBeenCalled();
    expect(JSON.stringify([...error.mock.calls, ...warn.mock.calls])).not.toMatch(/private-tenant|fixture@example/);
    expect(error).not.toHaveBeenCalled();
  });
  it('keeps other failures at 500 with a fixed response and safe log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private-tenant fixture@example.invalid')));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to fetch ESP profiles' });
    expect(error).toHaveBeenCalledWith('[ESP Profiles] list failed', { status: 500 });
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/private-tenant|fixture@example/);
  });
  it('keeps missing consent distinct from Graph refusal', async () => {
    consent.mockResolvedValue({ data: null, error: { message: 'missing' } });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Admin consent not found. Please complete the admin consent flow.' });
  });
  it('keeps missing authentication at 401', async () => {
    parseAccessTokenMock.mockResolvedValue(null);
    expect((await GET(request())).status).toBe(401);
  });
  it('returns successful profiles unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ value: [] }) }));
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profiles: [], count: 0 });
  });
});

describe('GET /api/intune/esp-profiles', () => {
  it('returns an empty profile list when Supabase server access is not configured', async () => {
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      userEmail: 'user@example.com',
    });
    getServerClientOrNullMock.mockReturnValue(null);

    const response = await GET(new NextRequest('http://localhost/api/intune/esp-profiles'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ profiles: [], count: 0 });
  });
});
