import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: async () => ({ userId: 'local-preferences-owner' }),
}));
const storage = vi.hoisted(() => ({ configured: false, row: null as Record<string, unknown> | null }));
vi.mock('@/lib/supabase', () => ({
  isSupabaseServerConfigured: () => storage.configured,
  createServerClient: () => {
    if (!storage.configured) throw new Error('Supabase URL and service role key are required');
    return { from: () => ({ select: () => ({ eq: () => ({
      single: async () => storage.row
        ? { data: storage.row, error: null } : { data: null, error: { code: 'PGRST116' } },
    }) }) }) };
  },
}));
import { GET } from './route';

const get = () => GET(new NextRequest('http://localhost/api/notifications/preferences', {
  headers: { Authorization: 'Bearer fixture' },
}));

beforeEach(() => { storage.configured = false; storage.row = null; });
afterEach(() => { vi.unstubAllEnvs(); });

describe('email notification setup requirement', () => {
  it('reports that Supabase is required when the deployment has no Supabase storage', async () => {
    vi.stubEnv('RESEND_API_KEY', 'local-test-placeholder');
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ isEmailConfigured: false, emailSetupRequirement: 'supabase' });
  });
  it('reports that email delivery is required when Resend is not configured', async () => {
    storage.configured = true;
    vi.stubEnv('RESEND_API_KEY', '');
    expect(await (await get()).json()).toMatchObject({ isEmailConfigured: false, emailSetupRequirement: 'resend' });
    storage.row = { user_id: 'local-preferences-owner', email_enabled: false };
    expect(await (await get()).json()).toMatchObject({ isEmailConfigured: false, emailSetupRequirement: 'resend' });
  });
  it('reports no requirement when storage and email delivery are configured', async () => {
    storage.configured = true;
    vi.stubEnv('RESEND_API_KEY', 'local-test-placeholder');
    expect(await (await get()).json()).toMatchObject({ isEmailConfigured: true, emailSetupRequirement: null });
  });
});
