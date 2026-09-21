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
    ['leezer3.OpenBVE', 'unsupported_managed_uninstall'],
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

  it('blocks the failed SQL Server bootstrapper before profile normalization or queue insertion', async () => {
    const tuple = {
      wingetId: 'Microsoft.SQLServer.2025.Developer', version: '17.0.1000.7', architecture: 'x64' as const,
      installerSha256: 'F2FDCEA621E29B2DD09E3802FD6FE7664A2037BED02349854CCAE96C4A03BBF1',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'SSEI install returned -1; exact registration absent.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'exe', installScope: 'machine',
      silentSwitches: '/IACCEPTSQLSERVERLICENSETERMS /ENU /ACTION=Install /quiet /InstallPath="c:\\Program Files\\Microsoft SQL Server"',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:Microsoft SQL Server SQL2025:Microsoft SQL Server 2025 Developer',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the failed Zoom MSI profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'Zoom.Zoom', version: '7.2.48358', architecture: 'x64' as const,
      installerSha256: '132A59637FCFF4F0F01891F163A7726976D72A4DD7199EC4C0A224CB8E28D5D1',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'MSI uninstall returned 1601.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'msi', installScope: 'machine',
      silentSwitches: '/qn /norestart ALLUSERS=1',
      uninstallCommand: 'REGISTRY_UNINSTALL:Zoom Workplace',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the MrCode failed-removal profile before normalization or queue insertion', async () => {
    const tuple = {
      wingetId: 'zokugun.MrCode', version: '1.82.0.23253', architecture: 'x64' as const,
      installerSha256: '9BB0835D2F8F1F0EF8FB489B3040471BC16676DCE1670BAA8C7876A71D73EF06',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact Inno registration remained after exit 1.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'inno', installScope: 'machine',
      silentSwitches: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand: 'REGISTRY_UNINSTALL:MrCode',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.' });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the ZoiteChat machine Inno profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'ZoiteChat.ZoiteChat', version: '2.19.0', architecture: 'x64' as const,
      installerSha256: 'F3FABDAE2DC83A6AE2344DC1BCF1AD836C4FD4D5472D9B5E681C57CC8F972E08',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Install stalled; no exact uninstall identity.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'inno', installScope: 'machine',
      silentSwitches: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:ZoiteChat_is1:ZoiteChat',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the DeviceShelf user profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'ChristofMueller.DeviceShelf', version: '1.9.30', architecture: 'x64' as const,
      installerSha256: '4741C1AAD4F058939CAE5A3311E46D9C9F4E3BFAC7BC03F56F582F18C6B5029E',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Installer launch failed twice before product registration.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'exe', installScope: 'user',
      silentSwitches: '/S', uninstallCommand: 'REGISTRY_UNINSTALL:DeviceShelf',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the Yandex Disk normalized profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'Yandex.Disk', version: '3.2.51.5198', architecture: 'x64' as const,
      installerSha256: '07B333208A5C14F18A8B48C99478D53DD39368D1E66D6EEB2DD44CB0F545FFAA',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact YandexDisk2 registration remained after vendor removal.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'exe', installScope: 'machine',
      silentSwitches: '-silent -norestart -permachine',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:YandexDisk2:Yandex.Disk',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the Bitig normalized profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'Bitig.Bitig', version: '1.0.4', architecture: 'x64' as const,
      installerSha256: '1D6FBF4139EDF32FA66FC2D72151801D8D622760FAE71985A6C1167F47EFFCFF',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Registered uninstaller absent; reputation unverified.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope: 'machine',
      silentSwitches: '/S', uninstallCommand: 'REGISTRY_UNINSTALL:Bitig',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the IVT normalized profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'BearStarSoftware.IVTSecureAccessFreeEdition', version: '28.1', architecture: 'x64' as const,
      installerSha256: '8159B07F65735968EB3D14D34A19640B7C1E0084A41BC6189C542D1DC9B76FA2',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact Inno registration remained; reputation unverified.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'inno',
      silentSwitches: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand: 'REGISTRY_UNINSTALL:IVT Secure Access Free Edition',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the Pebrel failed-removal profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'Kuddev.Pebrel', version: '1.8.0', architecture: 'x64' as const,
      installerSha256: '28FA2D4A0FFF3FA039CFFEF586875CB867020EB391DCD31BE3DB3477A8AE2159',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact Inno registration remained after silent removal.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'inno', installScope: 'user',
      silentSwitches: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:{61022144-7D0A-4E54-94F2-C329A8F58656}_is1:Nebula Terminal',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the tl;dv normalized profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'tldx.tldv', version: '3.0.264', architecture: 'x64' as const,
      installerSha256: 'BB5007C2BF94F717428D5982CF739489CB0BD0CAFD1A193DA671304AD421B25C',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Registered uninstaller absent after exact-key repair.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope: 'machine',
      silentSwitches: '/S', uninstallCommand: 'REGISTRY_UNINSTALL_KEY:d4ef7abc-e624-5946-b915-b84166f8a4bf:tldv',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the CuteCutPro normalized profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'CuteCutPro.CuteCutPro', version: '2.4.2', architecture: 'x64' as const,
      installerSha256: '9F1F3547B1119054623B145FAAE7EC1C83BB833FE3D8C71A66C0AA5067203058',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Registered uninstaller absent; reputation unverified.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope: 'machine',
      silentSwitches: '/S', uninstallCommand: 'REGISTRY_UNINSTALL:CuteCut Pro',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the Meitu user-scope profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'Meitu.ColorByte.Pro', version: '7.9.4', architecture: 'x64' as const,
      installerSha256: '7EAA434D370737369D4E8FF6B6680B0C8BB0DE9D630E0D59C1DC5ADD7E3B3CDF',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Installer launch canceled; reputation unverified.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope: 'user',
      silentSwitches: '/S', uninstallCommand: 'REGISTRY_UNINSTALL:美图云修Pro',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the failed TubeDigger Inno profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'TubeDigger.TubeDigger', version: '8.2.5.0', architecture: 'x86' as const,
      installerSha256: 'D34F1AFFD65BCF99F5762F5FC1A13C0B2585546BDC89D99AA045364DA6215BC8',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact Inno registration remained.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'inno', installScope: 'machine',
      silentSwitches: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand: 'REGISTRY_UNINSTALL:TubeDigger',
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

  it.each(['machine', 'user'] as const)('blocks exact UniFi Network bytes before queueing %s scope', async (installScope) => {
    const tuple = {
      wingetId: 'Ubiquiti.UniFiNetworkServer', version: '10.6.106', architecture: 'x64' as const,
      installerSha256: '984FEFAA18AA38D90928F9159D2F2C8286202F19B0E038E3C2A8F7192DFC1C91',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registered uninstaller was absent.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope,
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:Ubiquiti UniFi:Ubiquiti UniFi Network Server',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['machine', 'user'] as const)('blocks exact NateOn bytes before queueing %s scope', async (installScope) => {
    const tuple = {
      wingetId: 'SKCommunications.NateOn', version: '7.0.41.0', architecture: 'x86' as const,
      installerSha256: '1DCA7E3230CDB6BEC7374DEE2D226D62C73919B6119D870DD6BC29D19915AE2F',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registration remained after silent uninstall.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope, silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:{EA77EC9A-C82F-4F80-8B7D-D32C09A9C25F}:네이트온',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.' });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['machine', 'user'] as const)('blocks the exact SJMCL bytes before queueing %s scope', async (installScope) => {
    const tuple = {
      wingetId: 'SJMC.SJMCL', version: '1.3.1', architecture: 'x64' as const,
      installerSha256: 'D736C896A039A9AFB8B7D4339A79293FAAAC6EF3F164DAF2DD44F8702997178A',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registered uninstaller was absent.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope,
      silentSwitches: '/S', uninstallCommand: 'REGISTRY_UNINSTALL:SJMCL',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.' });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['machine', 'user'] as const)('blocks the failed DockMapper bytes before queueing %s scope', async (installScope) => {
    const tuple = {
      wingetId: 'luqiangbo.DockMapper', version: '1.1.5', architecture: 'x64' as const,
      installerSha256: '2C17B07EA68C59D38FCE1DACCD88F294FF6E018DC2A87355E95771CC0F141D50',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registered uninstaller was absent.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope,
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:DockMapper',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['machine', 'user'] as const)('blocks the failed TimeScribe bytes before queueing %s scope', async (installScope) => {
    const tuple = {
      wingetId: 'WINBIGFOX.TimeScribe', version: '1.16.0', architecture: 'x64' as const,
      installerSha256: '7F8A4729661150B7A1A9E4E3F3FE347BFA17507AED3096806DABD0A1F34A706B',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registered uninstaller was absent.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope,
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL_PRODUCT:{932B644F-CF07-5D84-AEF8-0B37BF9D7CE1}:TimeScribe',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['machine', 'user'] as const)('blocks stalled WebView2 bytes before queueing %s scope', async (installScope) => {
    const tuple = {
      wingetId: 'Microsoft.EdgeWebView2Runtime', version: '153.0.4234.46', architecture: 'x64' as const,
      installerSha256: '493AE586FF07EF3696DA3BDE3AEB73D6CACA8A1C00E779DA899FF16A159CF36E',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Install stalled and post-install detection failed.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'exe', installScope, silentSwitches: '/silent /install',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:Microsoft EdgeWebView:Microsoft Edge WebView2 Runtime',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.' });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['machine', 'user'] as const)('blocks stalled WeType bytes before queueing %s scope', async (installScope) => {
    const tuple = {
      wingetId: 'Tencent.WeType', version: '2.1.4.6', architecture: 'x64' as const,
      installerSha256: 'D8D487B0C3F9319B7C0A4736851701503CC662B101016CC2B62F7D657A1A41EC',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Install stalled; no exact uninstall identity.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'exe', installScope, silentSwitches: '/s',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:WeType:微信输入法',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.' });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['machine', 'user'] as const)('blocks the failed T3Code payload before queueing %s scope', async (installScope) => {
    const tuple = {
      wingetId: 'T3Tools.T3Code', version: '0.0.42', architecture: 'x64' as const,
      installerSha256: '9BD4A00AE9B4880F85E81376844E4FC1DBC9F719120958D7445B4C2B281E267F',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact registered uninstaller was absent; reputation unverified.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'nullsoft', installScope, silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL_PRODUCT:{E9197887-EFB3-55E0-985E-D6D3B5DD594A}:T3 Code',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.' });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(['machine', 'user'] as const)('blocks the failed Thunder payload before queueing %s scope', async (installScope) => {
    const tuple = {
      wingetId: 'Thunder.Thunder', version: '25.1.13.1637', architecture: 'x64' as const,
      installerSha256: 'B2C7A5269B267E7390BED95975FF9BA56088B26A945B6A2BA4B35B3B15FE8EC6',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Exact thunder_is1 registration remained; reputation unverified.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, installerType: 'exe', installScope, silentSwitches: '/Silent',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:thunder_is1:迅雷',
    })).resolves.toMatchObject({ state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.' });
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

  it.each([
    ['1.4.203', 'DC347211CE31DC1D37BD6522B2BB96169747F626A19754C57F6868769E878A7C'],
    ['1.4.204', '87B877EC7472F664E5264DC5367A5F18F4484AEA67A08B4ECA76F9A65729206C'],
  ])('blocks Orca %s profile before dependency resolution or queue insertion', async (version, installerSha256) => {
    const tuple = {
      wingetId: 'StablyAI.Orca', version, architecture: 'x64' as const, installerSha256,
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

  it('blocks the mismatched IntelliJ EAP profile before dependency resolution or queue insertion', async () => {
    const tuple = {
      wingetId: 'JetBrains.IntelliJIDEA.Ultimate.EAP', version: '252.26199.7', architecture: 'x64' as const,
      installerSha256: 'F6DB9893CC39CF217788A24BBA5C375C332FA354F8BE57F6121BED1FC070F802',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Manifest ARP key was absent; reputation unverified.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, displayName: 'IntelliJ IDEA Ultimate Edition (EAP)', publisher: 'JetBrains',
      installerType: 'exe', installScope: 'machine', silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:IntelliJ IDEA 252.26199.7:IntelliJ IDEA Ultimate Edition (EAP)',
    })).resolves.toMatchObject({
      state: 'failed', candidateId: null,
      failureSummary: 'This app version is not available for automated deployment.',
    });
    expect(getPackageCompatibilityBlockMock).toHaveBeenCalledWith(client, tuple);
    expect(resolveWingetPackageDependenciesMock).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it('blocks the FreSH interactive uninstall profile before queue insertion', async () => {
    const tuple = {
      wingetId: 'S42yt.FreSH', version: '26.10.0', architecture: 'x64' as const,
      installerSha256: '8EB1FE8DBDAF3B36F6E77A50D0E8726018CC740D4513D46CAF42BE575BFBCAE1',
    };
    getPackageCompatibilityBlockMock.mockResolvedValue({
      ...tuple, code: 'failed_managed_lifecycle', detail: 'Vendor removal requires interactive confirmation.',
    });
    const client = { from: vi.fn() };
    await expect(ensureQaDemand(client as never, {
      ...demandInput(), ...tuple, displayName: 'FreSH - First-Run Experience Shell', publisher: 'S42yt',
      installerType: 'exe', installScope: 'user', silentSwitches: '/silent /user',
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
