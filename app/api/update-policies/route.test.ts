import { NextRequest } from 'next/server';

const {
  parseAccessTokenMock,
  createServerClientMock,
  getCatalogSourceMock,
  getAppForInstallerMock,
} = vi.hoisted(() => ({
  parseAccessTokenMock: vi.fn(),
  createServerClientMock: vi.fn(),
  getCatalogSourceMock: vi.fn(),
  getAppForInstallerMock: vi.fn(),
}));

vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: parseAccessTokenMock,
}));

vi.mock('@/lib/supabase', () => ({
  createServerClient: createServerClientMock,
}));

vi.mock('@/lib/catalog', () => ({
  getCatalogSource: getCatalogSourceMock,
}));

import { POST } from '@/app/api/update-policies/route';

interface TableData {
  update_check_results?: Record<string, unknown> | null;
  upload_history?: Record<string, unknown> | null;
  packaging_jobs?: Record<string, unknown> | null;
  user_settings?: Record<string, unknown> | null;
  existing_policy?: { id: string } | null;
}

/**
 * Builds a supabase mock whose query chain is fully thenable/awaitable at every
 * terminal (single / maybeSingle). The chain ignores filter arguments and just
 * resolves to the data registered for the table being queried.
 */
function createSupabaseMock(data: TableData) {
  const insertPayloads: Array<Record<string, unknown>> = [];
  const updatePayloads: Array<Record<string, unknown>> = [];

  const resultFor = (table: string): { data: unknown; error: null } => {
    switch (table) {
      case 'update_check_results':
        return { data: data.update_check_results ?? null, error: null };
      case 'upload_history':
        return { data: data.upload_history ?? null, error: null };
      case 'packaging_jobs':
        return { data: data.packaging_jobs ?? null, error: null };
      case 'user_settings':
        return { data: data.user_settings ?? null, error: null };
      default:
        return { data: null, error: null };
    }
  };

  const makeChain = (table: string) => {
    const result = resultFor(table);
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const method of ['select', 'eq', 'order', 'limit']) {
      chain[method] = vi.fn(passthrough);
    }
    chain.single = vi.fn(async () => result);
    chain.maybeSingle = vi.fn(async () => result);
    return chain;
  };

  const supabase = {
    from: (table: string) => {
      if (table === 'app_update_policies') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(function thisEq() {
              return {
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: data.existing_policy ?? null,
                      error: null,
                    })),
                    maybeSingle: vi.fn(async () => ({
                      data: data.existing_policy ?? null,
                      error: null,
                    })),
                  })),
                })),
              };
            }),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => {
            insertPayloads.push(payload);
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: { id: 'policy-new', ...payload },
                  error: null,
                })),
              })),
            };
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            updatePayloads.push(payload);
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: { id: data.existing_policy?.id, ...payload },
                    error: null,
                  })),
                })),
              })),
            };
          }),
        };
      }

      return makeChain(table);
    },
  };

  return { supabase, insertPayloads, updatePayloads };
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/update-policies', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/update-policies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    parseAccessTokenMock.mockResolvedValue({
      userId: 'user-1',
      userEmail: 'user@example.com',
      tenantId: 'home-tenant',
      userName: 'User',
    });
    getAppForInstallerMock.mockResolvedValue(null);
    getCatalogSourceMock.mockReturnValue({
      getAppForInstaller: getAppForInstallerMock,
    });
  });

  it('derives the current version for pin_version when client omits it', async () => {
    const { supabase, insertPayloads } = createSupabaseMock({
      update_check_results: { current_version: '1.2.3', latest_version: '1.3.0' },
      existing_policy: null,
    });
    createServerClientMock.mockReturnValue(supabase);

    const response = await POST(
      makeRequest({
        winget_id: 'Microsoft.Edge',
        tenant_id: 'tenant-1',
        policy_type: 'pin_version',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0].pinned_version).toBe('1.2.3');
    expect(insertPayloads[0].policy_type).toBe('pin_version');
    expect(body.created).toBe(true);
  });

  it('returns 400 for pin_version when no current version can be derived', async () => {
    const { supabase } = createSupabaseMock({
      update_check_results: null,
      upload_history: null,
      existing_policy: null,
    });
    createServerClientMock.mockReturnValue(supabase);

    const response = await POST(
      makeRequest({
        winget_id: 'Missing.App',
        tenant_id: 'tenant-1',
        policy_type: 'pin_version',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('pinned_version');
  });

  it('derives a deployment_config from a prior deployment for auto_update', async () => {
    const { supabase, insertPayloads } = createSupabaseMock({
      update_check_results: { current_version: '1.0.0', latest_version: '2.0.0' },
      upload_history: { id: 'upload-1', packaging_job_id: 'job-1' },
      packaging_jobs: {
        id: 'job-1',
        display_name: 'Microsoft Edge',
        publisher: 'Microsoft',
        architecture: 'x64',
        installer_type: 'exe',
        install_command: 'setup.exe /silent',
        uninstall_command: 'setup.exe /uninstall',
        install_scope: 'system',
        detection_rules: [],
        package_config: { assignments: [], categories: [] },
      },
      user_settings: { carryOverAssignments: true },
      existing_policy: null,
    });
    createServerClientMock.mockReturnValue(supabase);

    const response = await POST(
      makeRequest({
        winget_id: 'Microsoft.Edge',
        tenant_id: 'tenant-1',
        policy_type: 'auto_update',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0].policy_type).toBe('auto_update');
    expect(insertPayloads[0].original_upload_history_id).toBe('upload-1');
    const config = insertPayloads[0].deployment_config as Record<string, unknown>;
    expect(config).toBeTruthy();
    expect(config.displayName).toBe('Microsoft Edge');
    expect(config.forceCreateNewApp).toBe(true);
    expect(body.created).toBe(true);
  });

  it('returns 400 for auto_update with no prior deployment and not in catalog', async () => {
    const { supabase } = createSupabaseMock({
      update_check_results: { current_version: '1.0.0', latest_version: '2.0.0' },
      upload_history: null,
      user_settings: null,
      existing_policy: null,
    });
    createServerClientMock.mockReturnValue(supabase);
    // Catalog returns no app -> buildDefaultDeploymentConfig returns null
    getCatalogSourceMock.mockReturnValue({
      getAppForInstaller: getAppForInstallerMock,
      getAppNamePublisher: vi.fn(async () => null),
      getVersionInstallerInfo: vi.fn(async () => null),
    });

    const response = await POST(
      makeRequest({
        winget_id: 'Not.InCatalog',
        tenant_id: 'tenant-1',
        policy_type: 'auto_update',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Auto-update requires');
  });

  it('creates an ignore policy with just the policy type', async () => {
    const { supabase, insertPayloads } = createSupabaseMock({
      existing_policy: null,
    });
    createServerClientMock.mockReturnValue(supabase);

    const response = await POST(
      makeRequest({
        winget_id: 'Microsoft.Edge',
        tenant_id: 'tenant-1',
        policy_type: 'ignore',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0].policy_type).toBe('ignore');
    expect(insertPayloads[0].pinned_version).toBeNull();
    expect(insertPayloads[0].deployment_config).toBeNull();
    expect(body.created).toBe(true);
  });

  it('creates a notify policy with just the policy type', async () => {
    const { supabase, insertPayloads } = createSupabaseMock({
      existing_policy: null,
    });
    createServerClientMock.mockReturnValue(supabase);

    const response = await POST(
      makeRequest({
        winget_id: 'Microsoft.Edge',
        tenant_id: 'tenant-1',
        policy_type: 'notify',
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(insertPayloads[0].policy_type).toBe('notify');
    expect(body.created).toBe(true);
  });
});
