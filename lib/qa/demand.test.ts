import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureQaDemand, type QaDemandInput } from '@/lib/qa/demand';
import {
  buildQaPackageIdentityFromWorkflowInput,
  canonicalQaJson,
  qaSha256,
} from '@/lib/qa/package-profile';
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
  for (const method of ['select', 'eq', 'in', 'contains', 'order', 'limit']) {
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

function priorCandidate(input: QaDemandInput, packagerCommit: string) {
  const identity = buildQaPackageIdentityFromWorkflowInput(input);
  const current = JSON.parse(identity.canonicalJson) as Record<string, unknown> & {
    toolchain: Record<string, unknown>;
  };
  const canonical = canonicalQaJson({
    ...current,
    toolchain: { ...current.toolchain, packagerCommit },
  });
  return {
    winget_id: input.wingetId,
    version: input.version,
    architecture: input.architecture,
    installer_sha256: input.installerSha256,
    package_profile_sha256: qaSha256(canonical),
    test_config: {
      profileKind: 'deployment-config',
      packageProfileCanonicalJson: canonical,
      packageProfileSha256: qaSha256(canonical),
    },
    finished_at: '2026-08-10T10:00:00.000Z',
  };
}

describe('ensureQaDemand compatible evidence reuse', () => {
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
          if (candidateCall === 1) return query({ data: [], error: null });
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
        if (candidateCall === 1) return query({ data: [], error: null });
        if (candidateCall === 2) {
          return {
            insert: vi.fn(() => query({
              data: null,
              error: { message: 'duplicate', code: '23505' },
            })),
          };
        }
        if (candidateCall === 3) {
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

  it('aliases a behavior-identical prior pass instead of queueing the app again', async () => {
    const input = demandInput();
    const prior = priorCandidate(
      input,
      '66448ea49841c2c9f3ebf56e455ce8797e2b2abb'
    );
    const aliasInserts: Array<Record<string, unknown>> = [];
    let packageResultRead = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'qa_candidates') {
          return query({ data: [prior], error: null });
        }
        if (table === 'qa_package_results') {
          return {
            select: vi.fn(() => {
              packageResultRead++;
              if (packageResultRead === 1) return query({ data: null, error: null });
              return query({
                data: [{
                  package_profile_sha256: prior.package_profile_sha256,
                  winget_id: input.wingetId,
                  tested_version: input.version,
                  architecture: 'x64',
                  installer_sha256: input.installerSha256,
                  outcome: 'Passed',
                  tested_at_utc: '2026-08-10T10:10:00.000Z',
                  psadt_version: '4.1.8',
                  psadt_template_sha256: 'B'.repeat(64),
                  psadt_config_sha256: 'C'.repeat(64),
                  detection_rules_sha256: 'D'.repeat(64),
                  packager_commit: '66448ea49841c2c9f3ebf56e455ce8797e2b2abb',
                  package_content_sha256: 'E'.repeat(64),
                  github_run_id: '123',
                  github_run_url: 'https://github.test/run/123',
                }],
                error: null,
              });
            }),
            insert: vi.fn((row: Record<string, unknown>) => {
              aliasInserts.push(row);
              return query({ data: null, error: null });
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ensureQaDemand(client as never, input);

    expect(result.state).toBe('passed');
    expect(result.candidateId).toBeNull();
    expect(aliasInserts).toEqual([
      expect.objectContaining({
        package_profile_sha256: result.identity.executionProfileSha256,
        packager_commit: '66448ea49841c2c9f3ebf56e455ce8797e2b2abb',
        github_run_id: '123',
      }),
    ]);
  });

  it('uses an exact current result without scanning historical candidates', async () => {
    const input = demandInput();
    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'qa_package_results') throw new Error(`Unexpected table: ${table}`);
        return {
          select: vi.fn(() => query({ data: { outcome: 'Passed' }, error: null })),
        };
      }),
    };

    const result = await ensureQaDemand(client as never, input);

    expect(result.state).toBe('passed');
    expect(client.from).toHaveBeenCalledTimes(1);
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
