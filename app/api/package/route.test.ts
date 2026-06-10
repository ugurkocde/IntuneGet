import { NextRequest } from 'next/server';
import { STALE_JOB_TIMEOUT_MINUTES, STALE_JOB_ERROR_MESSAGE } from '@/lib/stale-jobs';
import type { PackagingJob } from '@/lib/db/types';

const { getDatabaseMock, getByUserIdMock, getByIdMock, updateMock } = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  getByUserIdMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}));

import { GET } from '@/app/api/package/route';

function makeJob(overrides: Partial<PackagingJob>): PackagingJob {
  const now = new Date().toISOString();
  return {
    id: 'job-1',
    user_id: 'user-1',
    winget_id: 'Test.App',
    version: '1.0.0',
    display_name: 'Test App',
    publisher: 'Test',
    status: 'queued',
    progress_percent: 0,
    created_at: now,
    updated_at: now,
    ...overrides,
  } as PackagingJob;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

describe('GET /api/package (userId listing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDatabaseMock.mockReturnValue({
      jobs: {
        getByUserId: getByUserIdMock,
        getById: getByIdMock,
        update: updateMock,
      },
    });
    updateMock.mockImplementation(async (id: string, data: Partial<PackagingJob>) =>
      makeJob({ id, ...data })
    );
  });

  it('marks stale intermediate jobs as failed and returns the corrected status', async () => {
    const staleJob = makeJob({
      id: 'job-stale',
      status: 'packaging',
      updated_at: minutesAgo(STALE_JOB_TIMEOUT_MINUTES + 5),
    });
    getByUserIdMock.mockResolvedValue([staleJob]);

    const request = new NextRequest('http://localhost:3000/api/package?userId=user-1');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith('job-stale', {
      status: 'failed',
      error_message: STALE_JOB_ERROR_MESSAGE,
      completed_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].status).toBe('failed');
    expect(body.jobs[0].error_message).toBe(STALE_JOB_ERROR_MESSAGE);
    expect(body.jobs[0].completed_at).toEqual(expect.any(String));
  });

  it('leaves fresh intermediate jobs untouched', async () => {
    const freshJob = makeJob({
      id: 'job-fresh',
      status: 'uploading',
      updated_at: minutesAgo(5),
    });
    getByUserIdMock.mockResolvedValue([freshJob]);

    const request = new NextRequest('http://localhost:3000/api/package?userId=user-1');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
    expect(body.jobs[0].status).toBe('uploading');
  });

  it('does not touch terminal jobs regardless of age', async () => {
    const oldFailedJob = makeJob({
      id: 'job-done',
      status: 'deployed',
      updated_at: minutesAgo(60 * 24),
    });
    getByUserIdMock.mockResolvedValue([oldFailedJob]);

    const request = new NextRequest('http://localhost:3000/api/package?userId=user-1');
    const response = await GET(request);
    const body = await response.json();

    expect(updateMock).not.toHaveBeenCalled();
    expect(body.jobs[0].status).toBe('deployed');
  });

  it('falls back to created_at when updated_at is missing', async () => {
    const staleJob = makeJob({
      id: 'job-no-updated-at',
      status: 'queued',
      updated_at: undefined as unknown as string,
      created_at: minutesAgo(STALE_JOB_TIMEOUT_MINUTES + 10),
    });
    getByUserIdMock.mockResolvedValue([staleJob]);

    const request = new NextRequest('http://localhost:3000/api/package?userId=user-1');
    const response = await GET(request);
    const body = await response.json();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(body.jobs[0].status).toBe('failed');
  });

  it('keeps the original status when the heal update does not apply', async () => {
    // e.g. a concurrent callback already moved the job out of the stale state
    updateMock.mockResolvedValue(null);
    const staleJob = makeJob({
      id: 'job-race',
      status: 'packaging',
      updated_at: minutesAgo(STALE_JOB_TIMEOUT_MINUTES + 5),
    });
    getByUserIdMock.mockResolvedValue([staleJob]);

    const request = new NextRequest('http://localhost:3000/api/package?userId=user-1');
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jobs[0].status).toBe('packaging');
  });
});
