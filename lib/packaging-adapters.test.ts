import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import {
  applyApplicationPackagingAdapter,
  resolveApplicationInstallScope,
} from './packaging-adapters';

describe('application packaging adapters', () => {
  it('forces reviewed per-user installers out of the LocalSystem profile', () => {
    expect(resolveApplicationInstallScope('VNGCorp.Zalo', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' vngcorp.zalo ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope('Makeblock.xToolStudio', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' makeblock.xtoolstudio ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope('Rakuten.Viber', 'machine')).toBe('user');
    expect(resolveApplicationInstallScope(' rakuten.viber ', undefined)).toBe('user');
    expect(resolveApplicationInstallScope('Example.App', 'user')).toBe('user');
    expect(resolveApplicationInstallScope('Example.App', 'machine')).toBe('machine');
  });

  it('adds reviewed silent removal arguments for failing vendor lifecycles', () => {
    expect(
      applyApplicationPackagingAdapter('RARLab.WinRAR', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['/S']);
    expect(
      applyApplicationPackagingAdapter('SoftwareOK.Q-Dir', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['/silent', 'forall']);
    expect(
      applyApplicationPackagingAdapter('Dell.Optimizer', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedExactUninstall: {
        executablePath: '%PackageInstaller%',
        arguments: ['/passthrough', '/silent', '/remove'],
        completionTimeoutMinutes: 10,
      },
    });
    for (const wingetId of [
      'PostgreSQL.PostgreSQL.9.6',
      'PostgreSQL.PostgreSQL.13',
      'PostgreSQL.PostgreSQL.18',
      'postgresql.postgresql.19',
    ]) {
      expect(
        applyApplicationPackagingAdapter(wingetId, DEFAULT_PSADT_CONFIG)
          .reviewedUninstallArguments
      ).toEqual(['--mode', 'unattended', '--unattendedmodeui', 'none']);
    }
    expect(
      applyApplicationPackagingAdapter('PostgreSQL.pgAdmin', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual([]);
    expect(
      applyApplicationPackagingAdapter('Evernote.Evernote', DEFAULT_PSADT_CONFIG)
        .processesToClose
    ).toEqual([{ name: 'Evernote', description: 'Evernote' }]);
    expect(
      applyApplicationPackagingAdapter('Opera.Opera', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      processesToClose: [{ name: 'opera', description: 'Opera browser' }],
      reviewedExactUninstall: {
        executablePath: '%ProgramFiles%\\Opera\\opera.exe',
        arguments: ['--uninstall', '--runimmediately', '--deleteuserprofile=0'],
        completionTimeoutMinutes: 5,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.OfficeDeploymentTool',
        DEFAULT_PSADT_CONFIG
      ).reviewedManagedInstallDirectory
    ).toBe('%ProgramW6432%\\OfficeDeploymentTool');
    expect(
      applyApplicationPackagingAdapter('HP.ImageAssistant', DEFAULT_PSADT_CONFIG)
        .reviewedManagedInstallDirectory
    ).toBe('%SystemDrive%\\SWSetup\\HPImageAssistant');
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.VisualStudio.BuildTools',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedManagedInstallDirectory:
        '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\BuildTools',
      reviewedManagedUninstall: {
        executablePath:
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
        arguments: [
          'uninstall',
          '--installPath',
          '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\BuildTools',
          '--quiet',
          '--norestart',
        ],
        completionTimeoutMinutes: 15,
      },
    });
    expect(
      applyApplicationPackagingAdapter(
        'ElectronicArts.EADesktop',
        DEFAULT_PSADT_CONFIG
      ).processesToClose
    ).toEqual([
      { name: 'EADesktop', description: 'EA app' },
      { name: 'EALauncher', description: 'EA app launcher' },
      { name: 'EACefSubProcess', description: 'EA app web process' },
      { name: 'EALocalHostSvc', description: 'EA local host service' },
      { name: 'EABackgroundService', description: 'EA background service' },
    ]);
    expect(
      applyApplicationPackagingAdapter('Elgato.CameraHub', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      processesToClose: [
        { name: 'Camera Hub', description: 'Elgato Camera Hub' },
      ],
      reviewedUninstallProcessGuard: {
        processName: 'Camera Hub.exe',
        argumentsPattern: '(?:^|\\s)--pre-uninstall(?:\\s|$).*--quit(?:\\s|$)',
        graceSeconds: 20,
      },
    });
    expect(
      applyApplicationPackagingAdapter('Microsoft.VSTOR', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['/uninstall', '/quiet', '/norestart']);
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.VisualStudio.2022.Professional',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedUninstallArguments: ['--quiet', '--norestart'],
      uninstallCompletionTimeoutMinutes: 15,
    });
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.SQLServerManagementStudio.22',
        DEFAULT_PSADT_CONFIG
      )
    ).toMatchObject({
      reviewedUninstallArguments: ['--quiet', '--norestart', '--noweb'],
      uninstallCompletionTimeoutMinutes: 15,
    });
  });

  it('adds the vendor-supported LTspice enterprise install mode', () => {
    const adapted = applyApplicationPackagingAdapter(
      'AnalogDevices.LTspice',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.reviewedInstallArguments).toEqual(['MY_SPECIAL_MODE=2']);
    expect(adapted.reviewedUninstallArguments).toEqual([]);
  });

  it('retains the shared WebView2 runtime while removing IntuneGet ownership', () => {
    expect(
      applyApplicationPackagingAdapter(
        'Microsoft.EdgeWebView2Runtime',
        DEFAULT_PSADT_CONFIG
      ).preserveVendorInstallationOnUninstall
    ).toBe(true);
  });

  it('uses reviewed multi-product evidence for the shared Visual C++ runtime bundle', () => {
    expect(
      applyApplicationPackagingAdapter('ABBODI1406.VCREDIST', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      preserveVendorInstallationOnUninstall: true,
      reviewedMultiProductInstallDisplayNamePrefixes: [
        'Microsoft Visual C++',
        'Visual C++',
      ],
      reviewedMultiProductInstallMinimumCount: 10,
    });
  });

  it('does not accept shared-runtime retention from customer-controlled config', () => {
    const adapted = applyApplicationPackagingAdapter('Example.App', {
      ...DEFAULT_PSADT_CONFIG,
      preserveVendorInstallationOnUninstall: true,
      reviewedMultiProductInstallDisplayNamePrefixes: ['Anything'],
      reviewedMultiProductInstallMinimumCount: 2,
      reviewedManagedInstallDirectory: '%ProgramFiles%\\Example',
      reviewedManagedUninstall: {
        executablePath: '%ProgramFiles%\\Example\\uninstall.exe',
        arguments: ['/quiet'],
        completionTimeoutMinutes: 5,
      },
      reviewedExactUninstall: {
        executablePath: '%ProgramFiles%\\Example\\exact-uninstall.exe',
        arguments: ['/quiet'],
        completionTimeoutMinutes: 5,
      },
    });

    expect(adapted.preserveVendorInstallationOnUninstall).toBeUndefined();
    expect(adapted.reviewedMultiProductInstallDisplayNamePrefixes).toBeUndefined();
    expect(adapted.reviewedMultiProductInstallMinimumCount).toBeUndefined();
    expect(adapted.reviewedManagedInstallDirectory).toBeUndefined();
    expect(adapted.reviewedManagedUninstall).toBeUndefined();
    expect(adapted.reviewedExactUninstall).toBeUndefined();
  });

  it('preserves and deduplicates reviewed install arguments case-insensitively', () => {
    const adapted = applyApplicationPackagingAdapter('AnalogDevices.LTspice', {
      ...DEFAULT_PSADT_CONFIG,
      reviewedInstallArguments: ['my_special_mode=2', 'EXAMPLE=1'],
    });

    expect(adapted.reviewedInstallArguments).toEqual([
      'my_special_mode=2',
      'EXAMPLE=1',
    ]);
  });

  it.each([
    'Microsoft.SQLServerManagementStudio.21',
    'Microsoft.SQLServerManagementStudio.22',
    'Microsoft.SQLServerManagementStudio.22.Preview',
  ])('applies the Visual Studio Installer lifecycle to %s', (wingetId) => {
    expect(
      applyApplicationPackagingAdapter(wingetId.toLowerCase(), DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      reviewedUninstallArguments: ['--quiet', '--norestart', '--noweb'],
      uninstallCompletionTimeoutMinutes: 15,
    });
  });

  it('preserves and deduplicates reviewed uninstall arguments case-insensitively', () => {
    const adapted = applyApplicationPackagingAdapter('RARLab.WinRAR', {
      ...DEFAULT_PSADT_CONFIG,
      reviewedUninstallArguments: ['/s', '--custom'],
    });

    expect(adapted.reviewedUninstallArguments).toEqual(['/s', '--custom']);
  });

  it('preserves customer Opera process settings while enforcing the exact reviewed removal contract', () => {
    const adapted = applyApplicationPackagingAdapter('opera.opera', {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'Opera.exe', description: 'Customer browser session' },
      ],
      reviewedUninstallArguments: ['--RUNIMMEDIATELY', '--custom'],
    });

    expect(adapted.processesToClose).toEqual([
      { name: 'Opera', description: 'Customer browser session' },
    ]);
    expect(adapted.reviewedUninstallArguments).toEqual(['--RUNIMMEDIATELY', '--custom']);
    expect(adapted.reviewedExactUninstall).toEqual({
      executablePath: '%ProgramFiles%\\Opera\\opera.exe',
      arguments: ['--uninstall', '--runimmediately', '--deleteuserprofile=0'],
      completionTimeoutMinutes: 5,
    });
  });

  it('uses the reviewed machine-wide Opera GX removal contract', () => {
    const adapted = applyApplicationPackagingAdapter(
      'opera.operagx',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'opera', description: 'Opera GX browser' },
    ]);
    expect(adapted.reviewedExactUninstall).toEqual({
      executablePath: '%ProgramFiles%\\Opera GX\\opera.exe',
      arguments: ['--uninstall', '--runimmediately', '--deleteuserprofile=0'],
      completionTimeoutMinutes: 5,
    });
  });

  it('closes the reviewed Adobe desktop processes before Creative Cloud removal', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Adobe.CreativeCloud',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'Creative Cloud', description: 'Adobe Creative Cloud' },
      { name: 'AdobeDesktopService', description: 'Adobe Desktop Service' },
      { name: 'AdobeCEFHelper', description: 'Adobe CEF Helper' },
      { name: 'AdobeInstaller', description: 'Adobe Installer' },
      { name: 'AdobeUpdateService', description: 'Adobe Update Service' },
      { name: 'CCLibrary', description: 'Adobe Creative Cloud Library' },
      { name: 'CCXProcess', description: 'Adobe Creative Cloud Experience' },
      { name: 'CoreSync', description: 'Adobe CoreSync' },
      { name: 'AdobeIPCBroker', description: 'Adobe IPC Broker' },
      { name: 'AdobeNotificationClient', description: 'Adobe Notification Client' },
      { name: 'CreativeCloudHelper', description: 'Adobe Creative Cloud Helper' },
    ]);
  });

  it('preserves a customer Adobe process description while filling missing lifecycle entries', () => {
    const adapted = applyApplicationPackagingAdapter('Adobe.CreativeCloud', {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'Creative Cloud.exe', description: 'Customer-managed sync client' },
      ],
    });

    expect(adapted.processesToClose[0]).toEqual({
      name: 'Creative Cloud',
      description: 'Customer-managed sync client',
    });
    expect(adapted.processesToClose).toHaveLength(11);
  });

  it('adds the reviewed Stream Deck lifecycle process to the exact app', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Elgato.StreamDeck',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'StreamDeck', description: 'Elgato Stream Deck' },
    ]);
    expect(DEFAULT_PSADT_CONFIG.processesToClose).toEqual([]);
  });

  it('closes Greenshot before install and removal lifecycle actions', () => {
    const adapted = applyApplicationPackagingAdapter(
      'Greenshot.Greenshot',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'Greenshot', description: 'Greenshot' },
    ]);
  });

  it('closes Qfinder Pro before its NSIS removal lifecycle', () => {
    const adapted = applyApplicationPackagingAdapter(
      'QNAP.QfinderPro',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'QfinderPro', description: 'QNAP Qfinder Pro' },
    ]);
  });

  it('closes the vendor-documented OCS Inventory processes before package lifecycle actions', () => {
    const adapted = applyApplicationPackagingAdapter(
      'OCSInventoryNG.WindowsAgent',
      DEFAULT_PSADT_CONFIG
    );

    expect(adapted.processesToClose).toEqual([
      { name: 'OcsSystray', description: 'OCS Inventory system tray' },
      { name: 'OcsService', description: 'OCS Inventory service' },
      { name: 'OCSInventory', description: 'OCS Inventory agent' },
      { name: 'download', description: 'OCS Inventory download helper' },
    ]);
  });

  it('preserves customer OCS Inventory processes without adding duplicate executable names', () => {
    const adapted = applyApplicationPackagingAdapter('OCSInventoryNG.WindowsAgent', {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'ocsservice.exe', description: 'Customer-managed OCS service' },
        { name: 'OcsNotifyUser', description: 'Customer notification helper' },
      ],
    });

    expect(adapted.processesToClose).toEqual([
      { name: 'ocsservice', description: 'Customer-managed OCS service' },
      { name: 'OcsNotifyUser', description: 'Customer notification helper' },
      { name: 'OcsSystray', description: 'OCS Inventory system tray' },
      { name: 'OCSInventory', description: 'OCS Inventory agent' },
      { name: 'download', description: 'OCS Inventory download helper' },
    ]);
  });

  it('matches WinGet identities case-insensitively', () => {
    expect(
      applyApplicationPackagingAdapter('  elgato.streamdeck  ', DEFAULT_PSADT_CONFIG)
        .processesToClose
    ).toEqual([
      { name: 'StreamDeck', description: 'Elgato Stream Deck' },
    ]);
  });

  it('preserves customer processes and deduplicates names with an exe suffix', () => {
    const adapted = applyApplicationPackagingAdapter('Elgato.StreamDeck', {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'streamdeck.exe', description: 'Customer description' },
        { name: 'companion', description: 'Companion app' },
      ],
    });

    expect(adapted.processesToClose).toEqual([
      { name: 'streamdeck', description: 'Customer description' },
      { name: 'companion', description: 'Companion app' },
    ]);
  });

  it('does not attach an adapter to a different application identity', () => {
    const config = { ...DEFAULT_PSADT_CONFIG, processesToClose: [] };
    expect(applyApplicationPackagingAdapter('Example.StreamDeck', config)).toBe(config);
  });
});
