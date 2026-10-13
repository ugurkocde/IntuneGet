import { afterEach, describe, expect, it, vi } from 'vitest';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { createServerClient: () => createClient('https://database.example.test', 'unit-test-only', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchMock },
  }) };
});
import { supabaseDb } from '@/lib/db/supabase-adapter';

afterEach(() => vi.clearAllMocks());

describe('Supabase jobs.create wire payload', () => {
  it('persists the provided failure reason without changing the job status', async () => {
    const reason = 'This app is not currently available for deployment.';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'fixture-job' }), {
      status: 201, headers: { 'content-type': 'application/json' },
    }));

    await supabaseDb.jobs.create({
      id: 'fixture-job', user_id: 'fixture-user', winget_id: 'Fixture.Unavailable',
      version: '1.0.0', display_name: 'Unavailable fixture', installer_type: 'exe',
      installer_url: 'https://example.invalid/fixture.exe', status: 'qa_failed',
      status_message: reason, error_message: reason, error_code: 'QA_FAILED_EXECUTION_PROFILE',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).pathname).toBe('/rest/v1/packaging_jobs');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      status: 'qa_failed', status_message: reason, error_message: reason,
      error_code: 'QA_FAILED_EXECUTION_PROFILE',
    });
  });

  it('does not invent an error for a queued job', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'queued-fixture' }), {
      status: 201, headers: { 'content-type': 'application/json' },
    }));
    await supabaseDb.jobs.create({
      id: 'queued-fixture', user_id: 'fixture-user', winget_id: 'Fixture.Queued',
      version: '1.0.0', display_name: 'Queued fixture', installer_type: 'exe',
      installer_url: 'https://example.invalid/fixture.exe', status_message: 'Preparing deployment',
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.status).toBe('queued');
    expect(body).not.toHaveProperty('error_message');
  });
});
