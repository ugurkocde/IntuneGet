import { describe, expect, it } from 'vitest';
import { normalizeCatalogDetectionRules } from './catalog-detection';

describe('catalog detection normalization', () => {
  it('repairs an empty legacy profile with a machine-scoped managed marker', () => {
    expect(normalizeCatalogDetectionRules({
      detectionRules: [],
      wingetId: 'Anysphere.Cursor',
      version: '3.14.27',
      installScope: 'machine',
    })).toEqual([{
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Anysphere_Cursor',
      valueName: 'Version',
      check32BitOn64System: false,
      detectionType: 'version',
      operator: 'greaterThanOrEqual',
      detectionValue: '3.14.27',
    }]);
  });

  it('uses the current user scope and marker root for a missing rule', () => {
    expect(normalizeCatalogDetectionRules({
      detectionRules: undefined,
      wingetId: 'Example.App',
      version: '2026.08-beta',
      installScope: 'user',
      markerPath: 'SOFTWARE\\Contoso\\Apps',
    })).toEqual([expect.objectContaining({
      keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\Contoso\\Apps\\Example_App',
      detectionType: 'string',
      operator: 'equal',
      detectionValue: '2026.08-beta',
    })]);
  });

  it('preserves a nonempty customer rule while reconciling managed markers', () => {
    const customRule = {
      type: 'file' as const,
      path: '%ProgramFiles%\\Example',
      fileOrFolderName: 'Example.exe',
      detectionType: 'exists' as const,
    };
    const result = normalizeCatalogDetectionRules({
      detectionRules: [customRule],
      wingetId: 'Example.App',
      version: '1.0.0',
      installScope: 'machine',
    });

    expect(result).toEqual([customRule]);
    expect(result[0]).toBe(customRule);
  });
});
