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

  it('rebuilds a stale cart command from the trusted machine manifest entry', async () => {
    const reconciled = await reconcileCatalogInstaller(operaItem());

    expect(reconciled.item.installScope).toBe('machine');
    expect(reconciled.item.installCommand).toBe('"opera.exe" /silent /allusers=1');
    expect(reconciled.item.installCommand).not.toContain('/allusers=0');
    expect(reconciled.trustedInstallers).toBe(operaInstallers);
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
});
