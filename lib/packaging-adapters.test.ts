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
      applyApplicationPackagingAdapter('PostgreSQL.PostgreSQL.18', DEFAULT_PSADT_CONFIG)
        .reviewedUninstallArguments
    ).toEqual(['--mode', 'unattended', '--unattendedmodeui', 'none']);
    expect(
      applyApplicationPackagingAdapter('Opera.Opera', DEFAULT_PSADT_CONFIG)
    ).toMatchObject({
      processesToClose: [{ name: 'opera', description: 'Opera browser' }],
      reviewedUninstallArguments: ['/silent'],
    });
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

  it('does not accept shared-runtime retention from customer-controlled config', () => {
    const adapted = applyApplicationPackagingAdapter('Example.App', {
      ...DEFAULT_PSADT_CONFIG,
      preserveVendorInstallationOnUninstall: true,
    });

    expect(adapted.preserveVendorInstallationOnUninstall).toBeUndefined();
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

  it('preserves customer Opera lifecycle settings while adding the reviewed silent removal contract', () => {
    const adapted = applyApplicationPackagingAdapter('opera.opera', {
      ...DEFAULT_PSADT_CONFIG,
      processesToClose: [
        { name: 'Opera.exe', description: 'Customer browser session' },
      ],
      reviewedUninstallArguments: ['/SILENT', '--custom'],
    });

    expect(adapted.processesToClose).toEqual([
      { name: 'Opera', description: 'Customer browser session' },
    ]);
    expect(adapted.reviewedUninstallArguments).toEqual(['/SILENT', '--custom']);
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
