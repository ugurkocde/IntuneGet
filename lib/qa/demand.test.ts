import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureQaDemand, type QaDemandInput } from '@/lib/qa/demand';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { WingetDependencyCompatibilityError } from '@/lib/winget-dependencies';

const {
  resolveWingetPackageDependenciesMock,
  getPackageCompatibilityBlockMock,
  getPackageEligibilityBlocksMock,
} = vi.hoisted(() => ({
  resolveWingetPackageDependenciesMock: vi.fn(),
  getPackageCompatibilityBlockMock: vi.fn(),
  getPackageEligibilityBlocksMock: vi.fn(),
}));

vi.mock('@/lib/winget-dependencies', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/winget-dependencies')>();
  return {
    ...original,
    resolveWingetPackageDependencies: resolveWingetPackageDependenciesMock,
  };
});

vi.mock('@/lib/package-eligibility', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/package-eligibility')>();
  return {
    ...original,
    getPackageCompatibilityBlock: getPackageCompatibilityBlockMock,
    getPackageEligibilityBlocks: getPackageEligibilityBlocksMock,
  };
});

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
    getPackageEligibilityBlocksMock.mockReset();
    getPackageEligibilityBlocksMock.mockResolvedValue([]);
    getPackageCompatibilityBlockMock.mockReset();
    getPackageCompatibilityBlockMock.mockResolvedValue(null);
  });

  it.each([
    ['Example.App', 'vendor_retired'],
    ['Wondershare.Filmora', 'unsupported_managed_install'],
    ['GlassWire.GlassWire', 'unsupported_managed_uninstall'],
    ['Wargaming.GameCenter', 'unsupported_managed_uninstall'],
    ['Microsoft.VCLibs.14', 'unsupported_managed_uninstall'],
    ['Microsoft.VCLibs.Desktop.14', 'unsupported_managed_uninstall'],
  ])('does not queue or resolve dependencies for blocked %s', async (wingetId, code) => {
    getPackageEligibilityBlocksMock.mockResolvedValue([
      { wingetId, code },
    ]);
    const client = { from: vi.fn() };

    const result = await ensureQaDemand(client as never, { ...demandInput(), wingetId });

    expect(result).toMatchObject({
      state: 'failed',
      candidateId: null,
      failureSummary: 'This app is not available for automated deployment.',
    });
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('fails closed before queueing an ARM64 payload on the x64 QA runner', async () => {
    const client = { from: vi.fn() };
    const result = await ensureQaDemand(client as never, {
      ...demandInput(),
      architecture: 'arm64',
    });

    expect(result).toMatchObject({
      state: 'failed',
      candidateId: null,
      failureSummary: 'This app is not currently available for deployment.',
    });
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(getPackageEligibilityBlocksMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['expired_signing_certificate', 'failed_managed_lifecycle', 'unverified_file_reputation'])(
    'blocks an exact %s tuple before resolving dependencies', async (code) => {
    getPackageCompatibilityBlockMock.mockResolvedValue({
      wingetId: 'r12f.DivoomGateway',
      version: '0.1.42.0',
      architecture: 'x64',
      installerSha256: 'A'.repeat(64),
      code,
      detail: 'The signing certificate is expired.',
    });
    const client = { from: vi.fn() };

    const result = await ensureQaDemand(client as never, {
      ...demandInput(),
      wingetId: 'r12f.DivoomGateway',
      version: '0.1.42.0',
    });

    expect(result).toMatchObject({
      state: 'failed',
      candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, {
      wingetId: 'r12f.DivoomGateway',
      version: '0.1.42.0',
      architecture: 'x64',
      installerSha256: 'A'.repeat(64),
    });
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the failed Copilot profile before normalization or queue insertion', async () => {
    const tuple = {
      wingetId: 'Microsoft.365Copilot', version: '19.2609.33020.0',
      architecture: 'x64' as const,
      installerSha256: '7B2A6D88E87F068E8775D1DE267EE932914F430BFA054A2012DEC43FA279E61A',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Reviewed compatibility quarantine.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'exe', installScope: 'user',
      silentSwitches: '--quiet --start -p',
      uninstallCommand: 'REGISTRY_UNINSTALL:Microsoft 365 Copilot',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns a blocked normalized profile for Twinkstar without creating a queue row', async () => {
    const tuple = {
      wingetId: 'Twinkstar.TwinkstarBrowser', version: '11.4.1000.2609',
      architecture: 'x64' as const,
      installerSha256: '3671D4C0693240501854274692724B9A98C35B1E869066CF40985F43D4738668',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registration remained.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope: 'machine',
      silentSwitches: '-silent', uninstallCommand: 'REGISTRY_UNINSTALL:Twinkstar',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the exact failed SSIS profile before dependency resolution or queue insertion', async () => {
    const tuple = {
      wingetId: 'Microsoft.DataTools.IntegrationServices', version: '17.0.1010.2',
      architecture: 'x86' as const,
      installerSha256: '75D8444333303D5B449660A669AF07862289E5F2BBDEF0AE7520C5BA3E47D65B',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Install failed with exit 1626.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'burn', installScope: 'machine',
      silentSwitches: '/quiet /norestart',
      uninstallCommand: 'REGISTRY_UNINSTALL:SQL Server Integration Services Projects',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the exact Pithflow profile before dependency resolution or queue insertion', async () => {
    const tuple = {
      wingetId: 'Pithflow.Pithflow', version: '1.37.0', architecture: 'x64' as const,
      installerSha256: '536AD9787092DFBD9F23C9F5FD4EA1ED81B1A363736AE68B3B3BFCED627028D4',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Registered uninstaller was absent.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope: 'machine',
      silentSwitches: '/S', uninstallCommand: 'REGISTRY_UNINSTALL:Pithflow',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the failed RadioMaximus profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'Raimersoft.RadioMaximus', version: '2.33.15', architecture: 'x86' as const,
      installerSha256: '8D64DD8FCA0C7CD042CD3028496B7085BEDF22364908D056A9795BCCB821A4A8',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact RadioMaximus_is1 registration remained.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, displayName: 'RadioMaximus', publisher: 'Raimersoft',
      installerType: 'inno', installScope: 'machine',
      silentSwitches: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:RadioMaximus_is1:RadioMaximus',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the failed Tencent ima normalized profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'Tencent.ima-copilot', version: '2.6.10.5128', architecture: 'x64' as const,
      installerSha256: '37E79B29536B79F0DB0F203CD9135A196F5A9791D446F7B16E2A3C1FE75F9EB9',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact ima.copilot registration remained.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, displayName: 'ima', publisher: 'Tencent',
      installerType: 'exe', installScope: 'machine', silentSwitches: 'quiet',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:ima.copilot:ima',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['machine', 'user'] as const)('contains the exact GreenTunnel payload before queueing %s scope', async (installScope) => {
    const tuple = {
      wingetId: 'SadeghHayeri.GreenTunnel', version: '3.0.5', architecture: 'x86' as const,
      installerSha256: '77CD4E08ABF2E7A0FC235821AE49BBFDD032616A9A0407902F907C96547D2659',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'LocalSystem lifecycle remains unsupported.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope,
      silentSwitches: '/S', uninstallCommand: 'REGISTRY_UNINSTALL_KEY:ba1bb1f3-0069-5c64-9a11-479ebc0471d9:GreenTunnel',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the exact XplicitTrust MSI before dependency resolution or queue insertion', async () => {
    const tuple = {
      wingetId: 'XplicitTrust.Agent', version: '1.065', architecture: 'x64' as const,
      installerSha256: '9015EEE906A0B84F2B5B0471E6F7C88C5BCF50DE6B6F32C5EB252D385D7FDBD2',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Captured MSI registration disappeared.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'msi', installScope: 'machine',
      silentSwitches: '/qn /norestart ALLUSERS=1',
      uninstallCommand: 'REGISTRY_UNINSTALL_PRODUCT:{76CCDAB5-94FA-4CE5-9B0D-6F8304D801A3}:XplicitTrust Network Access',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the exact Orca profile before dependency resolution or queue insertion', async () => {
    const tuple = {
      wingetId: 'StablyAI.Orca', version: '1.4.203', architecture: 'x64' as const,
      installerSha256: 'DC347211CE31DC1D37BD6522B2BB96169747F626A19754C57F6868769E878A7C',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Registered uninstaller was absent.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope: 'machine',
      silentSwitches: '/S', uninstallCommand: 'REGISTRY_UNINSTALL_PRODUCT:{2B325EC9-0ED1-575F-AD70-E08307AEE879}:Orca',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the mismatched MTGA Launcher normalized profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'WizardsoftheCoast.MTGALauncher', version: '1.0.124', architecture: 'x64' as const,
      installerSha256: '96C64E5E0CD4D5758F3C9AE1AF7A2C6FFCF4782E273AEDE28FA92B8E63FFC368',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Manifest launcher identity was absent.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, displayName: 'MTGA Launcher', publisher: 'WizardsoftheCoast',
      installerType: 'exe', installScope: 'machine', silentSwitches: '/quiet',
      uninstallCommand: 'REGISTRY_UNINSTALL_PRODUCT:{BB91E8E1-8030-43C7-8461-1E54166F3AAB}:MTGA Launcher',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
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

  it('does not reactivate an installer source quarantined by dispatch preflight', async () => {
    const input = demandInput();
    const quarantineSummary =
      'Installer source quarantined before QA: MANIFEST_CHANGED. The selected installer is stale.';
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
              data: {
                id: 'candidate-quarantined',
                status: 'superseded',
                priority: 500,
                failure_summary: quarantineSummary,
              },
              error: null,
            })),
          };
        }
        throw new Error('Quarantined candidate must not be updated');
      }),
    };

    const result = await ensureQaDemand(client as never, input);

    expect(result).toMatchObject({
      state: 'failed',
      candidateId: 'candidate-quarantined',
      failureSummary: quarantineSummary,
    });
    expect(candidateCall).toBe(4);
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

  it('applies a required user scope before dependency resolution and QA identity', async () => {
    const input = { ...demandInput(), wingetId: 'VNGCorp.Zalo' };
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'qa_package_results') {
          return { select: vi.fn(() => query({ data: null, error: null })) };
        }
        if (table === 'qa_candidates') {
          return query({
            data: { id: 'candidate-active', status: 'running', priority: 2_000 },
            error: null,
          });
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ensureQaDemand(client as never, input);
    const profile = JSON.parse(result.identity.canonicalJson) as {
      installer: { installScope: string };
    };

    expect(resolveWingetPackageDependenciesMock).toHaveBeenCalledWith(
      expect.objectContaining({ installScope: 'user' })
    );
    expect(profile.installer.installScope).toBe('user');
  });

  it('only reuses a failed result for the current execution profile', async () => {
    const input = demandInput();
    let resultCall = 0;
    const failedResultQuery = query({
      data: { package_profile_sha256: 'A'.repeat(64) },
      error: null,
    });
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'qa_package_results') {
          return {
            select: vi.fn(() => {
              resultCall++;
              return resultCall === 1
                ? query({ data: null, error: null })
                : failedResultQuery;
            }),
          };
        }
        if (table === 'qa_candidates') return query({ data: null, error: null });
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await ensureQaDemand(client as never, input);

    expect(result.state).toBe('failed');
    expect(failedResultQuery.eq).toHaveBeenCalledWith(
      'package_profile_sha256',
      result.identity.executionProfileSha256
    );
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

  it('persists a reviewed compatibility block and returns a generic customer message', async () => {
    const upsert = vi.fn(async () => ({ data: null, error: null }));
    const client = {
      from: vi.fn((table: string) => {
        if (table === 'qa_package_blocks') return { upsert };
        throw new Error(`Unexpected table: ${table}`);
      }),
    };
    resolveWingetPackageDependenciesMock.mockRejectedValue(
      new WingetDependencyCompatibilityError(
        'Example.App requires elevation in user scope.',
        'user_scope_elevation_required'
      )
    );

    const result = await ensureQaDemand(client as never, {
      ...demandInput(),
      installScope: 'user',
    });

    expect(result).toMatchObject({
      state: 'failed',
      candidateId: null,
      failureSummary: 'This app is not currently available for deployment.',
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      winget_id: 'Example.App',
      version: '1.2.3',
      architecture: 'x64',
      installer_sha256: 'A'.repeat(64),
      block_code: 'user_scope_elevation_required',
    }), {
      onConflict: 'winget_id,version,architecture,installer_sha256',
    });
  });
});
