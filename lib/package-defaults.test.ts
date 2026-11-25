import { expect, it } from 'vitest';
import { applyPackageDefaults, pickPackageDefaults, sanitizePackageDefaults } from './package-defaults';
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

it('saves only the progress dialog toggle, including an explicit false', () => {
  for (const enabled of [true, false]) {
    const saved = pickPackageDefaults({
      ...DEFAULT_PSADT_CONFIG,
      progressDialog: { enabled, statusMessage: 'Package specific', windowLocation: 'Top' },
    });
    expect(saved?.progressDialog).toEqual({ enabled });
    expect(sanitizePackageDefaults(JSON.parse(JSON.stringify(saved)))?.progressDialog).toEqual({ enabled });
  }
});

it('rejects malformed progress toggles and excludes other progress fields', () => {
  expect(sanitizePackageDefaults({ progressDialog: { enabled: 'true', statusMessage: 'private' } })).toBeNull();
  expect(sanitizePackageDefaults({ progressDialog: ['enabled'] })).toBeNull();
  expect(sanitizePackageDefaults({ progressDialog: { statusMessage: 'private' } })).toBeNull();
  expect(() => pickPackageDefaults({ ...DEFAULT_PSADT_CONFIG, progressDialog: { enabled: 'true' } } as never)).toThrow('progressDialog');
});

it('applies the saved toggle without replacing package specific progress details', () => {
  const config = { ...DEFAULT_PSADT_CONFIG, progressDialog: { enabled: false, statusMessage: 'This package', windowLocation: 'Bottom' as const } };
  const saved = sanitizePackageDefaults({ progressDialog: { enabled: true, statusMessage: 'Ignore' } });
  const applied = applyPackageDefaults(config, saved);
  expect(applied.progressDialog).toEqual({ enabled: true, statusMessage: 'This package', windowLocation: 'Bottom' });
  expect(config.progressDialog.enabled).toBe(false);
  expect(applyPackageDefaults(applied, sanitizePackageDefaults({ progressDialog: { enabled: false } })).progressDialog.enabled).toBe(false);
  expect(applyPackageDefaults(config, null)).toBe(config);
});
