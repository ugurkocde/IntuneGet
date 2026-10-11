import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const fixture = vi.hoisted(() => ({ allowed: true, createServerClient: vi.fn() }));
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async () => fixture.allowed ? { userId: 'local-webhook-owner' } : null,
}));
vi.mock('@/lib/supabase', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supabase')>('@/lib/supabase');
  return { ...actual, createServerClient: fixture.createServerClient };
});
import { DELETE, GET, PUT } from './route';
import { POST as TEST } from './test/route';
import { WEBHOOK_STORAGE_UNAVAILABLE_MESSAGE } from '@/types/notifications';

const context = { params: Promise.resolve({ id: 'local-webhook' }) };
const request = (method: string, body?: unknown) => new NextRequest('http://localhost/api/webhooks/local-webhook', {
  method, headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const calls = {
  GET: () => GET(request('GET'), context),
  PUT: () => PUT(request('PUT', { name: 'Renamed fixture' }), context),
  DELETE: () => DELETE(request('DELETE'), context),
  TEST: () => TEST(request('POST'), context),
};

beforeEach(() => {
  fixture.allowed = true;
  fixture.createServerClient.mockReset();
  fixture.createServerClient.mockImplementation(() => { throw new Error('Supabase URL and service role key are required'); });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('individual webhook routes without Supabase', () => {
  it.each(Object.keys(calls) as Array<keyof typeof calls>)('explains unavailable storage for %s instead of failing', async (name) => {
    const response = await calls[name]();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: WEBHOOK_STORAGE_UNAVAILABLE_MESSAGE });
    expect(fixture.createServerClient).not.toHaveBeenCalled();
  });
  it.each(Object.keys(calls) as Array<keyof typeof calls>)('keeps authentication ahead of configuration for %s', async (name) => {
    fixture.allowed = false;
    expect((await calls[name]()).status).toBe(401);
    expect(fixture.createServerClient).not.toHaveBeenCalled();
  });
});
