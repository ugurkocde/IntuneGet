import { describe, expect, it } from 'vitest';
import { generateDetectionRules } from '@/lib/detection-rules';
import { buildCartItemRequirementRules } from '@/lib/requirement-rules';
import type { ScriptDetectionRule } from '@/types/intune';
import type { PackageAssignment } from '@/types/upload';
import type { NormalizedInstaller } from '@/types/winget';
import { ADVERSARIAL_VALUES, char, pwshAvailable, summarizePowerShell } from './powershell-ast-helper';

const updateOnly: PackageAssignment[] = [{ type: 'allDevices', intent: 'updateOnly' }];

function requirementScript(displayName: string): string {
  const rule = buildCartItemRequirementRules(displayName, 'exe', undefined, updateOnly)?.[0];
  if (rule?.['@odata.type'] !== '#microsoft.graph.win32LobAppPowerShellScriptRule') {
    throw new Error('Expected a PowerShell script requirement rule');
  }
  return Buffer.from(rule.scriptContent, 'base64').toString('utf8');
}

function msixDetectionScript(packageFamilyName: string, scope: 'user' | 'machine' = 'machine'): string | null {
  const installer: NormalizedInstaller = {
    architecture: 'x64',
    url: 'https://example.com/app.msix',
    sha256: 'abc123',
    type: 'msix',
    scope,
    packageFamilyName,
  };
  const rule = generateDetectionRules(installer, 'Contoso App')[0];
  return rule.type === 'script' ? (rule as ScriptDetectionRule).scriptContent : null;
}

describe('requirement script display name encoding', () => {
  it('generates the unchanged script for an ordinary display name', () => {
    expect(requirementScript('Contoso App')).toBe([
      '# Requirement rule: Check if app is already installed on this device',
      '# App: Contoso App',
      '$ErrorActionPreference = "SilentlyContinue"',
      '',
      '$uninstallPaths = @(',
      '    "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
      '    "HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
      '    "HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"',
      ')',
      '',
      'foreach ($path in $uninstallPaths) {',
      '    $apps = Get-ItemProperty $path -ErrorAction SilentlyContinue |',
      "        Where-Object { $_.DisplayName -like '*Contoso App*' }",
      '    if ($apps) {',
      '        Write-Output "True"',
      '        exit 0',
      '    }',
      '}',
      '',
      'Write-Output "False"',
      'exit 0',
    ].join('\r\n'));
  });

  it('keeps every script ASCII so Windows PowerShell reads it the same in any code page', () => {
    for (const value of ADVERSARIAL_VALUES) {
      expect(requirementScript(`App ${value}`), JSON.stringify(value)).toMatch(/^[\x00-\x7F]*$/);
    }
  });

  it.runIf(pwshAvailable)('embeds adversarial display names without changing the script structure', () => {
    const asciiValues = ADVERSARIAL_VALUES.filter((value) => /^[\x20-\x7E]*$/.test(value));
    const [baseline, ...summaries] = summarizePowerShell([
      requirementScript('Contoso App'),
      ...asciiValues.map((value) => requirementScript(`App ${value}`)),
    ]);
    asciiValues.forEach((value, index) => {
      const summary = summaries[index];
      expect(summary.errors, JSON.stringify(value)).toEqual([]);
      expect(summary.shape, JSON.stringify(value)).toEqual(baseline.shape);
      expect(summary.comments.length, JSON.stringify(value)).toBe(baseline.comments.length);
      expect(summary.strings).toContain(`*App ${value}*`);
    });

    // Non-ASCII and control characters use a base64 expression instead of a literal.
    const otherValues = ADVERSARIAL_VALUES.filter((value) => !/^[\x20-\x7E]*$/.test(value));
    const sources = otherValues.map((value) => requirementScript(`App ${value}`));
    const [unicodeBaseline, ...unicodeSummaries] = summarizePowerShell([
      requirementScript(`Caf${char(0xe9)}`),
      ...sources,
    ]);
    otherValues.forEach((value, index) => {
      const summary = unicodeSummaries[index];
      expect(summary.errors, JSON.stringify(value)).toEqual([]);
      expect(summary.shape, JSON.stringify(value)).toEqual(unicodeBaseline.shape);
      expect(summary.comments.length, JSON.stringify(value)).toBe(unicodeBaseline.comments.length);
      const encoded = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(sources[index])?.[1];
      expect(Buffer.from(encoded ?? '', 'base64').toString('utf8')).toBe(`*App ${value}*`);
    });
  }, 120_000);
});

describe('MSIX detection script package name encoding', () => {
  it('generates the unchanged script for an ordinary package family name', () => {
    expect(msixDetectionScript('Microsoft.VSCode_8wekyb3d8bbwe')).toBe([
      '# MSIX Detection Script',
      '# Package Family Name: Microsoft.VSCode_8wekyb3d8bbwe',
      '',
      '$ErrorActionPreference = "SilentlyContinue"',
      '$package = Get-AppxPackage -Name "Microsoft.VSCode" -AllUsers',
      'if (-not $package) { $package = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq "Microsoft.VSCode" } }',
      'if ($package) {',
      '    Write-Output "Installed"',
      '    exit 0',
      '}',
      'exit 1',
    ].join('\n'));
  });

  it('falls back to folder detection for a package family name that is not printable ASCII', () => {
    expect(msixDetectionScript(`Contoso.App${char(0x451)}_8wekyb3d8bbwe`)).toBeNull();
    expect(msixDetectionScript(`Contoso.App${char(0x0a)}x_8wekyb3d8bbwe`)).toBeNull();
  });

  it.runIf(pwshAvailable)('embeds adversarial package names without changing the script structure', () => {
    const asciiValues = ADVERSARIAL_VALUES.filter((value) => /^[\x20-\x7E]+$/.test(value) && !value.includes('_'));
    for (const scope of ['machine', 'user'] as const) {
      const [baseline, ...summaries] = summarizePowerShell([
        msixDetectionScript('Contoso.App_8wekyb3d8bbwe', scope)!,
        ...asciiValues.map((value) => msixDetectionScript(`Contoso ${value}_8wekyb3d8bbwe`, scope)!),
      ]);
      asciiValues.forEach((value, index) => {
        const summary = summaries[index];
        expect(summary.errors, JSON.stringify(value)).toEqual([]);
        expect(summary.shape, JSON.stringify(value)).toEqual(baseline.shape);
        expect(summary.comments.length, JSON.stringify(value)).toBe(baseline.comments.length);
        expect(summary.strings).toContain(`Contoso ${value}`);
      });
    }
  }, 120_000);
});
