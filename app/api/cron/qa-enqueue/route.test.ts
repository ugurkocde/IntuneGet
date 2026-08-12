import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createServerClientMock,
  createManifestClientMock,
  detectWingetChangesMock,
  resolveManifestMock,
  resolveDependenciesMock,
} = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  createManifestClientMock: vi.fn(() => ({ kind: 'manifest-client' })),
  detectWingetChangesMock: vi.fn(),
  resolveManifestMock: vi.fn(),
  resolveDependenciesMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/supabase', () => ({ createServerClient: createServerClientMock }));
vi.mock('@/lib/qa/winget-changes', () => ({ detectWingetChanges: detectWingetChangesMock }));
vi.mock('@/lib/winget-sync-resolution.mjs', () => ({
  createWingetManifestClient: createManifestClientMock,
  resolveWingetManifest: resolveManifestMock,
}));
vi.mock('@/lib/winget-dependencies', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/winget-dependencies')>();
  return {
    ...original,
    resolveWingetPackageDependencies: resolveDependenciesMock,
  };
});

import { GET } from './route';
import { prioritizeToolchainBackfill } from '@/lib/qa/toolchain-backfill';
import {
  buildQaPackageIdentity,
  canonicalQaJson,
  QA_PSADT_TOOLCHAIN,
  qaSha256,
} from '@/lib/qa/package-profile';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { WingetDependencyCompatibilityError } from '@/lib/winget-dependencies';

type QueryResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
  count?: number | null;
};

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'eq',
    'neq',
    'not',
    'in',
    'order',
    'limit',
    'or',
    'contains',
  ]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

function createSupabaseStub(options: {
  paused?: boolean;
  coverage?: number;
  coverageError?: string;
  supportedApps?: Array<Record<string, unknown>>;
  recipes?: Array<Record<string, unknown>>;
  candidates?: Array<Record<string, unknown>>;
  candidatePages?: Array<Array<Record<string, unknown>>>;
  demandBackfillApps?: string[];
  pollState?: Record<string, unknown>;
  packageResults?: Array<Record<string, unknown>>;
}) {
  const pollRunInserts: Array<Record<string, unknown>> = [];
  const pollRunUpdates: Array<Record<string, unknown>> = [];
  const cursorUpdates: Array<Record<string, unknown>> = [];
  const candidateInserts: Array<Record<string, unknown>> = [];
  const compatibilityBlocks: Array<Record<string, unknown>> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let candidatePageIndex = 0;

  const client = {
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name !== 'qa_missing_demand_backfill_ids') {
        throw new Error(`Unexpected RPC: ${name}`);
      }
      return Promise.resolve({
        data: (options.demandBackfillApps || []).map((winget_id) => ({ winget_id })),
        error: null,
      });
    }),
    from: vi.fn((table: string) => {
      if (table === 'qa_pipeline_control') {
        return query({
          data: {
            paused: options.paused === true,
            reason: options.paused ? 'Golden VM maintenance' : null,
            updated_at: '2026-08-11T12:00:00.000Z',
          },
          error: null,
        });
      }
      if (table === 'qa_poll_runs') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            pollRunInserts.push(row);
            return query({ data: { id: 'poll-run-1' }, error: null });
          }),
          update: vi.fn((row: Record<string, unknown>) => {
            pollRunUpdates.push(row);
            return query({ data: null, error: null });
          }),
        };
      }
      if (table === 'curated_apps') {
        return {
          select: vi.fn((_columns: string, selectOptions?: { head?: boolean }) =>
            query(
              selectOptions?.head
                ? {
                    data: null,
                    count: options.coverage ?? 14_062,
                    error: options.coverageError ? { message: options.coverageError } : null,
                  }
                : { data: options.supportedApps || [], error: null }
            )
          ),
        };
      }
      if (table === 'qa_winget_poll_state') {
        return {
          select: vi.fn(() => query({
            data: options.pollState || {
              head_sha: 'a'.repeat(40),
              last_checked_at: null,
              github_etag: null,
              github_rate_limited_until: null,
            },
            error: null,
          })),
          update: vi.fn((row: Record<string, unknown>) => {
            cursorUpdates.push(row);
            return query({ data: null, error: null });
          }),
        };
      }
      if (table === 'qa_recipes') {
        return query({ data: options.recipes || [], error: null });
      }
      if (table === 'upload_history') {
        return query({
          data: (options.supportedApps || []).map((app) => ({ winget_id: app.winget_id })),
          error: null,
        });
      }
      if (table === 'app_update_policies') {
        return query({ data: [], error: null });
      }
      if (table === 'qa_package_results') {
        return query({ data: options.packageResults || [], error: null });
      }
      if (table === 'qa_package_blocks') {
        return {
          upsert: vi.fn((row: Record<string, unknown>) => {
            compatibilityBlocks.push(row);
            return query({ data: null, error: null });
          }),
        };
      }
      if (table === 'qa_candidates') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            candidateInserts.push(row);
            return query({ data: { id: `candidate-${candidateInserts.length}` }, error: null });
          }),
          update: vi.fn(() => query({ data: null, error: null })),
          select: vi.fn(() =>
            query({
              data: options.candidatePages
                ? options.candidatePages[candidatePageIndex++] || []
                : options.candidates || [],
              error: null,
            })
          ),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
  return {
    client,
    pollRunInserts,
    pollRunUpdates,
    cursorUpdates,
    candidateInserts,
    compatibilityBlocks,
    rpcCalls,
  };
}

const CURRENT_PACKAGER_COMMIT = QA_PSADT_TOOLCHAIN.packagerCommit;

function profileCandidate(options: {
  id: string;
  wingetId: string;
  packagerCommit: string;
  enqueuedAt?: string;
  profileKind?: string;
  toolchainOverrides?: Record<string, unknown>;
  interactive?: boolean;
  status?: string;
  priority?: number;
}): Record<string, unknown> {
  const profileKind = options.profileKind || 'catalog-default';
  const version = '1.0.0';
  const architecture = 'x64';
  const installerSha256 = 'A'.repeat(64);
  const psadtConfig = options.interactive === false
    ? DEFAULT_PSADT_CONFIG
    : {
        ...DEFAULT_PSADT_CONFIG,
        deployMode: 'Auto' as const,
        progressDialog: {
          ...DEFAULT_PSADT_CONFIG.progressDialog,
          enabled: true,
          windowLocation: 'BottomRight' as const,
        },
      };
  const identity = buildQaPackageIdentity({
    profileKind: profileKind as 'catalog-default' | 'deployment-config',
    wingetId: options.wingetId,
    displayName: 'Example',
    publisher: 'Contoso',
    version,
    architecture,
    installerSha256,
    sourceInstallerType: 'nullsoft',
    silentArgs: '/S',
    uninstallCommand: '',
    installScope: 'machine',
    nestedInstallerType: '',
    nestedInstallerFiles: [],
    psadtConfig,
    detectionRules: [],
  });
  const canonicalJson = canonicalQaJson({
    ...identity.profile,
    toolchain: {
      ...QA_PSADT_TOOLCHAIN,
      packagerCommit: options.packagerCommit,
      ...(options.toolchainOverrides || {}),
    },
  });
  const packageProfileSha256 = qaSha256(canonicalJson);
  return {
    id: options.id,
    winget_id: options.wingetId,
    version,
    architecture,
    installer_sha256: installerSha256,
    enqueued_at: options.enqueuedAt || '2026-08-08T10:00:00.000Z',
    status: options.status || 'superseded',
    priority: options.priority ?? 1,
    package_profile_sha256: packageProfileSha256,
    test_config: {
      profileKind,
      packageProfileCanonicalJson: canonicalJson,
      packageProfileSha256,
    },
  };
}

function resolvedManifest() {
  return {
    status: 'resolved',
    version: '1.0.0',
    manifest: {
      InstallerType: 'nullsoft',
      Installers: [
        {
          Architecture: 'x64',
          InstallerUrl: 'https://example.com/setup.exe',
          InstallerSha256: 'A'.repeat(64),
          InstallerType: 'nullsoft',
        },
      ],
    },
  };
}

function cronRequest(): Request {
  return new Request('https://intuneget.com/api/cron/qa-enqueue', {
    headers: {
      authorization: 'Bearer test-cron-secret',
      'x-vercel-id': 'fra1::request-1',
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env.CRON_SECRET = 'test-cron-secret';
  detectWingetChangesMock.mockResolvedValue({
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    changedFiles: 0,
    changedPackageIds: [],
    initialized: false,
    etag: '"next"',
    rateLimitedUntil: null,
  });
  resolveDependenciesMock.mockResolvedValue([]);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
});

describe('GET /api/cron/qa-enqueue', () => {
  it('does not poll or mutate the queue while maintenance is paused', async () => {
    const { client, pollRunInserts, candidateInserts } = createSupabaseStub({ paused: true });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      paused: true,
      reason: 'maintenance_paused',
      maintenanceReason: 'Golden VM maintenance',
    });
    expect(pollRunInserts).toHaveLength(0);
    expect(candidateInserts).toHaveLength(0);
    expect(detectWingetChangesMock).not.toHaveBeenCalled();
  });

  it('persists a successful full-catalog poll and advances its cursor', async () => {
    const { client, pollRunInserts, pollRunUpdates, cursorUpdates, rpcCalls } =
      createSupabaseStub({});
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      runId: 'poll-run-1',
      coveredApps: 14_062,
      checked: 0,
      errorCount: 0,
    });
    expect(pollRunInserts).toEqual([expect.objectContaining({ request_id: 'fra1::request-1' })]);
    expect(cursorUpdates).toEqual([
      expect.objectContaining({
        head_sha: 'b'.repeat(40),
        github_etag: '"next"',
        github_rate_limited_until: null,
      }),
    ]);
    expect(rpcCalls).toEqual([
      { name: 'qa_missing_demand_backfill_ids', args: { p_limit: 3 } },
    ]);
    expect(pollRunUpdates).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        recipe_count: 14_062,
        changed_package_count: 0,
        supported_changed_count: 0,
        demand_backfill_requested_count: 0,
        demand_backfill_count: 0,
      }),
    ]);
  });

  it('persists GitHub rate-limit deferral and does not advance the change cursor', async () => {
    const resetAt = '2026-08-10T09:00:00.000Z';
    detectWingetChangesMock.mockResolvedValue({
      baseSha: 'a'.repeat(40),
      headSha: 'a'.repeat(40),
      changedFiles: 0,
      changedPackageIds: [],
      initialized: false,
      etag: '"current"',
      rateLimitedUntil: resetAt,
    });
    const { client, cursorUpdates, pollRunUpdates } = createSupabaseStub({
      pollState: {
        head_sha: 'a'.repeat(40),
        last_checked_at: null,
        github_etag: '"current"',
        github_rate_limited_until: null,
      },
    });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body).toMatchObject({
      success: false,
      checked: 0,
      errorCount: 1,
      errors: [`system: WinGet GitHub change feed paused until ${resetAt}`],
    });
    expect(cursorUpdates).toEqual([
      expect.objectContaining({ github_rate_limited_until: resetAt }),
    ]);
    expect(pollRunUpdates[0]).toMatchObject({ status: 'partial', error_count: 1 });
  });

  it('queues a demanded app missing latest-version catalog QA without a WinGet change', async () => {
    const { client, candidateInserts, pollRunUpdates } = createSupabaseStub({
      demandBackfillApps: ['Missing.App'],
      supportedApps: [
        {
          winget_id: 'Missing.App',
          name: 'Missing',
          publisher: 'Contoso',
          latest_version: '1.0.0',
        },
      ],
    });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockResolvedValue(resolvedManifest());

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      checked: 1,
      queued: 1,
      changedPackageCount: 0,
      demandBackfillRequestedCount: 1,
      demandBackfillCount: 1,
    });
    expect(candidateInserts).toHaveLength(1);
    expect(candidateInserts[0]).toMatchObject({
      winget_id: 'Missing.App',
      version: '1.0.0',
      status: 'queued',
      priority: 1,
      demand_source: 'managed',
      catalog_version_at_enqueue: '1.0.0',
      test_config: { profileKind: 'catalog-default' },
    });
    expect(pollRunUpdates[0]).toMatchObject({
      demand_backfill_requested_count: 1,
      demand_backfill_count: 1,
    });
  });

  it('persists a user-scope dependency compatibility block without degrading polling', async () => {
    const { client, candidateInserts, compatibilityBlocks, pollRunUpdates } =
      createSupabaseStub({
        demandBackfillApps: ['Blocked.App'],
        supportedApps: [
          {
            winget_id: 'Blocked.App',
            name: 'Blocked',
            publisher: 'Contoso',
            latest_version: '1.0.0',
          },
        ],
      });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockResolvedValue(resolvedManifest());
    resolveDependenciesMock.mockRejectedValueOnce(
      new WingetDependencyCompatibilityError(
        'Blocked.App declares machine-wide package dependencies that cannot be installed safely in user scope.'
      )
    );

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      checked: 1,
      queued: 0,
      unavailable: 1,
      errorCount: 0,
    });
    expect(candidateInserts).toHaveLength(0);
    expect(compatibilityBlocks).toEqual([
      expect.objectContaining({
        winget_id: 'Blocked.App',
        version: '1.0.0',
        architecture: 'x64',
        installer_sha256: 'A'.repeat(64),
        block_code: 'user_scope_machine_dependencies',
      }),
    ]);
    expect(pollRunUpdates[0]).toMatchObject({
      status: 'succeeded',
      unavailable_count: 1,
      error_count: 0,
    });
  });

  it('does not queue an app payload that already passed under another PSADT profile', async () => {
    const { client, candidateInserts } = createSupabaseStub({
      demandBackfillApps: ['Covered.App'],
      supportedApps: [
        {
          winget_id: 'Covered.App',
          name: 'Covered',
          publisher: 'Contoso',
          latest_version: '1.0.0',
        },
      ],
      packageResults: [
        {
          winget_id: 'Covered.App',
          tested_version: '1.0.0',
          architecture: 'x64',
          installer_sha256: 'A'.repeat(64),
          outcome: 'Passed',
          tested_at_utc: '2026-08-10T12:00:00.000Z',
          package_profile_sha256: 'B'.repeat(64),
        },
      ],
    });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockResolvedValue(resolvedManifest());

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ checked: 1, queued: 0, alreadyKnown: 1 });
    expect(candidateInserts).toHaveLength(1);
    expect(candidateInserts[0]).toMatchObject({
      winget_id: 'Covered.App',
      version: '1.0.0',
      status: 'passed',
    });
    expect(candidateInserts[0].package_profile_sha256).not.toBe('B'.repeat(64));
  });

  it('records a changed supported app failure and advances the completed comparison cursor', async () => {
    detectWingetChangesMock.mockResolvedValue({
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      changedFiles: 2,
      changedPackageIds: ['Example.App'],
      initialized: false,
    });
    const { client, pollRunUpdates, cursorUpdates } = createSupabaseStub({
      supportedApps: [{ winget_id: 'Example.App', name: 'Example', publisher: 'Contoso' }],
    });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockRejectedValue(new Error('GitHub returned HTTP 503'));

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body).toMatchObject({
      success: false,
      checked: 1,
      supportedChangedCount: 1,
      errorCount: 1,
      errors: ['Example.App: GitHub returned HTTP 503'],
    });
    expect(cursorUpdates).toEqual([
      expect.objectContaining({
        head_sha: 'b'.repeat(40),
        github_rate_limited_until: null,
      }),
    ]);
    expect(pollRunUpdates[0]).toMatchObject({ status: 'partial', error_count: 1 });
  });

  it('persists systemic catalog failures with a 500 response', async () => {
    const { client, pollRunUpdates } = createSupabaseStub({ coverageError: 'database unavailable' });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.errors).toEqual([
      'system: Could not count the supported QA catalog: database unavailable',
    ]);
    expect(pollRunUpdates[0]).toMatchObject({ status: 'failed', error_count: 1 });
  });

  it('queues a targeted terminal failure when its fix is in the current packager', async () => {
    const { client, candidateInserts } = createSupabaseStub({
      supportedApps: [{
        winget_id: 'Makeblock.xToolStudio',
        name: 'xTool Studio',
        publisher: 'Makeblock',
      }],
      candidates: [
        profileCandidate({
          id: 'old-candidate',
          wingetId: 'Makeblock.xToolStudio',
          packagerCommit: 'bafea79a8dde42be074c385c35b4887fb5833aa0',
          status: 'failed',
        }),
      ],
    });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockResolvedValue(resolvedManifest());

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      checked: 1,
      queued: 1,
      toolchainBackfillCount: 1,
      toolchainBackfillPagesScanned: 1,
    });
    expect(candidateInserts).toHaveLength(1);
    expect(candidateInserts[0]).toMatchObject({
      winget_id: 'Makeblock.xToolStudio',
      status: 'queued',
      test_level: 'psadt-package',
      test_config: {
        profileKind: 'catalog-default',
        silentArgs: '/S',
        psadtConfig: {
          reviewedUninstallArguments: [],
        },
      },
    });
    const canonical = JSON.parse(
      String((candidateInserts[0].test_config as Record<string, unknown>).packageProfileCanonicalJson)
    );
    expect(canonical.toolchain.packagerCommit).toBe(CURRENT_PACKAGER_COMMIT);
  });

  it('preserves an unrelated terminal failure across a packager release', async () => {
    const { client, candidateInserts } = createSupabaseStub({
      supportedApps: [{ winget_id: 'Example.App', name: 'Example', publisher: 'Contoso' }],
      candidates: [
        profileCandidate({
          id: 'unrelated-failed-candidate',
          wingetId: 'Example.App',
          packagerCommit: 'de49775e759b693b92db09bc99aa116f197c4850',
          status: 'failed',
        }),
      ],
    });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ checked: 0, queued: 0, toolchainBackfillCount: 0 });
    expect(candidateInserts).toHaveLength(0);
    expect(resolveManifestMock).not.toHaveBeenCalled();
  });

  it('preserves a passing catalog result from an explicitly compatible packager', async () => {
    const { client, candidateInserts } = createSupabaseStub({
      supportedApps: [{ winget_id: 'Example.App', name: 'Example', publisher: 'Contoso' }],
      candidates: [
        profileCandidate({
          id: 'compatible-passed-candidate',
          wingetId: 'Example.App',
          packagerCommit: 'de49775e759b693b92db09bc99aa116f197c4850',
          status: 'passed',
        }),
      ],
    });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ checked: 0, queued: 0, toolchainBackfillCount: 0 });
    expect(candidateInserts).toHaveLength(0);
    expect(resolveManifestMock).not.toHaveBeenCalled();
  });

  it('does not backfill an app that already has a current catalog profile', async () => {
    const { client, candidateInserts } = createSupabaseStub({
      supportedApps: [{ winget_id: 'Example.App', name: 'Example', publisher: 'Contoso' }],
      candidates: [
        profileCandidate({
          id: 'current-candidate',
          wingetId: 'Example.App',
          packagerCommit: CURRENT_PACKAGER_COMMIT,
          enqueuedAt: '2026-08-08T10:01:00.000Z',
        }),
        profileCandidate({
          id: 'old-candidate',
          wingetId: 'Example.App',
          packagerCommit: '1'.repeat(40),
        }),
      ],
    });
    createServerClientMock.mockReturnValue(client);

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ checked: 0, queued: 0, toolchainBackfillCount: 0 });
    expect(candidateInserts).toHaveLength(0);
    expect(resolveManifestMock).not.toHaveBeenCalled();
  });

  it('backfills a self-consistent Silent profile so every catalog QA run is interactive', async () => {
    const { client, candidateInserts } = createSupabaseStub({
      supportedApps: [{ winget_id: 'Example.App', name: 'Example', publisher: 'Contoso' }],
      candidates: [
        profileCandidate({
          id: 'silent-candidate',
          wingetId: 'Example.App',
          packagerCommit: CURRENT_PACKAGER_COMMIT,
          interactive: false,
        }),
      ],
    });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockResolvedValue(resolvedManifest());

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ checked: 1, queued: 1, toolchainBackfillCount: 1 });
    const canonical = JSON.parse(
      String((candidateInserts[0].test_config as Record<string, unknown>).packageProfileCanonicalJson)
    );
    expect(canonical.psadtConfig).toMatchObject({
      deployMode: 'Auto',
      progressDialog: { enabled: true },
    });
  });

  it('backfills a matching commit when another toolchain pin is stale', async () => {
    const { client, candidateInserts } = createSupabaseStub({
      supportedApps: [{ winget_id: 'Example.App', name: 'Example', publisher: 'Contoso' }],
      candidates: [
        profileCandidate({
          id: 'stale-template-candidate',
          wingetId: 'Example.App',
          packagerCommit: CURRENT_PACKAGER_COMMIT,
          toolchainOverrides: { templateSha256: 'B'.repeat(64) },
          status: 'passed',
        }),
      ],
    });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockResolvedValue(resolvedManifest());

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ checked: 1, queued: 1, toolchainBackfillCount: 1 });
    expect(candidateInserts[0]).toMatchObject({ winget_id: 'Example.App' });
  });

  it('uses only the newest catalog profile when deciding whether an app is stale', async () => {
    const { client, candidateInserts } = createSupabaseStub({
      supportedApps: [{ winget_id: 'Example.App', name: 'Example', publisher: 'Contoso' }],
      candidates: [
        profileCandidate({
          id: 'newest-stale-candidate',
          wingetId: 'Example.App',
          packagerCommit: '1'.repeat(40),
          enqueuedAt: '2026-08-08T10:01:00.000Z',
        }),
        profileCandidate({
          id: 'older-current-candidate',
          wingetId: 'Example.App',
          packagerCommit: CURRENT_PACKAGER_COMMIT,
        }),
      ],
    });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockResolvedValue(resolvedManifest());

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ checked: 1, queued: 1, toolchainBackfillCount: 1 });
    expect(candidateInserts[0]).toMatchObject({ winget_id: 'Example.App' });
  });

  it('continues keyset pagination until it finds a stale catalog profile', async () => {
    const firstPage = Array.from({ length: 1_000 }, (_, index) =>
      profileCandidate({
        id: `irrelevant-${String(1_000 - index).padStart(4, '0')}`,
        wingetId: `Irrelevant.App.${index}`,
        packagerCommit: '1'.repeat(40),
        enqueuedAt: '2026-08-08T10:00:00.000Z',
        profileKind: 'deployment-config',
      })
    );
    const { client, candidateInserts } = createSupabaseStub({
      supportedApps: [{ winget_id: 'Paged.App', name: 'Paged', publisher: 'Contoso' }],
      candidatePages: [
        firstPage,
        [
          profileCandidate({
            id: 'paged-old-candidate',
            wingetId: 'Paged.App',
            packagerCommit: '1'.repeat(40),
            enqueuedAt: '2026-08-08T09:59:59.000Z',
          }),
        ],
      ],
    });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockResolvedValue(resolvedManifest());

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      checked: 1,
      queued: 1,
      toolchainBackfillCount: 1,
      toolchainBackfillPagesScanned: 2,
    });
    expect(candidateInserts[0]).toMatchObject({ winget_id: 'Paged.App' });
  });

  it('does not let unsupported stale apps consume the backfill batch', async () => {
    const unsupportedPage = Array.from({ length: 1_000 }, (_, index) =>
      profileCandidate({
        id: `unsupported-${String(1_000 - index).padStart(4, '0')}`,
        wingetId: `Unsupported.App.${index}`,
        packagerCommit: '1'.repeat(40),
        enqueuedAt: '2026-08-08T10:00:00.000Z',
      })
    );
    const { client, candidateInserts } = createSupabaseStub({
      supportedApps: [
        { winget_id: 'Supported.App', name: 'Supported', publisher: 'Contoso' },
      ],
      candidatePages: [
        unsupportedPage,
        [
          profileCandidate({
            id: 'supported-old-candidate',
            wingetId: 'Supported.App',
            packagerCommit: '1'.repeat(40),
            enqueuedAt: '2026-08-08T09:59:59.000Z',
          }),
        ],
      ],
    });
    createServerClientMock.mockReturnValue(client);
    resolveManifestMock.mockResolvedValue(resolvedManifest());

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      checked: 1,
      queued: 1,
      toolchainBackfillCount: 1,
      toolchainBackfillPagesScanned: 2,
    });
    expect(candidateInserts).toHaveLength(1);
    expect(candidateInserts[0]).toMatchObject({ winget_id: 'Supported.App' });
  });

  it('prioritizes failed stale profiles before ordinary toolchain backfill', async () => {
    expect(prioritizeToolchainBackfill([
      {
        wingetId: 'Newest.App',
        status: 'superseded',
        priority: 1,
        enqueuedAt: '2026-08-08T10:04:00.000Z',
      },
      {
        wingetId: 'Failed.Low',
        status: 'failed',
        priority: 1,
        enqueuedAt: '2026-08-08T10:01:00.000Z',
      },
      {
        wingetId: 'Failed.High',
        status: 'failed',
        priority: 2,
        enqueuedAt: '2026-08-08T10:00:00.000Z',
      },
      {
        wingetId: 'Error.App',
        status: 'error',
        priority: 1,
        enqueuedAt: '2026-08-08T10:03:00.000Z',
      },
    ])).toEqual([
      'Failed.High',
      'Failed.Low',
      'Error.App',
      'Newest.App',
    ]);
  });
});
