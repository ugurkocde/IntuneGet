import { describe, expect, it } from 'vitest';
import { normalizeCatalogDetectionRules } from './catalog-detection';
import { generateDetectionRules } from './detection-rules';
import type { ScriptDetectionRule } from '@/types/intune';
import type { WingetScope } from '@/types/winget';

function msixRule(scope: WingetScope): ScriptDetectionRule {
  const [rule] = generateDetectionRules({
    type: 'msix',
    architecture: 'x64',
    url: 'https://fixture.invalid/package.msix',
    sha256: 'A'.repeat(64),
    packageFamilyName: 'Agilebits.1Password_amwd9z03whsfe',
    scope,
  }, '1Password');
  if (rule.type !== 'script') throw new Error('Expected generated MSIX script');
  return rule;
}

function normalizeMsix(rule: ScriptDetectionRule, scope: string) {
  return normalizeCatalogDetectionRules({
    detectionRules: [rule],
    wingetId: 'AgileBits.1Password',
    version: '8.12.42.36',
    installerType: 'msix',
    installScope: scope,
  });
}

describe('catalog detection normalization', () => {
  it.each([
    ['machine', 'user'],
    ['user', 'machine'],
  ] as const)('respects %s to %s install scope for an exact generated MSIX rule', (original, scope) => {
    expect(normalizeMsix(msixRule(original), scope)).toEqual([msixRule(scope)]);
  });

  it.each(['machine', 'user'] as const)('keeps the exact %s scope rule byte-identical', (scope) => {
    const rule = msixRule(scope);
    const result = normalizeMsix(rule, scope);
    expect(result).toEqual([rule]);
    expect(result[0]).toBe(rule);
  });

  it.each(['machine', 'user'] as const)('preserves a header lookalike with an edited body under %s scope', (scope) => {
    const rule = { ...msixRule(scope === 'user' ? 'machine' : 'user'), scriptContent: msixRule('machine').scriptContent + '\n# Customer customization' };
    expect(normalizeMsix(rule, scope)[0]).toBe(rule);
  });

  it.each([
    { label: 'CRLF', change: (rule: ScriptDetectionRule) => ({ ...rule, scriptContent: rule.scriptContent.replace(/\n/g, '\r\n') }) },
    { label: 'trailing newline', change: (rule: ScriptDetectionRule) => ({ ...rule, scriptContent: rule.scriptContent + '\n' }) },
    { label: '32-bit setting', change: (rule: ScriptDetectionRule) => ({ ...rule, runAs32Bit: true }) },
    { label: 'signature setting', change: (rule: ScriptDetectionRule) => ({ ...rule, enforceSignatureCheck: true }) },
    { label: 'missing setting', change: (rule: ScriptDetectionRule) => { const copy = { ...rule }; delete copy.runAs32Bit; return copy; } },
    { label: 'extra setting', change: (rule: ScriptDetectionRule) => ({ ...rule, customSetting: false }) },
  ])('preserves a generated-looking script with $label', ({ change }) => {
    const rule = change(msixRule('machine'));
    expect(normalizeMsix(rule, 'user')[0]).toBe(rule);
  });

  it('corrects an exact generated MSIX rule on the fallback path', () => {
    expect(normalizeCatalogDetectionRules({
      detectionRules: [null],
      fallbackDetectionRules: [msixRule('machine')],
      wingetId: 'AgileBits.1Password',
      version: '8.12.42.36',
      installerType: 'appx',
      installScope: 'user',
    })).toEqual([msixRule('user')]);
  });

  it('uses machine semantics for a whitespace-padded user scope', () => {
    const rule = msixRule('machine');
    expect(normalizeMsix(rule, ' user')[0]).toBe(rule);
    expect(normalizeMsix(msixRule('user'), ' user')).toEqual([rule]);
  });

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

  it('replaces a generated MSIX rule after the catalog installer changes to MSI', () => {
    const staleMsixRule = {
      type: 'script' as const,
      scriptContent: [
        '# MSIX Detection Script',
        '# Package Family Name: Agilebits.1Password_amwd9z03whsfe',
        'exit 0',
      ].join('\n'),
      enforceSignatureCheck: false,
      runAs32Bit: false,
    };

    expect(normalizeCatalogDetectionRules({
      detectionRules: [staleMsixRule],
      fallbackDetectionRules: [staleMsixRule],
      wingetId: 'AgileBits.1Password',
      version: '8.12.30.21',
      installScope: 'machine',
      installerType: 'msi',
    })).toEqual([expect.objectContaining({
      type: 'registry',
      keyPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\IntuneGet\\Apps\\AgileBits_1Password',
      detectionValue: '8.12.30.21',
    })]);
  });

  it('keeps a generated MSIX rule for an MSIX-family installer', () => {
    const generatedRule = {
      type: 'script' as const,
      scriptContent: [
        '# MSIX Detection Script',
        '# Package Family Name: Example.App_123',
        'exit 0',
      ].join('\n'),
      enforceSignatureCheck: false,
      runAs32Bit: false,
    };

    expect(normalizeCatalogDetectionRules({
      detectionRules: [generatedRule],
      wingetId: 'Example.App',
      version: '1.0.0',
      installerType: 'msix',
    })).toEqual([generatedRule]);
  });

  it('does not discard a customer-authored script for an MSI installer', () => {
    const customScript = {
      type: 'script' as const,
      scriptContent: 'if (Test-Path $env:ProgramFiles\\Example) { exit 0 }; exit 1',
      enforceSignatureCheck: false,
      runAs32Bit: false,
    };

    expect(normalizeCatalogDetectionRules({
      detectionRules: [customScript],
      wingetId: 'Example.App',
      version: '1.0.0',
      installerType: 'msi',
    })).toEqual([customScript]);
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

  it('uses valid fallback rules when the primary legacy list is malformed', () => {
    const fileRule = {
      type: 'file' as const,
      path: '%ProgramFiles%\\Example',
      fileOrFolderName: 'Example.exe',
      detectionType: 'exists' as const,
    };
    const result = normalizeCatalogDetectionRules({
      detectionRules: [null, {}],
      fallbackDetectionRules: [fileRule],
      wingetId: 'Example.App',
      version: '1.0.0',
    });

    expect(result).toEqual([fileRule]);
  });

  it('prefers valid primary rules when both sources are usable', () => {
    const primaryRule = {
      type: 'file' as const,
      path: '%ProgramFiles%\\Primary',
      fileOrFolderName: 'Primary.exe',
      detectionType: 'exists' as const,
    };
    const fallbackRule = {
      type: 'file' as const,
      path: '%ProgramFiles%\\Fallback',
      fileOrFolderName: 'Fallback.exe',
      detectionType: 'exists' as const,
    };
    const result = normalizeCatalogDetectionRules({
      detectionRules: [primaryRule],
      fallbackDetectionRules: [fallbackRule],
      wingetId: 'Example.App',
      version: '1.0.0',
    });

    expect(result).toEqual([primaryRule]);
    expect(result[0]).toBe(primaryRule);
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
