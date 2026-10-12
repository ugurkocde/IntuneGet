import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { buildCartItemRequirementRules } from '@/lib/requirement-rules';
import type { PackageAssignment } from '@/types/upload';

const updateOnlyAssignments: PackageAssignment[] = [
  { type: 'allDevices', intent: 'updateOnly' },
];

describe('buildCartItemRequirementRules', () => {
  it('builds an MSI registry requirement from the product code', () => {
    const rules = buildCartItemRequirementRules(
      'Contoso App',
      'msi',
      '{PRODUCT-CODE}',
      updateOnlyAssignments
    );

    expect(rules).toEqual([
      expect.objectContaining({
        '@odata.type': '#microsoft.graph.win32LobAppRegistryRule',
        ruleType: 'requirement',
        keyPath: expect.stringContaining('{PRODUCT-CODE}'),
        operationType: 'exists',
      }),
    ]);
  });

  it('builds an uninstall-registry script requirement for an EXE', () => {
    const rules = buildCartItemRequirementRules(
      'Contoso App',
      'exe',
      undefined,
      updateOnlyAssignments
    );
    const scriptRule = rules?.[0];

    expect(scriptRule?.['@odata.type']).toBe(
      '#microsoft.graph.win32LobAppPowerShellScriptRule'
    );
    if (scriptRule?.['@odata.type'] !== '#microsoft.graph.win32LobAppPowerShellScriptRule') {
      throw new Error('Expected a PowerShell script requirement rule');
    }
    expect(Buffer.from(scriptRule.scriptContent, 'base64').toString('utf8')).toContain(
      "DisplayName -like '*Contoso App*'"
    );
  });

  it('returns undefined when no assignment is updateOnly', () => {
    expect(
      buildCartItemRequirementRules('Contoso App', 'exe', undefined, [
        { type: 'allDevices', intent: 'required' },
      ])
    ).toBeUndefined();
  });
});
