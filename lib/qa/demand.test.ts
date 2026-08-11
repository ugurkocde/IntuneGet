import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureQaDemand, type QaDemandInput } from '@/lib/qa/demand';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

const { resolveWingetPackageDependenciesMock } = vi.hoisted(() => ({
  resolveWingetPackageDependenciesMock: vi.fn(),
}));

vi.mock('@/lib/winget-dependencies', () => ({
  resolveWingetPackageDependencies: resolveWingetPackageDependenciesMock,
}));

type QueryResult = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'contains', 'order', 'limit', 'update']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (
    onFulfilled?: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return builder;
}

function demandInput(): QaDemandInput {
  return {
    wingetId: 'Example.App',
    displayName: 'Example',
    publisher: 'Contoso',
    version: '1.2.3',
    architecture: 'x64',
    installerUrl: 'https://example.test/setup.exe',
    installerSha256: 'A'.repeat(64),
    installerType: 'nullsoft',
    silentSwitches: '/S',
    uninstallCommand: 'REGISTRY_UNINSTALL:Example:/S',
    installScope: 'machine',
    psadtConfig: JSON.stringify(DEFAULT_PSADT_CONFIG),
    detectionRules: '[]',
    priority: 1_000,
    demandSource: 'customer',
  };
}

describe('ensureQaDemand app-version evidence reuse', () => {
  beforeEach(() => {
    resolveWingetPackageDependenciesMock.mockReset();
    resolveWingetPackageDependenciesMock.mockResolvedValue([]);
  });

  it('persists dependency download metadata on a newly queued customer candidate', async () => {
    const dependency = {
      packageIdentifier: 'Microsoft.VCRedist.2015+.x64',
      version: '14.51.36247.0',
      architecture: 'x64' as const,
      installerUrl: 'https://download.visualstudio.microsoft.com/vc_redist.x64.exe',
      installerSha256: 'B'.repeat(64),
      installerType: 'burn' as const,
      silentArgs: '/quiet /norestart',
      successCodes: [-2147023258, 0, 1638, 3010],
      rebootCodes: [1641, 3010],
      fileName: 'Microsoft.VCRedist.2015+.x64-VC_redist.x64.exe',
      order: 1,
      depth: 1,
    };
    const input = demandInput();
    resolveWingetPackageDependenciesMock.mockResolvedValue([dependency]);
    const candidateInserts: Array<Record<string, unknown>> = [];
    let candidateCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'qa_package_results') {
          return { select: vi.fn(() => query({ data: null, error: null })) };
        }
        if (table === 'qa_candidates') {
          candidateCall++;
          if (candidateCall === 1) return query({ data: null, error: null });
          return {
            insert: vi.fn((row: Record<string, unknown>) => {
              candidateInserts.push(row);
              return query({ data: { id: 'candidate-1', status: 'queued' }, error: null });
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ensureQaDemand(client as never, input);

    expect(result).toMatchObject({ state: 'waiting', candidateId: 'candidate-1' });
    expect(resolveWingetPackageDependenciesMock).toHaveBeenCalledWith({
      wingetId: input.wingetId,
      version: input.version,
      architecture: input.architecture,
      installerSha256: input.installerSha256,
      installScope: input.installScope,
    });
    expect(candidateInserts).toHaveLength(1);
    expect(candidateInserts[0]).toEqual(expect.objectContaining({
      test_config: expect.objectContaining({ packageDependencies: [dependency] }),
    }));
    expect((candidateInserts[0].test_config as Record<string, unknown>).psadtConfig).toMatchObject({
      deployMode: 'Auto',
      progressDialog: {
        enabled: true,
        statusMessage: 'IntuneGet is validating this application package.',
        windowLocation: 'BottomRight',
      },
    });
  });

  it('refreshes dependency metadata when reactivating an exact candidate', async () => {
    const dependency = {
      packageIdentifier: 'Microsoft.VCRedist.2015+.x64',
      version: '14.51.36247.0',
      architecture: 'x64' as const,
      installerUrl: 'https://download.visualstudio.microsoft.com/vc_redist.x64.exe',
      installerSha256: 'B'.repeat(64),
      installerType: 'burn' as const,
      silentArgs: '/quiet /norestart',
      successCodes: [-2147023258, 0, 1638, 3010],
      rebootCodes: [1641, 3010],
      fileName: 'Microsoft.VCRedist.2015+.x64-VC_redist.x64.exe',
      order: 1,
      depth: 1,
    };
    const input = demandInput();
    resolveWingetPackageDependenciesMock.mockResolvedValue([dependency]);
    const updates: Array<Record<string, unknown>> = [];
    let candidateCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'qa_package_results') {
          return { select: vi.fn(() => query({ data: null, error: null })) };
        }
        if (table !== 'qa_candidates') throw new Error(`Unexpected table: ${table}`);
        candidateCall++;
        if (candidateCall === 1) return query({ data: null, error: null });
        if (candidateCall === 2) {
          return {
            insert: vi.fn(() => query({
              data: null,
              error: { message: 'duplicate', code: '23505' },
            })),
          };
        }
        if (candidateCall === 3) return query({ data: null, error: null });
        if (candidateCall === 4) {
          return {
            select: vi.fn(() => query({
              data: { id: 'candidate-1', status: 'superseded', priority: 500 },
              error: null,
            })),
          };
        }
        return {
          update: vi.fn((values: Record<string, unknown>) => {
            updates.push(values);
            return query({ data: null, error: null });
          }),
        };
      }),
    };

    const result = await ensureQaDemand(client as never, input);

    expect(result).toMatchObject({ state: 'waiting', candidateId: 'candidate-1' });
    expect(updates).toEqual([
      expect.objectContaining({
        status: 'queued',
        priority: 1_000,
        test_config: expect.objectContaining({ packageDependencies: [dependency] }),
      }),
    ]);
  });

  it('joins the active payload test when a concurrent insert wins the race', async () => {
    const input = demandInput();
    let candidateCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'qa_package_results') {
          return { select: vi.fn(() => query({ data: null, error: null })) };
        }
        if (table !== 'qa_candidates') throw new Error(`Unexpected table: ${table}`);
        candidateCall++;
        if (candidateCall === 1) return query({ data: null, error: null });
        if (candidateCall === 2) {
          return {
            insert: vi.fn(() => query({
              data: null,
              error: { message: 'duplicate active payload', code: '23505' },
            })),
          };
        }
        return {
          select: vi.fn(() => query({
            data: { id: 'candidate-concurrent', status: 'queued', priority: 2_000 },
            error: null,
          })),
        };
      }),
    };

    const result = await ensureQaDemand(client as never, input);

    expect(result).toMatchObject({
      state: 'waiting',
      candidateId: 'candidate-concurrent',
    });
  });

  it('reuses a prior pass for the same app payload regardless of PSADT configuration', async () => {
    const input = demandInput();
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'qa_package_results') {
          return {
            select: vi.fn(() => query({
              data: { package_profile_sha256: 'B'.repeat(64) },
              error: null,
            })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ensureQaDemand(client as never, input);

    expect(result.state).toBe('passed');
    expect(result.candidateId).toBeNull();
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it('attaches another upload configuration to an active app-version test', async () => {
    const input = demandInput();
    const priorityUpdate = query({ data: null, error: null });
    let candidateCall = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'qa_package_results') {
          return { select: vi.fn(() => query({ data: null, error: null })) };
        }
        if (table !== 'qa_candidates') throw new Error(`Unexpected table: ${table}`);
        candidateCall++;
        if (candidateCall === 1) {
          return query({
            data: { id: 'candidate-active', status: 'queued', priority: 10 },
            error: null,
          });
        }
        return priorityUpdate;
      }),
    };

    const result = await ensureQaDemand(client as never, input);

    expect(result).toMatchObject({ state: 'waiting', candidateId: 'candidate-active' });
    expect(priorityUpdate.update).toHaveBeenCalledWith(expect.objectContaining({
      priority: 1_000,
      demand_source: 'customer',
    }));
  });

  it('fails closed before creating QA state when dependency resolution fails', async () => {
    const client = { from: vi.fn() };
    resolveWingetPackageDependenciesMock.mockRejectedValue(
      new Error('Unreviewed package dependency')
    );

    await expect(ensureQaDemand(client as never, demandInput())).rejects.toThrow(
      'Unreviewed package dependency'
    );
    expect(client.from).not.toHaveBeenCalled();
  });
});
