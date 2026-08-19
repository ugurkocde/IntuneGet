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

  it('rebuilds a stale cart command from the trusted machine manifest entry', async () => {
    const reconciled = await reconcileCatalogInstaller(operaItem());

    expect(reconciled.item.installScope).toBe('machine');
    expect(reconciled.item.installCommand).toBe('"opera.exe" /silent /allusers=1');
    expect(reconciled.item.installCommand).not.toContain('/allusers=0');
    expect(reconciled.trustedInstallers).toBe(operaInstallers);
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
