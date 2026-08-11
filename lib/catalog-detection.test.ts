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

  it('drops malformed legacy entries and repairs the resulting empty rule list', () => {
    const result = normalizeCatalogDetectionRules({
      detectionRules: [null, {}, { type: 'registry', keyPath: '' }],
      wingetId: 'Legacy.App',
      version: '1.0.0',
      installScope: 'machine',
    });

    expect(result).toEqual([expect.objectContaining({
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Legacy_App',
      detectionValue: '1.0.0',
    })]);
  });

  it.each([
    { wingetId: '', version: '1.0.0', message: 'non-empty Winget ID' },
    { wingetId: 'Example.App', version: '   ', message: 'non-empty version' },
  ])('fails closed for a missing catalog identity', ({ wingetId, version, message }) => {
    expect(() => normalizeCatalogDetectionRules({
      detectionRules: [],
      wingetId,
      version,
    })).toThrow(message);
  });

  it('matches packager scope semantics for whitespace-padded values', () => {
    const result = normalizeCatalogDetectionRules({
      detectionRules: [],
      wingetId: 'Example.App',
      version: '1.0.0',
      installScope: ' user ',
    });

    expect(result[0]).toMatchObject({
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\Example_App',
    });
  });
});
