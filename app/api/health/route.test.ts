import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock, selectMock, limitMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  selectMock: vi.fn(),
  limitMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock })),
}));

vi.mock('@/lib/db', () => ({
  getDatabaseMode: vi.fn(() => 'supabase'),
  getDatabase: vi.fn(),
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
    vi.stubEnv('AZURE_CLIENT_ID', 'client-id');
    vi.stubEnv('AZURE_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('GITHUB_PAT', 'github-token');
    vi.stubEnv('GITHUB_OWNER', 'example');
    vi.stubEnv('GITHUB_WORKFLOWS_REPO', 'workflows');
    fromMock.mockReturnValue({ select: selectMock });
    selectMock.mockReturnValue({ limit: limitMock });
    limitMock.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('probes the public curated catalog table and reports a healthy hosted deployment', async () => {
    const response = await GET();
    const body = await response.json();

    expect(fromMock).toHaveBeenCalledWith('curated_apps');
    expect(selectMock).toHaveBeenCalledWith('winget_id');
    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      status: 'healthy',
      mode: 'hosted',
      databaseMode: 'supabase',
      services: {
        database: true,
        auth: true,
        pipeline: true,
      },
    }));
  });
});
