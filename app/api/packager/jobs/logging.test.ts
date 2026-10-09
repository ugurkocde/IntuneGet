import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  claim: vi.fn(),
  uploadHistoryCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    jobs: { getById: state.getById, update: state.update, claim: state.claim },
    uploadHistory: { create: state.uploadHistoryCreate },
  }),
  verifyPackagerApiKey: () => true,
}));
vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: true }) }));
vi.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: () => ({ delete: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }) }) }),
  }),
}));
vi.mock('@/lib/curated-catalog/server', () => ({ validateCuratedPackagingJob: vi.fn(async () => {}) }));
vi.mock('@/lib/curated-catalog/licence', () => ({
  assertCuratedLicenceAccepted: vi.fn(async () => null),
  CuratedLicenceError: class CuratedLicenceError extends Error {},
}));

import { PATCH, POST } from './route';

const job = {
  id: 'job-1',
  user_id: 'user-1',
  tenant_id: 'tenant-1',
  winget_id: 'Test.App',
  version: '1.0.0',
  display_name: 'Test App',
  publisher: 'Test',
  package_config: {},
};

function patch(body: Record<string, unknown>) {
  return PATCH(new NextRequest('http://localhost/api/packager/jobs', {
    method: 'PATCH',
    headers: { Authorization: 'Bearer key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: 'job-1', packagerId: 'packager-1', ...body }),
  }));
}

describe('local packager job lifecycle logging', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    state.getById.mockResolvedValue({ ...job, status: 'packaging' });
  });

  afterEach(() => {
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('logs a failed job with the reported error', async () => {
    state.update.mockResolvedValue({ ...job, status: 'failed' });

    const response = await patch({ status: 'failed', error: 'Upload to Intune failed: 403 Forbidden' });

    expect(response.status).toBe(200);
    expect(errorSpy).toHaveBeenCalledWith(
      '[Packager Jobs API] Job job-1 (Test.App 1.0.0) failed: Upload to Intune failed: 403 Forbidden'
    );
  });

  it('redacts signed URLs and line breaks in the reported error', async () => {
    state.update.mockResolvedValue({ ...job, status: 'failed' });

    await patch({
      status: 'failed',
      error: 'Download failed: https://cdn.example.com/setup.exe?sig=secret\nforged line',
    });

    expect(errorSpy).toHaveBeenCalledWith(
      '[Packager Jobs API] Job job-1 (Test.App 1.0.0) failed: Download failed: [redacted URL] forged line'
    );
  });

  it('logs a failure only once when the packager repeats the status', async () => {
    state.getById.mockResolvedValue({ ...job, status: 'failed' });
    state.update.mockResolvedValue({ ...job, status: 'failed' });

    await patch({ status: 'failed', error: 'Upload to Intune failed: 403 Forbidden' });

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs a deployed job', async () => {
    state.update.mockResolvedValue({ ...job, status: 'deployed', intune_app_id: 'app-1' });

    await patch({ status: 'deployed', intuneAppId: 'app-1' });

    expect(infoSpy).toHaveBeenCalledWith('[Packager Jobs API] Job job-1 (Test.App 1.0.0) deployed to Intune');
  });

  it('does not log progress heartbeats', async () => {
    state.update.mockResolvedValue({ ...job, status: 'packaging' });

    await patch({ status: 'packaging', progressPercent: 40 });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('logs unexpected update errors instead of only returning 500', async () => {
    state.update.mockRejectedValue(new Error('database is locked'));

    const response = await patch({ status: 'failed', error: 'x' });

    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith('[Packager Jobs API] Failed to update job:', expect.any(Error));
  });

  it('logs which packager claimed a job', async () => {
    state.claim.mockResolvedValue({ ...job, status: 'packaging' });

    const response = await POST(new NextRequest('http://localhost/api/packager/jobs', {
      method: 'POST',
      headers: { Authorization: 'Bearer key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: 'job-1', packagerId: 'packager-1' }),
    }));

    expect(response.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith(
      '[Packager Jobs API] Job job-1 (Test.App 1.0.0) claimed by packager packager-1'
    );
  });
});
