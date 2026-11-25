import { describe, expect, it } from 'vitest';
import { normalizeQaPsadtConfig, splitQaPsadtConfig, canonicalQaJson, qaSha256 } from './package-profile';
import type { PSADTConfig } from '@/types/psadt';
describe('author PowerShell hook execution identity', () => {
  const baseline = normalizeQaPsadtConfig(undefined, []);
  for (const field of ['postInstallPowerShell', 'postUninstallPowerShell'] as const) {
    it.each(['', ' \t\r\n'])('omits an empty ' + field + ' without changing the baseline profile (%j)', (text) => {
      const config = normalizeQaPsadtConfig({ [field]: text } as Partial<PSADTConfig>, []);
      expect(canonicalQaJson(config)).toBe(canonicalQaJson(baseline));
      expect(Object.hasOwn(config, field)).toBe(false);
    });
    it('binds exact nonempty ' + field + ' to execution without changing presentation', () => {
      const text = "  Write-ADTLogEntry -Message 'synthetic fixture'\r\n";
      const config = normalizeQaPsadtConfig({ [field]: text } as Partial<PSADTConfig>, []);
      const before = splitQaPsadtConfig(baseline);
      const after = splitQaPsadtConfig(config);
      expect(config[field]).toBe(text);
      expect(qaSha256(canonicalQaJson(after.execution))).not.toBe(qaSha256(canonicalQaJson(before.execution)));
      expect(after.presentation).toEqual(before.presentation);
      expect(baseline).not.toHaveProperty(field);
    });
  }
});
