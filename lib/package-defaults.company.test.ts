import { expect, it } from 'vitest';
import { applyPackageDefaults, pickPackageDefaults, sanitizePackageDefaults } from './package-defaults';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';

it('round trips personal company text without retaining asset references', () => {
  const brandingCompanyName = "Acme ' $env:USER ` $(example) ‘team’";
  expect(sanitizePackageDefaults({ brandingCompanyName, brandingLogoPath: 'https://example.test/logo.png' })).toEqual({ brandingCompanyName });
  expect(pickPackageDefaults({ ...DEFAULT_PSADT_CONFIG, brandingCompanyName })).toMatchObject({ brandingCompanyName });
});

it('inherits company only when absent and preserves explicit package values including blank', () => {
  const defaults = { brandingCompanyName: 'Personal company' } as never;
  expect(applyPackageDefaults(DEFAULT_PSADT_CONFIG, defaults).brandingCompanyName).toBe('Personal company');
  for (const brandingCompanyName of ['', 'Package company']) {
    expect(applyPackageDefaults({ ...DEFAULT_PSADT_CONFIG, brandingCompanyName }, defaults).brandingCompanyName).toBe(brandingCompanyName);
  }
});

it('keeps explicit company clear without erasing other defaults', () => {
  expect(sanitizePackageDefaults({ brandingCompanyName: '', allowDefer: false })).toEqual({ brandingCompanyName: '', allowDefer: false });
  expect(sanitizePackageDefaults(null)).toBeNull();
});

it.each(['a'.repeat(129), '\nprivate', '\u202Eprivate', '\u200Bprivate', '\ud800', '\udfff'])('rejects invalid company text without echoing it: %j', (brandingCompanyName) => {
  expect(sanitizePackageDefaults({ brandingCompanyName })).toBeNull();
  expect(() => pickPackageDefaults({ ...DEFAULT_PSADT_CONFIG, brandingCompanyName })).toThrow('brandingCompanyName');
  try { pickPackageDefaults({ ...DEFAULT_PSADT_CONFIG, brandingCompanyName }); } catch (error) {
    expect((error as Error).message).not.toContain(brandingCompanyName);
  }
});

it('accepts bounded Unicode company text', () => {
  for (const brandingCompanyName of ['a'.repeat(128), 'München 株式会社', 'Example 🏢']) {
    expect(sanitizePackageDefaults({ brandingCompanyName })).toEqual({ brandingCompanyName });
  }
});
