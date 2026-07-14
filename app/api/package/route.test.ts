import { NextRequest } from 'next/server';
import { STALE_JOB_TIMEOUT_MINUTES, STALE_JOB_ERROR_MESSAGE } from '@/lib/stale-jobs';
import type { PackagingJob } from '@/lib/db/types';

const {
  getDatabaseMock,
  getByUserIdMock,
  getByIdMock,
  updateMock,
  createMock,
  parseAccessTokenMock,
  checkStoredConsentMock,
  verifyTenantConsentMock,
  isGitHubActionsConfiguredMock,
  triggerPackagingWorkflowMock,
  getAppConfigMock,
  getFeatureFlagsMock,
  enforceInstallerPreflightMock,
} = vi.hoisted(() => ({
  getDatabaseMock: vi.fn(),
  getByUserIdMock: vi.fn(),
  getByIdMock: vi.fn(),
  updateMock: vi.fn(),
  createMock: vi.fn(),
  parseAccessTokenMock: vi.fn(),
  checkStoredConsentMock: vi.fn(),
  verifyTenantConsentMock: vi.fn(),
  isGitHubActionsConfiguredMock: vi.fn(),
  triggerPackagingWorkflowMock: vi.fn(),
  getAppConfigMock: vi.fn(),
  getFeatureFlagsMock: vi.fn(),
  enforceInstallerPreflightMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getDatabase: getDatabaseMock,
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/msp/consent-cache', () => ({
  checkStoredConsent: checkStoredConsentMock,
}));

vi.mock('@/lib/msp/consent-verification', () => ({
  verifyTenantConsent: verifyTenantConsentMock,
}));

vi.mock('@/lib/github-actions', () => ({
  isGitHubActionsConfigured: isGitHubActionsConfiguredMock,
  triggerPackagingWorkflow: triggerPackagingWorkflowMock,
}));

vi.mock('@/lib/config', () => ({
  getAppConfig: getAppConfigMock,
}));

vi.mock('@/lib/features', () => ({
  getFeatureFlags: getFeatureFlagsMock,
}));

vi.mock('@/lib/installer-preflight', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/installer-preflight')>();
  return {
    ...original,
    enforceInstallerPreflight: enforceInstallerPreflightMock,
  };
});

vi.mock('@/lib/supabase', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/msp/tenant-resolution', () => ({
  resolveTargetTenantId: vi.fn(async ({ tokenTenantId }: { tokenTenantId: string }) => ({
    tenantId: tokenTenantId,
    errorResponse: null,
  })),
}));

vi.mock('@/lib/graph-token', () => ({
  acquireGraphToken: vi.fn(),
}));

vi.mock('@/lib/store-app-deploy', () => ({
  deployStoreApp: vi.fn(),
}));

import { GET, POST } from '@/app/api/package/route';
import { InstallerPreflightError } from '@/lib/installer-preflight';

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
    // The list path now authenticates and uses the token's userId.
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      tenantId: 'tenant-1',
      userEmail: 'user@example.com',
      userName: 'User One',
    });
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

describe('POST /api/package (workflow dispatch)', () => {
  const relationships = [
    {
      relationshipType: 'supersedence',
      targetId: 'old-app-1',
      targetDisplayName: 'Old App',
      supersedenceType: 'replace',
    },
  ];

  function makeWin32Item(overrides: Record<string, unknown> = {}) {
    return {
      wingetId: 'Test.App',
      displayName: 'Test App',
      publisher: 'Test',
      version: '1.0.0',
      architecture: 'x64',
      installerType: 'exe',
      installerUrl: 'https://example.com/setup.exe',
      installerSha256: 'a'.repeat(64),
      installCommand: 'setup.exe /S',
      uninstallCommand: 'uninstall.exe /S',
      installScope: 'machine',
      detectionRules: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getDatabaseMock.mockReturnValue({
      jobs: {
        create: createMock,
        update: updateMock,
      },
    });
    createMock.mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      created_at: new Date().toISOString(),
    }));
    updateMock.mockResolvedValue({});
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'tenant-1',
      userName: 'User',
    });
    checkStoredConsentMock.mockResolvedValue(true);
    getFeatureFlagsMock.mockReturnValue({ pipeline: true, localPackager: false });
    isGitHubActionsConfiguredMock.mockReturnValue(true);
    getAppConfigMock.mockReturnValue({ app: { url: 'http://localhost:3000' } });
    triggerPackagingWorkflowMock.mockResolvedValue({ success: true });
    enforceInstallerPreflightMock.mockResolvedValue({
      cacheKey: 'healthy-key',
      status: 'healthy',
      source: 'cache',
    });
  });

  it('forwards item relationships into the workflow inputs', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item({ relationships })] }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledWith(
      expect.objectContaining({
        wingetId: 'Test.App',
        relationships: JSON.stringify(relationships),
      }),
      undefined,
      expect.any(Object)
    );
  });

  it('omits relationships from the workflow inputs when none are configured', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item()] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
    expect(triggerPackagingWorkflowMock.mock.calls[0][0].relationships).toBeUndefined();
  });

  it('calculates the hash in the workflow for a custom app without a supplied SHA256', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({ sourceType: 'custom', installerSha256: '' })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerPackagingWorkflowMock).toHaveBeenCalledTimes(1);
    expect(triggerPackagingWorkflowMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        installerSha256: '',
        hashValidationMode: 'calculate',
      })
    );
  });

  it('treats a whitespace-only custom-app SHA256 as missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({ sourceType: 'custom', installerSha256: '   ' })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerPackagingWorkflowMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        installerSha256: '',
        hashValidationMode: 'calculate',
      })
    );
  });

  it('keeps strict hash validation when a trusted SHA256 is supplied', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item()] }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerPackagingWorkflowMock.mock.calls[0][0].hashValidationMode).toBe('strict');
  });

  it('rejects a catalog package without its trusted manifest SHA256', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item({ installerSha256: '' })] }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/catalog packages require a trusted manifest hash/i);
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid custom-app SHA256 instead of calculating over malformed input', async () => {
    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [makeWin32Item({ sourceType: 'custom', installerSha256: 'not-a-hash' })],
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });

  it('blocks a quarantined installer before creating a job or dispatching an Action', async () => {
    enforceInstallerPreflightMock.mockRejectedValueOnce(new InstallerPreflightError(
      'HASH_MISMATCH',
      'The publisher currently serves different bytes.',
      false,
      'b'.repeat(64),
    ));

    const request = new NextRequest('http://localhost:3000/api/package', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [makeWin32Item()] }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual(expect.objectContaining({
      code: 'HASH_MISMATCH',
      retryable: false,
      package: {
        wingetId: 'Test.App',
        displayName: 'Test App',
        version: '1.0.0',
      },
      expectedSha256: 'A'.repeat(64),
      actualSha256: 'b'.repeat(64),
    }));
    expect(createMock).not.toHaveBeenCalled();
    expect(triggerPackagingWorkflowMock).not.toHaveBeenCalled();
  });
});
