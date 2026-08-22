import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getLiveInstallersMock } = vi.hoisted(() => ({
  getLiveInstallersMock: vi.fn(),
}));

vi.mock('@/lib/manifest-api', () => ({
  getLiveInstallers: getLiveInstallersMock,
}));

import {
  reconcileCatalogInstaller,
  selectTrustedCatalogInstaller,
} from '@/lib/catalog-installer-reconciliation';
import { InstallerPreflightError } from '@/lib/installer-preflight';
import type { Win32CartItem } from '@/types/upload';
import type { NormalizedInstaller } from '@/types/winget';

const sha256 = 'A'.repeat(64);
const operaInstallers: NormalizedInstaller[] = [
  {
    architecture: 'x64',
    url: 'https://example.test/opera.exe',
    sha256,
    type: 'exe',
    scope: 'user',
    silentArgs: '/silent /allusers=0',
  },
  {
    architecture: 'x64',
    url: 'https://example.test/opera.exe',
    sha256,
    type: 'exe',
    scope: 'machine',
    silentArgs: '/silent /allusers=1',
  },
];

function operaItem(overrides: Partial<Win32CartItem> = {}): Win32CartItem {
  return {
    appSource: 'win32',
    wingetId: 'Opera.Opera',
    displayName: 'Opera Browser',
    publisher: 'Opera Software',
    version: '134.0.5954.46',
    architecture: 'x64',
    installScope: 'machine',
    installerType: 'exe',
    installerUrl: 'https://example.test/opera.exe',
    installerSha256: sha256,
    installCommand: '"opera.exe" /silent /allusers=0',
    uninstallCommand: 'REGISTRY_UNINSTALL:Opera Stable',
    detectionRules: [],
    psadtConfig: {} as Win32CartItem['psadtConfig'],
    id: 'opera',
    addedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('catalog installer reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLiveInstallersMock.mockResolvedValue(operaInstallers);
  });

  it('selects the requested scope even when user and machine entries share bytes', () => {
    expect(selectTrustedCatalogInstaller(operaInstallers, {
      wingetId: 'Opera.Opera',
      version: '134.0.5954.46',
      architecture: 'x64',
      installScope: 'machine',
      installerUrl: operaInstallers[0].url,
      installerSha256: sha256,
    })?.silentArgs).toBe('/silent /allusers=1');

    expect(selectTrustedCatalogInstaller(operaInstallers, {
      wingetId: 'Opera.Opera',
      version: '134.0.5954.46',
      architecture: 'x64',
      installScope: 'user',
    })?.silentArgs).toBe('/silent /allusers=0');
  });

  it('does not substitute an explicitly opposite installer scope', () => {
    expect(selectTrustedCatalogInstaller([operaInstallers[0]], {
      wingetId: 'Opera.Opera',
      version: '134.0.5954.46',
      architecture: 'x64',
      installScope: 'machine',
    })).toBeNull();
  });

  it('prefers an enterprise MSI over a per-user bootstrapper for machine packaging', () => {
    const ringCentralInstallers: NormalizedInstaller[] = [
      {
        architecture: 'x64',
        url: 'https://example.test/ringcentral-user.exe',
        sha256: 'A'.repeat(64),
        type: 'nullsoft',
        scope: 'machine',
        silentArgs: '/S',
      },
      {
        architecture: 'x64',
        url: 'https://example.test/ringcentral-admin.msi',
        sha256: 'B'.repeat(64),
        type: 'wix',
        scope: 'machine',
        silentArgs: '/qn /norestart',
        productCode: '{1DE15838-06D0-4C9D-B513-F86B806149D5}',
      },
    ];

    const selected = selectTrustedCatalogInstaller(ringCentralInstallers, {
      wingetId: 'RingCentral.RingCentralTeamsDesktopPlugin',
      version: '26.2.20-build.233',
      architecture: 'x64',
      installScope: 'machine',
      installerUrl: ringCentralInstallers[0].url,
      installerSha256: ringCentralInstallers[0].sha256,
    });

    expect(selected?.type).toBe('wix');
    expect(selected?.url).toBe('https://example.test/ringcentral-admin.msi');
    expect(selected?.productCode).toBe('{1DE15838-06D0-4C9D-B513-F86B806149D5}');
  });

  it('selects Webroot MSI instead of its machine EXE lifecycle', () => {
    const webrootInstallers: NormalizedInstaller[] = [
      {
        architecture: 'x86',
        url: 'https://example.test/wsainstall.msi',
        sha256: 'A'.repeat(64),
        type: 'msi',
        silentArgs: '/qn /norestart',
        productCode: '{11111111-1111-1111-1111-111111111111}',
      },
      {
        architecture: 'x86',
        url: 'https://example.test/wsainstall.exe',
        sha256: 'B'.repeat(64),
        type: 'exe',
        scope: 'machine',
        silentArgs: '/silent /exeshowaddremove /lang=en',
      },
    ];

    const selected = selectTrustedCatalogInstaller(webrootInstallers, {
      wingetId: 'Webroot.SecureAnywhere',
      version: '9.0.45.63',
      architecture: 'x86',
      installScope: 'machine',
      installerUrl: webrootInstallers[1].url,
      installerSha256: webrootInstallers[1].sha256,
    });

    expect(selected?.type).toBe('msi');
    expect(selected?.url).toBe('https://example.test/wsainstall.msi');
  });

  it('fails closed when Webroot no longer publishes its reviewed MSI lifecycle', () => {
    const selected = selectTrustedCatalogInstaller([{
      architecture: 'x86',
      url: 'https://example.test/wsainstall.exe',
      sha256,
      type: 'exe',
      scope: 'machine',
      silentArgs: '/silent /exeshowaddremove /lang=en',
    }], {
      wingetId: 'Webroot.SecureAnywhere',
      version: '9.0.45.63',
      architecture: 'x86',
      installScope: 'machine',
    });

    expect(selected).toBeNull();
  });

  it('rebuilds Webroot packaging around the manifest MSI lifecycle', async () => {
    getLiveInstallersMock.mockResolvedValue([
      {
        architecture: 'x86',
        url: 'https://example.test/wsainstall.msi',
        sha256: 'B'.repeat(64),
        type: 'msi',
      },
      {
        architecture: 'x86',
        url: 'https://example.test/wsainstall.exe',
        sha256,
        type: 'exe',
        scope: 'machine',
        silentArgs: '/silent /exeshowaddremove /lang=en',
      },
    ] satisfies NormalizedInstaller[]);

    const reconciled = await reconcileCatalogInstaller(operaItem({
      wingetId: 'Webroot.SecureAnywhere',
      displayName: 'Webroot SecureAnywhere',
      version: '9.0.45.63',
      architecture: 'x86',
      installerType: 'exe',
      installerUrl: 'https://example.test/wsainstall.exe',
      installCommand: '"wsainstall.exe" /silent /exeshowaddremove /lang=en',
      uninstallCommand: 'REGISTRY_UNINSTALL:Webroot SecureAnywhere',
    }));

    expect(reconciled.item.installerType).toBe('msi');
    expect(reconciled.item.installerUrl).toBe('https://example.test/wsainstall.msi');
    expect(reconciled.item.installCommand).toBe(
      'msiexec /i "wsainstall.msi" /qn ALLUSERS=1 /norestart'
    );
    expect(reconciled.item.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL:Webroot SecureAnywhere'
    );
  });

  it('rebuilds a stale cart command from the trusted machine manifest entry', async () => {
    const reconciled = await reconcileCatalogInstaller(operaItem());

    expect(reconciled.item.installScope).toBe('machine');
    expect(reconciled.item.installCommand).toBe('"opera.exe" /silent /allusers=1');
    expect(reconciled.item.installCommand).not.toContain('/allusers=0');
    expect(reconciled.trustedInstallers).toBe(operaInstallers);
  });

  it('rebuilds customer archive packages with the nested MSI product identity', async () => {
    getLiveInstallersMock.mockResolvedValue([{
      architecture: 'x86',
      url: 'https://example.test/bankid.zip',
      sha256,
      type: 'zip',
      nestedInstallerType: 'msi',
      nestedInstallerPath: 'BankID.msi',
      scope: 'machine',
      silentArgs: '/qn /norestart ALLUSERS=1',
      productCode: '{77B5BCDC-5496-48DA-8B16-5EE2AF08CA31}',
    } satisfies NormalizedInstaller]);

    const reconciled = await reconcileCatalogInstaller(operaItem({
      wingetId: 'FinancialID.BankID',
      displayName: 'BankID säkerhetsprogram',
      version: '7.17.101.2526',
      architecture: 'x86',
      installerType: 'zip',
      installerUrl: 'https://example.test/bankid.zip',
      installCommand: '',
      uninstallCommand: 'REGISTRY_UNINSTALL:BankID säkerhetsprogram',
    }));

    expect(reconciled.item.nestedInstallerType).toBe('msi');
    expect(reconciled.item.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL_PRODUCT:{77B5BCDC-5496-48DA-8B16-5EE2AF08CA31}:BankID säkerhetsprogram'
    );
  });

  it('selects Logitech Presentation user bytes for reviewed LocalSystem execution', async () => {
    getLiveInstallersMock.mockResolvedValue([{
      architecture: 'x86',
      url: 'https://example.test/logitech-presentation.exe',
      sha256,
      type: 'nullsoft',
      scope: 'user',
      silentArgs: '/S',
      productCode: 'LogiPresentation',
    } satisfies NormalizedInstaller]);

    const reconciled = await reconcileCatalogInstaller(operaItem({
      wingetId: 'Logitech.Presentation',
      displayName: 'Logitech Presentation',
      version: '2.10.34',
      architecture: 'x86',
      installScope: 'user',
      installerUrl: 'https://example.test/logitech-presentation.exe',
      installCommand: '"logitech-presentation.exe" /S',
      uninstallCommand: 'REGISTRY_UNINSTALL_KEY:LogiPresentation:Logitech Presentation',
    }));

    expect(reconciled.item.installScope).toBe('machine');
    expect(reconciled.item.installerUrl).toBe(
      'https://example.test/logitech-presentation.exe'
    );
    expect(reconciled.item.installCommand).toBe('"logitech-presentation.exe" /S');
  });

  it('selects NVM user bytes for reviewed LocalSystem execution', async () => {
    getLiveInstallersMock.mockResolvedValue([{
      architecture: 'x86',
      url: 'https://example.test/nvm-setup.exe',
      sha256,
      type: 'inno',
      scope: 'user',
      silentArgs: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      productCode: '40078385-F676-4C61-9A9C-F9028599D6D3_is1',
    } satisfies NormalizedInstaller]);

    const reconciled = await reconcileCatalogInstaller(operaItem({
      wingetId: 'CoreyButler.NVMforWindows',
      displayName: 'NVM for Windows',
      version: '1.2.2',
      architecture: 'x86',
      installScope: 'user',
      installerUrl: 'https://example.test/nvm-setup.exe',
      installCommand: '"nvm-setup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      uninstallCommand:
        'REGISTRY_UNINSTALL_KEY:40078385-F676-4C61-9A9C-F9028599D6D3_is1:NVM for Windows',
    }));

    expect(reconciled.item.installScope).toBe('machine');
    expect(reconciled.item.installerUrl).toBe('https://example.test/nvm-setup.exe');
    expect(reconciled.item.installCommand).toBe(
      '"nvm-setup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-'
    );
  });

  it('preserves explicit PSADT command overrides', async () => {
    const reconciled = await reconcileCatalogInstaller(operaItem({
      psadtConfig: {
        installCommand: 'custom-install.exe /tenant-approved',
        uninstallCommand: 'custom-uninstall.exe /tenant-approved',
      } as Win32CartItem['psadtConfig'],
    }));

    expect(reconciled.item.installCommand).toBe('custom-install.exe /tenant-approved');
    expect(reconciled.item.uninstallCommand).toBe('custom-uninstall.exe /tenant-approved');
  });

  it('blocks an opaque EXE before a customer package can be created', async () => {
    getLiveInstallersMock.mockResolvedValue([{
      ...operaInstallers[1],
      silentArgs: '',
    }]);

    await expect(reconcileCatalogInstaller(operaItem({
      wingetId: 'Contoso.OpaqueSetup',
    }))).rejects.toMatchObject({
      code: 'SILENT_INSTALL_UNAVAILABLE',
      retryable: false,
    } satisfies Partial<InstallerPreflightError>);
  });

  it('allows an explicit PSADT command for an otherwise opaque EXE', async () => {
    getLiveInstallersMock.mockResolvedValue([{
      ...operaInstallers[1],
      silentArgs: '',
    }]);
    const reconciled = await reconcileCatalogInstaller(operaItem({
      wingetId: 'Contoso.OpaqueSetup',
      psadtConfig: {
        installCommand: 'setup.exe --quiet --norestart',
      } as Win32CartItem['psadtConfig'],
    }));

    expect(reconciled.item.installCommand).toBe('setup.exe --quiet --norestart');
  });

  it('uses the reviewed vendor ARP identity for the Chrome EXE catalog package', async () => {
    getLiveInstallersMock.mockResolvedValue([{ ...operaInstallers[1], silentArgs: '/S' }]);
    const reconciled = await reconcileCatalogInstaller(operaItem({
      wingetId: 'Google.Chrome.EXE',
      displayName: 'Google Chrome (EXE)',
      uninstallCommand: 'REGISTRY_UNINSTALL:Google Chrome (EXE)',
    }));

    expect(reconciled.item.uninstallCommand).toBe('REGISTRY_UNINSTALL:Google Chrome');
  });
});
