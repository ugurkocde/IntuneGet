import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createServerClientMock, dispatchQaCandidateMock, getGitHubActionsHealthMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  dispatchQaCandidateMock: vi.fn(),
  getGitHubActionsHealthMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ createServerClient: createServerClientMock }));
vi.mock('@/lib/qa/dispatch', () => ({ dispatchQaCandidate: dispatchQaCandidateMock }));
vi.mock('@/lib/qa/github-actions-health', () => ({
  getGitHubActionsHealth: getGitHubActionsHealthMock,
}));

import { GET, maxDuration } from './route';
import { InstallerPreflightError } from '@/lib/installer-preflight';
import { buildQaPackageIdentity } from '@/lib/qa/package-profile';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

type QueryResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

const CATALOG_ID = '00000000-0000-4000-8000-000000000001';
const DEPLOYMENT_ID = '00000000-0000-4000-8000-000000000002';

function testUuid(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ['eq', 'in', 'order', 'limit', 'or', 'select']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

function candidate(profileKind: 'catalog-default' | 'deployment-config') {
  const profileInput = {
    profileKind,
    wingetId: 'Example.App',
    displayName: 'Example',
    publisher: 'Contoso',
    version: '1.2.3',
    architecture: 'x64',
    installerSha256: 'A'.repeat(64),
    sourceInstallerType: 'nullsoft',
    silentArgs: '/S',
    uninstallCommand: 'REGISTRY_UNINSTALL:Example:/S',
    installScope: 'machine',
    nestedInstallerType: '',
    nestedInstallerFiles: [],
    psadtConfig: DEFAULT_PSADT_CONFIG,
    detectionRules: [],
  };
  const identity = buildQaPackageIdentity(profileInput);
  return {
    id: profileKind === 'deployment-config' ? DEPLOYMENT_ID : CATALOG_ID,
    winget_id: profileInput.wingetId,
    version: profileInput.version,
    architecture: profileInput.architecture,
    installer_sha256: profileInput.installerSha256,
    package_profile_sha256: identity.packageProfileSha256,
    test_config: {
      profileKind,
      packageProfileCanonicalJson: identity.canonicalJson,
      packageProfileSha256: identity.packageProfileSha256,
    },
    priority: profileKind === 'deployment-config' ? 1000 : 0,
    enqueued_at: '2026-08-08T12:00:00.000Z',
    attempts: 0,
    status: 'queued',
    test_level: 'psadt-package',
  };
}

function createSupabaseStub(
  queued: Array<ReturnType<typeof candidate>>,
  additionalPages: Array<Array<ReturnType<typeof candidate>>> = [],
  options: {
    paused?: boolean;
    requiredPackagerCommit?: string | null;
    claimNullIds?: string[];
    claimErrorById?: Record<string, { message: string; code?: string }>;
    supersedeError?: { message: string; code?: string };
  } = {}
) {
  const supersededIds: string[] = [];
  const claimedIds: string[] = [];
  const claimAttemptIds: string[] = [];
  const rollbackIds: string[] = [];
  const rollbackPayloads: Array<Record<string, unknown>> = [];
  const terminalErrorIds: string[] = [];
  const terminalErrorPayloads: Array<Record<string, unknown>> = [];
  const orFilters: string[] = [];
  const supersedePayloads: Array<Record<string, unknown>> = [];
  const queuePages = [queued, ...additionalPages];
  const allQueued = queuePages.flat();
  let queuePageIndex = 0;

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'qa_pipeline_control') {
        return query({
          data: {
            paused: options.paused === true,
            reason: options.paused ? 'Golden VM maintenance' : null,
            required_packager_commit: options.requiredPackagerCommit ?? null,
            scheduler_packager_commit: null,
            scheduler_seen_at: null,
            updated_at: '2026-08-11T12:00:00.000Z',
          },
          error: null,
        });
      }
      if (table !== 'qa_candidates') throw new Error(`Unexpected table: ${table}`);
      return {
        select: vi.fn((columns: string) => {
          if (columns === '*') return query({ data: [], error: null });
          if (columns === 'id') return query({ data: [], error: null });
          if (columns.includes('package_profile_sha256')) {
            const data = queuePages[queuePageIndex++] || [];
            const builder = query({ data, error: null }) as Record<string, unknown>;
            builder.or = vi.fn((filter: string) => {
              orFilters.push(filter);
              return builder;
            });
            return builder;
          }
          throw new Error(`Unexpected select: ${columns}`);
        }),
        update: vi.fn((values: Record<string, unknown>) => {
          if (values.status === 'superseded') {
            supersedePayloads.push(values);
            let ids: string[] = [];
            const builder = query({ data: [], error: null }) as Record<string, unknown>;
            builder.in = vi.fn((_column: string, value: string[]) => {
              ids = value;
              return builder;
            });
            builder.select = vi.fn(() => {
              if (options.supersedeError) {
                return query({ data: null, error: options.supersedeError });
              }
              supersededIds.push(...ids);
              return query({ data: ids.map((id) => ({ id })), error: null });
            });
            return builder;
          }

          if (values.status === 'dispatched') {
            let id = '';
            const builder = query({ data: null, error: null }) as Record<string, unknown>;
            builder.eq = vi.fn((column: string, value: string) => {
              if (column === 'id') id = value;
              return builder;
            });
            builder.maybeSingle = vi.fn(async () => {
              claimAttemptIds.push(id);
              const claimError = options.claimErrorById?.[id];
              if (claimError) return { data: null, error: claimError };
              if (options.claimNullIds?.includes(id)) return { data: null, error: null };
              const row = allQueued.find((entry) => entry.id === id) || null;
              if (row) claimedIds.push(id);
              return { data: row ? { ...row, ...values } : null, error: null };
            });
            return builder;
          }

          if (values.status === 'queued') {
            rollbackPayloads.push(values);
            const builder = query({ data: null, error: null }) as Record<string, unknown>;
            builder.eq = vi.fn((column: string, value: string) => {
              if (column === 'id') rollbackIds.push(value);
              return builder;
            });
            return builder;
          }

          if (values.status === 'error') {
            terminalErrorPayloads.push(values);
            const builder = query({ data: null, error: null }) as Record<string, unknown>;
            builder.eq = vi.fn((column: string, value: string) => {
              if (column === 'id') terminalErrorIds.push(value);
              return builder;
            });
            return builder;
          }

          throw new Error(`Unexpected update: ${JSON.stringify(values)}`);
        }),
      };
    }),
  };
  return {
    client,
    supersededIds,
    supersedePayloads,
    claimedIds,
    claimAttemptIds,
    rollbackIds,
    rollbackPayloads,
    terminalErrorIds,
    terminalErrorPayloads,
    orFilters,
  };
}

function cronRequest(): Request {
  return new Request('https://intuneget.com/api/cron/qa-dispatch', {
    headers: { authorization: 'Bearer test-cron-secret' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-cron-secret';
  dispatchQaCandidateMock.mockResolvedValue(undefined);
  getGitHubActionsHealthMock.mockResolvedValue({ operational: true, status: 'operational' });
});

it('allows large installer preflight the same bounded window as customer packaging', () => {
  expect(maxDuration).toBe(300);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('GET /api/cron/qa-dispatch', () => {
  it('does not reconcile or dispatch candidates while maintenance is paused', async () => {
    const row = candidate('catalog-default');
    const { client, claimedIds } = createSupabaseStub([row], [], { paused: true });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      dispatched: false,
      reason: 'maintenance_paused',
      maintenanceReason: 'Golden VM maintenance',
    });
    expect(claimedIds).toEqual([]);
    expect(dispatchQaCandidateMock).not.toHaveBeenCalled();
  });

  it('does not reconcile or dispatch when production serves the wrong packager release', async () => {
    const row = candidate('catalog-default');
    const { client, claimedIds } = createSupabaseStub([row], [], {
      requiredPackagerCommit: 'F'.repeat(40),
    });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body).toMatchObject({
      success: true,
      dispatched: false,
      reason: 'packager_release_pending',
    });
    expect(claimedIds).toEqual([]);
    expect(dispatchQaCandidateMock).not.toHaveBeenCalled();
  });

  it('does not reconcile or dispatch while GitHub Actions is unavailable', async () => {
    const row = candidate('catalog-default');
    const { client, claimedIds } = createSupabaseStub([row]);
    createServerClientMock.mockReturnValue(client);
    getGitHubActionsHealthMock.mockResolvedValue({
      operational: false,
      status: 'major_outage',
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      dispatched: false,
      reason: 'github_actions_unavailable',
      githubActionsStatus: 'major_outage',
    });
    expect(claimedIds).toEqual([]);
    expect(dispatchQaCandidateMock).not.toHaveBeenCalled();
  });

  it('supersedes an invalid row and dispatches the valid row behind it', async () => {
    const invalid = candidate('catalog-default');
    invalid.id = testUuid(10);
    invalid.priority = 1000;
    invalid.test_config.profileKind = 'legacy' as never;
    const valid = candidate('catalog-default');
    const { client, supersededIds, supersedePayloads, claimedIds } = createSupabaseStub([
      invalid,
      valid,
    ]);
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      dispatched: true,
      candidateId: valid.id,
      scanned: 2,
      superseded: 1,
    });
    expect(supersededIds).toEqual([invalid.id]);
    expect(supersedePayloads).toEqual([
      expect.objectContaining({
        status: 'superseded',
        finished_at: expect.any(String),
        failure_summary: 'Superseded before dispatch: wrong-profile-kind.',
        updated_at: expect.any(String),
      }),
    ]);
    expect(claimedIds).toEqual([valid.id]);
    expect(dispatchQaCandidateMock).toHaveBeenCalledOnce();
  });

  it('dispatches a current deployment-config profile', async () => {
    const deploymentConfig = candidate('deployment-config');
    const { client, supersededIds, claimedIds } = createSupabaseStub([deploymentConfig]);
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body).toMatchObject({ dispatched: true, candidateId: deploymentConfig.id });
    expect(supersededIds).toEqual([]);
    expect(claimedIds).toEqual([deploymentConfig.id]);
  });

  it('supersedes an ARM64 payload instead of sending it to the x64 VM', async () => {
    const arm64 = candidate('deployment-config');
    arm64.architecture = 'arm64';
    const { client, supersededIds, supersedePayloads, claimedIds } =
      createSupabaseStub([arm64]);
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body).toMatchObject({ dispatched: false, superseded: 1 });
    expect(supersededIds).toEqual([arm64.id]);
    expect(supersedePayloads).toEqual([
      expect.objectContaining({
        failure_summary:
          'Superseded before dispatch: runner-architecture-unsupported.',
      }),
    ]);
    expect(claimedIds).toEqual([]);
    expect(dispatchQaCandidateMock).not.toHaveBeenCalled();
  });

  it('supersedes a row whose canonical profile does not match its installer', async () => {
    const invalid = candidate('catalog-default');
    invalid.installer_sha256 = 'B'.repeat(64);
    const { client, supersededIds, claimedIds } = createSupabaseStub([invalid]);
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body).toMatchObject({ dispatched: false, reason: 'queue_empty', superseded: 1 });
    expect(supersededIds).toEqual([invalid.id]);
    expect(claimedIds).toEqual([]);
    expect(dispatchQaCandidateMock).not.toHaveBeenCalled();
  });

  it('uses keyset pages to reach a valid row behind a full stale page', async () => {
    const stalePage = Array.from({ length: 100 }, (_, index) => {
      const row = candidate('catalog-default');
      row.id = testUuid(100 + index);
      row.test_config.profileKind = 'legacy' as never;
      return row;
    });
    const valid = candidate('catalog-default');
    valid.id = testUuid(999);
    const { client, supersededIds, claimedIds, orFilters } = createSupabaseStub(
      stalePage,
      [[valid]]
    );
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body).toMatchObject({
      dispatched: true,
      candidateId: valid.id,
      scanned: 101,
      superseded: 100,
    });
    expect(supersededIds).toHaveLength(100);
    expect(claimedIds).toEqual([valid.id]);
    expect(orFilters).toEqual([
      `priority.lt.0,and(priority.eq.0,enqueued_at.gt."2026-08-08T12:00:00.000Z"),and(priority.eq.0,enqueued_at.eq."2026-08-08T12:00:00.000Z",id.gt."${testUuid(199)}")`,
    ]);
  });

  it('stops when a compare-and-set claim is lost instead of claiming another row', async () => {
    const first = candidate('catalog-default');
    first.id = testUuid(20);
    const second = candidate('catalog-default');
    second.id = testUuid(21);
    const { client, claimAttemptIds, claimedIds } = createSupabaseStub([first, second], [], {
      claimNullIds: [first.id],
    });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body).toMatchObject({ dispatched: false, reason: 'claim_lost' });
    expect(claimAttemptIds).toEqual([first.id]);
    expect(claimedIds).toEqual([]);
    expect(dispatchQaCandidateMock).not.toHaveBeenCalled();
  });

  it('treats the single-active unique-index race as a lost claim', async () => {
    const row = candidate('catalog-default');
    const { client, claimAttemptIds } = createSupabaseStub([row], [], {
      claimErrorById: {
        [row.id]: { message: 'duplicate key', code: '23505' },
      },
    });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body).toMatchObject({ dispatched: false, reason: 'claim_lost' });
    expect(claimAttemptIds).toEqual([row.id]);
    expect(dispatchQaCandidateMock).not.toHaveBeenCalled();
  });

  it('supersedes invalid queue metadata without blocking a valid row', async () => {
    const invalid = candidate('catalog-default');
    invalid.id = testUuid(30);
    invalid.priority = Number.NaN;
    const valid = candidate('catalog-default');
    valid.id = testUuid(31);
    const { client, supersededIds, claimedIds } = createSupabaseStub([invalid, valid]);
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body).toMatchObject({ dispatched: true, candidateId: valid.id, superseded: 1 });
    expect(supersededIds).toEqual([invalid.id]);
    expect(claimedIds).toEqual([valid.id]);
  });

  it('rolls a claim back to queued when workflow dispatch fails', async () => {
    const row = candidate('catalog-default');
    const { client, rollbackIds } = createSupabaseStub([row]);
    createServerClientMock.mockReturnValue(client);
    dispatchQaCandidateMock.mockRejectedValueOnce(new Error('GitHub unavailable'));

    await expect(GET(cronRequest())).rejects.toThrow('GitHub unavailable');

    expect(rollbackIds).toEqual([row.id]);
  });

  it('defers a retryable installer preflight and dispatches the next candidate', async () => {
    const unavailable = candidate('catalog-default');
    unavailable.id = testUuid(50);
    const valid = candidate('catalog-default');
    valid.id = testUuid(51);
    const { client, claimedIds, rollbackIds, rollbackPayloads } = createSupabaseStub([
      unavailable,
      valid,
    ]);
    createServerClientMock.mockReturnValue(client);
    dispatchQaCandidateMock
      .mockRejectedValueOnce(new InstallerPreflightError(
        'PREFLIGHT_UNAVAILABLE',
        'Installer download returned HTTP 403',
        true,
      ))
      .mockResolvedValueOnce(undefined);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ dispatched: true, candidateId: valid.id });
    expect(claimedIds).toEqual([unavailable.id, valid.id]);
    expect(rollbackIds).toEqual([unavailable.id]);
    expect(rollbackPayloads).toContainEqual(expect.objectContaining({
      status: 'queued',
      attempts: 1,
      enqueued_at: expect.any(String),
    }));
  });

  it('terminates an exhausted installer preflight retry and continues dispatching', async () => {
    const unavailable = candidate('catalog-default');
    unavailable.id = testUuid(52);
    unavailable.attempts = 1;
    const valid = candidate('catalog-default');
    valid.id = testUuid(53);
    const { client, claimedIds, terminalErrorIds, terminalErrorPayloads } = createSupabaseStub([
      unavailable,
      valid,
    ]);
    createServerClientMock.mockReturnValue(client);
    dispatchQaCandidateMock
      .mockRejectedValueOnce(new InstallerPreflightError(
        'PREFLIGHT_UNAVAILABLE',
        'Installer download returned HTTP 403',
        true,
      ))
      .mockResolvedValueOnce(undefined);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ dispatched: true, candidateId: valid.id });
    expect(claimedIds).toEqual([unavailable.id, valid.id]);
    expect(terminalErrorIds).toEqual([unavailable.id]);
    expect(terminalErrorPayloads).toContainEqual(expect.objectContaining({
      status: 'error',
      attempts: 2,
      finished_at: expect.any(String),
    }));
  });

  it('supersedes an installer quarantined by the shared customer preflight', async () => {
    const row = candidate('catalog-default');
    const { client, supersededIds, rollbackIds } = createSupabaseStub([row]);
    createServerClientMock.mockReturnValue(client);
    dispatchQaCandidateMock.mockRejectedValueOnce(new InstallerPreflightError(
      'HASH_MISMATCH',
      'The publisher currently serves different bytes for this version.',
      false,
      'B'.repeat(64),
    ));

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      dispatched: false,
      reason: 'installer_quarantined',
      candidateId: row.id,
      code: 'HASH_MISMATCH',
      superseded: 1,
    });
    expect(supersededIds).toEqual([row.id]);
    expect(rollbackIds).toEqual([]);
  });

  it('dispatches the next candidate after quarantining a deterministic bad tuple', async () => {
    const quarantined = candidate('catalog-default');
    quarantined.id = testUuid(40);
    const valid = candidate('catalog-default');
    valid.id = testUuid(41);
    const { client, supersededIds, claimedIds } = createSupabaseStub([
      quarantined,
      valid,
    ]);
    createServerClientMock.mockReturnValue(client);
    dispatchQaCandidateMock
      .mockRejectedValueOnce(new InstallerPreflightError(
        'MANIFEST_CHANGED',
        'The exact tuple no longer exists in the trusted manifest.',
        false,
      ))
      .mockResolvedValueOnce(undefined);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      dispatched: true,
      candidateId: valid.id,
      superseded: 1,
    });
    expect(supersededIds).toEqual([quarantined.id]);
    expect(claimedIds).toEqual([quarantined.id, valid.id]);
  });

  it('does not claim anything when superseding an invalid profile fails', async () => {
    const invalid = candidate('catalog-default');
    invalid.test_config.profileKind = 'legacy' as never;
    const { client, claimAttemptIds } = createSupabaseStub([invalid], [], {
      supersedeError: { message: 'database unavailable' },
    });
    createServerClientMock.mockReturnValue(client);

    await expect(GET(cronRequest())).rejects.toMatchObject({
      message: 'database unavailable',
    });
    expect(claimAttemptIds).toEqual([]);
  });
});
