import { describe, it, expect } from 'vitest';
import {
  slugify,
  buildCustomWingetId,
  isValidInstallerUrl,
  isValidSha256,
  isValidIconUrl,
  buildCustomAppCartItem,
  CUSTOM_SILENT_SWITCH_DEFAULTS,
  type CustomAppInput,
} from '../custom-app';
import type { RegistryDetectionRule } from '@/types/intune';

const VALID_SHA256 = 'a'.repeat(64);

function validInput(overrides: Partial<CustomAppInput> = {}): CustomAppInput {
  return {
    displayName: 'My App 2',
    publisher: "O'Brien Software",
    version: '1.2.3',
    installerUrl: 'https://example.com/downloads/setup.exe',
    installerType: 'exe',
    architecture: 'x64',
    installScope: 'machine',
    ...overrides,
  };
}

describe('slugify', () => {
  it('should strip all non-alphanumeric characters', () => {
    expect(slugify("O'Brien Software")).toBe('OBrienSoftware');
    expect(slugify('My App 2')).toBe('MyApp2');
    expect(slugify('7-Zip')).toBe('7Zip');
  });

  it('should return an empty string when nothing remains', () => {
    expect(slugify('---')).toBe('');
  });
});

describe('buildCustomWingetId', () => {
  it('should synthesize Custom.<PublisherSlug>.<NameSlug>', () => {
    expect(buildCustomWingetId("O'Brien Software", 'My App 2')).toBe(
      'Custom.OBrienSoftware.MyApp2'
    );
  });

  it('should fall back to placeholder slugs when input has no alphanumerics', () => {
    expect(buildCustomWingetId('---', '###')).toBe('Custom.Publisher.App');
  });
});

describe('isValidInstallerUrl', () => {
  it('should accept http and https URLs', () => {
    expect(isValidInstallerUrl('https://example.com/setup.exe')).toBe(true);
    expect(isValidInstallerUrl('http://example.com/setup.msi')).toBe(true);
  });

  it('should reject non-http(s) schemes and malformed URLs', () => {
    expect(isValidInstallerUrl('ftp://example.com/setup.exe')).toBe(false);
    expect(isValidInstallerUrl('file:///C:/setup.exe')).toBe(false);
    expect(isValidInstallerUrl('javascript:alert(1)')).toBe(false);
    expect(isValidInstallerUrl('not a url')).toBe(false);
    expect(isValidInstallerUrl('')).toBe(false);
  });
});

describe('isValidSha256', () => {
  it('should accept a 64-character hex string in any case', () => {
    expect(isValidSha256(VALID_SHA256)).toBe(true);
    expect(isValidSha256('A1B2C3D4'.repeat(8))).toBe(true);
  });

  it('should reject wrong lengths and non-hex characters', () => {
    expect(isValidSha256('a'.repeat(63))).toBe(false);
    expect(isValidSha256('a'.repeat(65))).toBe(false);
    expect(isValidSha256('g'.repeat(64))).toBe(false);
    expect(isValidSha256('')).toBe(false);
  });
});

describe('isValidIconUrl', () => {
  it('should accept https URLs only', () => {
    expect(isValidIconUrl('https://example.com/icon.png')).toBe(true);
    expect(isValidIconUrl('http://example.com/icon.png')).toBe(false);
    expect(isValidIconUrl('not a url')).toBe(false);
  });
});

describe('buildCustomAppCartItem', () => {
  it('should produce a complete Win32CartItem shape with all required fields', () => {
    const item = buildCustomAppCartItem(validInput());

    expect(item.appSource).toBe('win32');
    expect(item.sourceType).toBe('custom');
    expect(item.wingetId).toBe('Custom.OBrienSoftware.MyApp2');
    expect(item.displayName).toBe('My App 2');
    expect(item.publisher).toBe("O'Brien Software");
    expect(item.version).toBe('1.2.3');
    expect(item.architecture).toBe('x64');
    expect(item.installScope).toBe('machine');
    expect(item.installerType).toBe('exe');
    expect(item.installerUrl).toBe('https://example.com/downloads/setup.exe');
    expect(item.installerSha256).toBe('');
    expect(item.installCommand).toBeTruthy();
    expect(item.uninstallCommand).toBeTruthy();
    expect(item.detectionRules.length).toBeGreaterThan(0);
    expect(item.psadtConfig).toBeDefined();
    expect(item.psadtConfig.detectionRules).toEqual(item.detectionRules);
  });

  it('should generate a registry marker detection rule pointing at the sanitized custom id', () => {
    const item = buildCustomAppCartItem(validInput());
    const rule = item.detectionRules[0] as RegistryDetectionRule;

    expect(rule.type).toBe('registry');
    expect(rule.keyPath).toBe(
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Custom_OBrienSoftware_MyApp2'
    );
    expect(rule.detectionValue).toBe('1.2.3');
  });

  it('should use HKCU for user scope detection', () => {
    const item = buildCustomAppCartItem(validInput({ installScope: 'user' }));
    const rule = item.detectionRules[0] as RegistryDetectionRule;

    expect(rule.keyPath.startsWith('HKEY_CURRENT_USER\\')).toBe(true);
  });

  it('should apply per-type default silent switches to the install command', () => {
    const exeItem = buildCustomAppCartItem(validInput({ installerType: 'exe' }));
    expect(exeItem.installCommand).toBe(`"setup.exe" ${CUSTOM_SILENT_SWITCH_DEFAULTS.exe}`);

    const innoItem = buildCustomAppCartItem(
      validInput({ installerType: 'inno', installerUrl: 'https://example.com/app-setup.exe' })
    );
    expect(innoItem.installCommand).toBe(
      `"app-setup.exe" ${CUSTOM_SILENT_SWITCH_DEFAULTS.inno}`
    );

    const burnItem = buildCustomAppCartItem(validInput({ installerType: 'burn' }));
    expect(burnItem.installCommand).toBe(`"setup.exe" ${CUSTOM_SILENT_SWITCH_DEFAULTS.burn}`);
  });

  it('should build an msiexec install command for MSI installers', () => {
    const item = buildCustomAppCartItem(
      validInput({ installerType: 'msi', installerUrl: 'https://example.com/app.msi' })
    );
    expect(item.installCommand).toBe('msiexec /i "app.msi" /qn ALLUSERS=1 /norestart');
  });

  it('should prefer user-provided silent switches over the defaults', () => {
    const item = buildCustomAppCartItem(validInput({ silentSwitches: '/silent /custom' }));
    expect(item.installCommand).toBe('"setup.exe" /silent /custom');
  });

  it('should prefer a user-provided uninstall command, otherwise generate one', () => {
    const custom = buildCustomAppCartItem(validInput({ uninstallCommand: 'uninstall.exe /S' }));
    expect(custom.uninstallCommand).toBe('uninstall.exe /S');

    const generated = buildCustomAppCartItem(validInput());
    expect(generated.uninstallCommand).toBe('REGISTRY_UNINSTALL:My App 2');
  });

  it('should pass through a valid sha256, trim whitespace, and allow it to be omitted', () => {
    expect(buildCustomAppCartItem(validInput({ sha256: VALID_SHA256 })).installerSha256).toBe(
      VALID_SHA256
    );
    expect(
      buildCustomAppCartItem(validInput({ sha256: ` ${VALID_SHA256} ` })).installerSha256
    ).toBe(VALID_SHA256);
    expect(buildCustomAppCartItem(validInput()).installerSha256).toBe('');
    expect(buildCustomAppCartItem(validInput({ sha256: '   ' })).installerSha256).toBe('');
  });

  it('should only accept https icon URLs', () => {
    const withIcon = buildCustomAppCartItem(
      validInput({ iconUrl: 'https://example.com/icon.png' })
    );
    expect(withIcon.iconPath).toBe('https://example.com/icon.png');

    expect(buildCustomAppCartItem(validInput()).iconPath).toBeUndefined();
    expect(() =>
      buildCustomAppCartItem(validInput({ iconUrl: 'http://example.com/icon.png' }))
    ).toThrow(/https/i);
  });

  it('should omit empty optional description', () => {
    expect(buildCustomAppCartItem(validInput()).description).toBeUndefined();
    expect(buildCustomAppCartItem(validInput({ description: ' Notes ' })).description).toBe(
      'Notes'
    );
  });

  it('should reject invalid installer URLs', () => {
    expect(() =>
      buildCustomAppCartItem(validInput({ installerUrl: 'ftp://example.com/setup.exe' }))
    ).toThrow(/Installer URL/);
    expect(() => buildCustomAppCartItem(validInput({ installerUrl: 'not a url' }))).toThrow(
      /Installer URL/
    );
  });

  it('should reject an invalid sha256', () => {
    expect(() => buildCustomAppCartItem(validInput({ sha256: 'xyz' }))).toThrow(/SHA256/);
  });

  it('should reject missing required fields', () => {
    expect(() => buildCustomAppCartItem(validInput({ displayName: '  ' }))).toThrow(/required/);
    expect(() => buildCustomAppCartItem(validInput({ publisher: '' }))).toThrow(/required/);
    expect(() => buildCustomAppCartItem(validInput({ version: '' }))).toThrow(/required/);
  });
});
