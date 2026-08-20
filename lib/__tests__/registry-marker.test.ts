import { describe, it, expect } from 'vitest';
import {
  DEFAULT_REGISTRY_MARKER_PATH,
  inferSavedCustomMarkerPath,
  normalizeMarkerPath,
  reconcileManagedMarkerDetectionRules,
  rewriteMarkerKeyPath,
} from '../registry-marker';

describe('inferSavedCustomMarkerPath', () => {
  const saved8x8Rule = {
    type: 'registry' as const,
    keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\HBX\\InstalledApps\\8x8_Work',
    valueName: 'Version',
    check32BitOn64System: false,
    detectionType: 'version' as const,
    operator: 'greaterThanOrEqual' as const,
    detectionValue: '8.36.2',
  };

  it('recovers the exact custom root from a saved managed marker rule', () => {
    expect(inferSavedCustomMarkerPath({
      detectionRules: [saved8x8Rule],
      wingetId: '8x8.Work',
      version: '8.36.2',
      installScope: 'machine',
    })).toBe('SOFTWARE\\HBX\\InstalledApps');
  });

  it.each([
    { detectionRules: [saved8x8Rule, saved8x8Rule], version: '8.36.2', scope: 'machine' },
    { detectionRules: [{ ...saved8x8Rule, detectionValue: '8.35.0' }], version: '8.36.2', scope: 'machine' },
    { detectionRules: [{ ...saved8x8Rule, keyPath: saved8x8Rule.keyPath.replace('HKEY_LOCAL_MACHINE', 'HKEY_CURRENT_USER') }], version: '8.36.2', scope: 'machine' },
    { detectionRules: [{ ...saved8x8Rule, keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\8x8_Work' }], version: '8.36.2', scope: 'machine' },
  ])('refuses ambiguous or non-marker-shaped saved rules', ({ detectionRules, version, scope }) => {
    expect(inferSavedCustomMarkerPath({
      detectionRules,
      wingetId: '8x8.Work',
      version,
      installScope: scope,
    })).toBeNull();
  });

  it('does not materialize an explicit config value for the default marker root', () => {
    expect(inferSavedCustomMarkerPath({
      detectionRules: [{
        ...saved8x8Rule,
        keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\8x8_Work',
      }],
      wingetId: '8x8.Work',
      version: '8.36.2',
      installScope: 'machine',
    })).toBeNull();
  });
});

describe('normalizeMarkerPath', () => {
  it('should return the default for undefined input', () => {
    expect(normalizeMarkerPath(undefined)).toBe('SOFTWARE\\IntuneGet\\Apps');
    expect(normalizeMarkerPath(undefined)).toBe(DEFAULT_REGISTRY_MARKER_PATH);
  });

  it('should return the default for null input', () => {
    expect(normalizeMarkerPath(null)).toBe(DEFAULT_REGISTRY_MARKER_PATH);
  });

  it('should return the default for empty or whitespace input', () => {
    expect(normalizeMarkerPath('')).toBe(DEFAULT_REGISTRY_MARKER_PATH);
    expect(normalizeMarkerPath('   ')).toBe(DEFAULT_REGISTRY_MARKER_PATH);
  });

  it('should pass through a clean custom path', () => {
    expect(normalizeMarkerPath('SOFTWARE\\Contoso\\Apps')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should trim surrounding whitespace', () => {
    expect(normalizeMarkerPath('  SOFTWARE\\Contoso\\Apps  ')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should strip leading and trailing backslashes', () => {
    expect(normalizeMarkerPath('\\SOFTWARE\\Contoso\\Apps\\')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should strip an accidental HKLM prefix', () => {
    expect(normalizeMarkerPath('HKLM\\SOFTWARE\\Contoso\\Apps')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should strip an accidental HKCU prefix case-insensitively', () => {
    expect(normalizeMarkerPath('hkcu\\Software\\Contoso')).toBe('Software\\Contoso');
  });

  it('should strip long hive prefixes with optional colon', () => {
    expect(normalizeMarkerPath('HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso')).toBe('SOFTWARE\\Contoso');
    expect(normalizeMarkerPath('HKEY_CURRENT_USER\\SOFTWARE\\Contoso')).toBe('SOFTWARE\\Contoso');
    expect(normalizeMarkerPath('HKLM:\\SOFTWARE\\Contoso')).toBe('SOFTWARE\\Contoso');
  });

  it('should return the default when only a hive prefix is provided', () => {
    expect(normalizeMarkerPath('HKLM\\')).toBe(DEFAULT_REGISTRY_MARKER_PATH);
    expect(normalizeMarkerPath('HKLM')).toBe(DEFAULT_REGISTRY_MARKER_PATH);
  });

  it('should collapse repeated backslashes', () => {
    expect(normalizeMarkerPath('SOFTWARE\\\\Contoso\\\\\\Apps')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should convert forward slashes to backslashes', () => {
    expect(normalizeMarkerPath('SOFTWARE/Contoso/Apps')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should remove characters invalid in registry key names', () => {
    expect(normalizeMarkerPath('SOFTWARE\\Con<to>so?\\Ap*ps|')).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should remove quotes to keep generated PowerShell safe', () => {
    expect(normalizeMarkerPath("SOFTWARE\\Con'toso\\\"Apps\"")).toBe('SOFTWARE\\Contoso\\Apps');
  });

  it('should drop empty segments created by sanitization', () => {
    expect(normalizeMarkerPath('SOFTWARE\\   \\Contoso')).toBe('SOFTWARE\\Contoso');
  });

  it('should normalize garbage hive prefix plus trailing slash', () => {
    expect(normalizeMarkerPath('HKLM\\SOFTWARE\\Contoso\\')).toBe('SOFTWARE\\Contoso');
  });
});

describe('rewriteMarkerKeyPath', () => {
  it('should rewrite a default marker keyPath to a custom root', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Google_Chrome',
        'Google_Chrome',
        'SOFTWARE\\Contoso\\Apps'
      )
    ).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Apps\\Google_Chrome');
  });

  it('should preserve the HKCU hive', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Publisher_App',
        'Publisher_App',
        'SOFTWARE\\Contoso\\Apps'
      )
    ).toBe('HKEY_CURRENT_USER\\SOFTWARE\\Contoso\\Apps\\Publisher_App');
  });

  it('should rewrite a previously customized root back to the default', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Apps\\Publisher_App',
        'Publisher_App',
        '',
        'SOFTWARE\\Contoso\\Apps'
      )
    ).toBe(`HKEY_LOCAL_MACHINE\\${DEFAULT_REGISTRY_MARKER_PATH}\\Publisher_App`);
  });

  it('should return null when the keyPath does not match the previous marker root', () => {
    // A rule under a custom root must not be rewritten when the previous
    // root was the default (e.g. a manually authored rule elsewhere)
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Apps\\Publisher_App',
        'Publisher_App',
        'SOFTWARE\\Fabrikam\\Apps'
      )
    ).toBeNull();
  });

  it('should not rewrite an unrelated key that ends with the sanitized id', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Google_Chrome',
        'Google_Chrome',
        'SOFTWARE\\Contoso\\Apps'
      )
    ).toBeNull();
  });

  it('should normalize the marker path before rewriting', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Publisher_App',
        'Publisher_App',
        'HKLM\\SOFTWARE\\Contoso\\'
      )
    ).toBe('HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Publisher_App');
  });

  it('should return null for a keyPath without a known hive', () => {
    expect(
      rewriteMarkerKeyPath('SOFTWARE\\IntuneGet\\Apps\\Publisher_App', 'Publisher_App', 'X')
    ).toBeNull();
  });

  it('should return null when the keyPath does not end with the sanitized id', () => {
    expect(
      rewriteMarkerKeyPath(
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\App',
        'Publisher_App',
        'SOFTWARE\\Contoso\\Apps'
      )
    ).toBeNull();
  });

  it('should return null when the keyPath is only hive plus id (no root)', () => {
    expect(
      rewriteMarkerKeyPath('HKEY_LOCAL_MACHINE\\Publisher_App', 'Publisher_App', 'X')
    ).toBeNull();
  });
});

describe('reconcileManagedMarkerDetectionRules', () => {
  it('moves a saved IntuneGet marker to the current user scope and version', () => {
    expect(
      reconcileManagedMarkerDetectionRules({
        detectionRules: [
          {
            type: 'registry',
            keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Asana_Asana',
            valueName: 'Version',
            check32BitOn64System: false,
            detectionType: 'version',
            operator: 'greaterThanOrEqual',
            detectionValue: '2.7.1',
          },
        ],
        wingetId: 'Asana.Asana',
        version: '2.8.0',
        installScope: 'user',
      })
    ).toEqual([
      {
        type: 'registry',
        keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Asana_Asana',
        valueName: 'Version',
        check32BitOn64System: false,
        detectionType: 'version',
        operator: 'greaterThanOrEqual',
        detectionValue: '2.8.0',
      },
    ]);
  });

  it('uses exact string detection for an opaque current version', () => {
    const [rule] = reconcileManagedMarkerDetectionRules({
      detectionRules: [
        {
          type: 'registry',
          keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\IntuneGet\\Apps\\Example_App',
          valueName: 'Version',
          detectionType: 'version',
          operator: 'greaterThanOrEqual',
          detectionValue: '1.0.0',
        },
      ],
      wingetId: 'Example.App',
      version: '2026.08-beta',
      installScope: 'machine',
    });

    expect(rule).toMatchObject({
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Example_App',
      detectionType: 'string',
      operator: 'equal',
      detectionValue: '2026.08-beta',
    });
  });

  it('reconciles the configured marker root without touching unrelated rules', () => {
    const unrelated = {
      type: 'registry' as const,
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Vendor\\Asana_Asana',
      valueName: 'Version',
      detectionType: 'version' as const,
      operator: 'greaterThanOrEqual' as const,
      detectionValue: '2.7.1',
    };
    const result = reconcileManagedMarkerDetectionRules({
      detectionRules: [
        unrelated,
        {
          type: 'registry',
          keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Contoso\\Apps\\Asana_Asana',
          valueName: 'Version',
          detectionType: 'version',
          operator: 'greaterThanOrEqual',
          detectionValue: '2.7.1',
        },
      ],
      wingetId: 'Asana.Asana',
      version: '2.8.0',
      installScope: 'user',
      markerPath: 'SOFTWARE\\Contoso\\Apps',
    });

    expect(result[0]).toBe(unrelated);
    expect(result[1]).toMatchObject({
      keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\Contoso\\Apps\\Asana_Asana',
      detectionValue: '2.8.0',
    });
  });

  it('preserves a manually authored value under the marker key', () => {
    const customRule = {
      type: 'registry' as const,
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Asana_Asana',
      valueName: 'Channel',
      detectionType: 'string' as const,
      operator: 'equal' as const,
      detectionValue: 'stable',
    };

    const [result] = reconcileManagedMarkerDetectionRules({
      detectionRules: [customRule],
      wingetId: 'Asana.Asana',
      version: '2.8.0',
      installScope: 'user',
    });

    expect(result).toBe(customRule);
  });
});
