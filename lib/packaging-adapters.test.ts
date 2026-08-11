import { describe, expect, it } from 'vitest';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import { applyApplicationPackagingAdapter } from './packaging-adapters';

describe('application packaging adapters', () => {
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
