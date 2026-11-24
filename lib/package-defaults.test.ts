import { expect, it } from 'vitest';
import { pickPackageDefaults } from './package-defaults';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

it('rejects an invalid countdown rather than reporting a partial defaults save', () => {
  expect(() => pickPackageDefaults({ ...DEFAULT_PSADT_CONFIG, closeCountdown: Number.NaN })).toThrow('invalid value');
  expect(() => pickPackageDefaults({ ...DEFAULT_PSADT_CONFIG, restartPrompt: { enabled: true, countdownSeconds: 5, countdownNoHideSeconds: 60 } })).toThrow('invalid value');
});

it('allows unset optional defaults while excluding package specific and verification choices', () => {
  const value = pickPackageDefaults({ ...DEFAULT_PSADT_CONFIG, deferDays: undefined, verifyInstall: false, installCommand: 'example', processesToClose: [{ name: 'example', description: 'Example' }] });
  expect(value).not.toHaveProperty('verifyInstall');
  expect(value).not.toHaveProperty('installCommand');
  expect(value).not.toHaveProperty('processesToClose');
});

it('ignores disabled invalid deferral fields but names invalid enabled fields', () => {
  expect(pickPackageDefaults({ ...DEFAULT_PSADT_CONFIG, allowDefer: false, deferTimes: 100, deferDays: 0 })).not.toHaveProperty('deferTimes');
  expect(() => pickPackageDefaults({ ...DEFAULT_PSADT_CONFIG, allowDefer: true, deferTimes: 100 })).toThrow('deferTimes');
  expect(() => pickPackageDefaults({ ...DEFAULT_PSADT_CONFIG, allowDefer: true, deferDays: 0 })).toThrow('deferDays');
});
