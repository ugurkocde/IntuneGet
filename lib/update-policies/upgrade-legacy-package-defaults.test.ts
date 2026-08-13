import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { DeploymentConfig } from '@/types/update-policies';
import { upgradeLegacyPackageDefaults } from './upgrade-legacy-package-defaults';

function zoomConfig(): DeploymentConfig {
  const legacyRule = {
    type: 'file' as const,
    path: '%ProgramFiles%',
    fileOrFolderName: 'Zoom VDI Workplace',
    detectionType: 'exists' as const,
    check32BitOn64System: false,
  };
  return {
    displayName: 'Zoom VDI Workplace',
    publisher: 'Zoom',
    architecture: 'x64',
    installerType: 'msi',
    installCommand: 'msiexec /i "ZoomInstallerVDI.msi" /qn ALLUSERS=1 /norestart',
    uninstallCommand: 'msiexec /x {PRODUCT_CODE} /qn /norestart',
    installScope: 'machine',
    detectionRules: [legacyRule],
    psadtConfig: {
      ...DEFAULT_PSADT_CONFIG,
      detectionRules: [legacyRule],
    },
  };
}

const metadata = {
  wingetId: 'Zoom.Zoom.VDI',
  version: '7.0.27050',
  displayName: 'Zoom VDI Workplace',
  installerUrl: 'https://zoom.example/ZoomInstallerVDI.msi',
  installerSha256: 'A'.repeat(64),
  installerType: 'msi',
  installScope: 'machine' as const,
};

describe('upgradeLegacyPackageDefaults', () => {
  it('upgrades the exact legacy MSI defaults used by existing update policies', () => {
    const result = upgradeLegacyPackageDefaults(zoomConfig(), metadata);

    expect(result).toMatchObject({
      changed: true,
      upgradedUninstallCommand: true,
      upgradedDetectionRules: true,
      reconciledManagedDetectionRules: false,
    });
    expect(result.config.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL:Zoom VDI Workplace'
    );
    expect(result.config.detectionRules).toEqual([
      expect.objectContaining({
        type: 'registry',
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Zoom_Zoom_VDI',
        valueName: 'Version',
        detectionValue: '7.0.27050',
      }),
    ]);
    expect(result.config.psadtConfig?.detectionRules).toEqual(
      result.config.detectionRules
    );
  });

  it('repairs an unresolved MSI token without replacing custom detection', () => {
    const config = zoomConfig();
    config.detectionRules = [
      {
        type: 'file',
        path: '%ProgramFiles%\\ZoomVDI\\bin',
        fileOrFolderName: 'Zoom.exe',
        detectionType: 'exists',
        check32BitOn64System: false,
      },
    ];
    config.psadtConfig = {
      ...config.psadtConfig!,
      detectionRules: config.detectionRules,
    };

    const result = upgradeLegacyPackageDefaults(config, metadata);

    expect(result.upgradedUninstallCommand).toBe(true);
    expect(result.upgradedDetectionRules).toBe(false);
    expect(result.config.detectionRules).toEqual(config.detectionRules);
  });

  it('repairs an MSI placeholder even when the vendor changed installer type', () => {
    const result = upgradeLegacyPackageDefaults(zoomConfig(), {
      ...metadata,
      installerType: 'exe',
      installerUrl: 'https://zoom.example/ZoomInstallerVDI.exe',
    });

    expect(result.config.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL:Zoom VDI Workplace'
    );
    expect(result.upgradedUninstallCommand).toBe(true);
  });

  it('repairs the legacy fail-closed MSI identity sentinel', () => {
    const config = zoomConfig();
    config.uninstallCommand = 'MSI_UNINSTALL_IDENTITY_REQUIRED';

    const result = upgradeLegacyPackageDefaults(config, metadata);

    expect(result.config.uninstallCommand).toBe(
      'REGISTRY_UNINSTALL:Zoom VDI Workplace'
    );
  });

  it('does not alter customer-authored commands or rules', () => {
    const config = zoomConfig();
    config.uninstallCommand = 'msiexec /x "{11111111-1111-1111-1111-111111111111}" /qn';
    config.detectionRules = [
      {
        type: 'registry',
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Vendor\\ZoomVDI',
        valueName: 'Version',
        detectionType: 'version',
        operator: 'greaterThanOrEqual',
        detectionValue: '7.0.27050',
        check32BitOn64System: false,
      },
    ];
    config.psadtConfig = {
      ...config.psadtConfig!,
      detectionRules: config.detectionRules,
    };

    const result = upgradeLegacyPackageDefaults(config, metadata);

    expect(result.changed).toBe(false);
    expect(result.config.uninstallCommand).toBe(config.uninstallCommand);
    expect(result.config.detectionRules).toEqual(config.detectionRules);
  });

  it('upgrades legacy PSADT detection without replacing custom top-level detection', () => {
    const config = zoomConfig();
    config.detectionRules = [
      {
        type: 'file',
        path: '%ProgramFiles%\\ZoomVDI\\bin',
        fileOrFolderName: 'Zoom.exe',
        detectionType: 'exists',
        check32BitOn64System: false,
      },
    ];

    const result = upgradeLegacyPackageDefaults(config, metadata);

    expect(result.config.detectionRules).toEqual(config.detectionRules);
    expect(result.config.psadtConfig?.detectionRules[0]).toMatchObject({
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Zoom_Zoom_VDI',
    });
    expect(result.config.psadtConfig?.detectionRules).not.toBe(
      result.config.detectionRules
    );
  });

  it('recognizes the legacy rule using stored scope and regenerates for current scope', () => {
    const config = zoomConfig();

    const result = upgradeLegacyPackageDefaults(config, {
      ...metadata,
      installScope: 'user',
    });

    expect(result.upgradedDetectionRules).toBe(true);
    expect(result.config.detectionRules[0]).toMatchObject({
      keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Zoom_Zoom_VDI',
    });
  });

  it('reconciles an existing managed marker to the current version and scope', () => {
    const config = zoomConfig();
    config.uninstallCommand = 'REGISTRY_UNINSTALL:Zoom VDI Workplace';
    config.detectionRules = [{
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Zoom_Zoom_VDI',
      valueName: 'Version',
      detectionType: 'version',
      operator: 'greaterThanOrEqual',
      detectionValue: '6.6.26950',
      check32BitOn64System: false,
    }];
    config.psadtConfig = {
      ...config.psadtConfig!,
      detectionRules: config.detectionRules,
    };

    const result = upgradeLegacyPackageDefaults(config, {
      ...metadata,
      installScope: 'user',
    });

    expect(result).toMatchObject({
      upgradedDetectionRules: false,
      reconciledManagedDetectionRules: true,
    });
    expect(result.config.detectionRules[0]).toMatchObject({
      keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Zoom_Zoom_VDI',
      detectionValue: '7.0.27050',
    });
  });

  it('uses the configured marker root and user hive for a legacy user package', () => {
    const config = zoomConfig();
    config.installScope = 'user';
    config.detectionRules = [{
      type: 'file',
      path: '%LOCALAPPDATA%\\Programs',
      fileOrFolderName: 'Zoom VDI Workplace',
      detectionType: 'exists',
      check32BitOn64System: false,
    }];
    config.psadtConfig = {
      ...config.psadtConfig!,
      registryMarkerPath: 'SOFTWARE\\Contoso\\Apps',
      detectionRules: config.detectionRules,
    };

    const result = upgradeLegacyPackageDefaults(config, {
      ...metadata,
      installScope: 'user',
    });

    expect(result.config.detectionRules[0]).toMatchObject({
      keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\Contoso\\Apps\\Zoom_Zoom_VDI',
    });
  });
});
