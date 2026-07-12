import { describe, expect, it } from 'vitest';
import { getSafeInternalRedirect } from './post-auth-redirect';

describe('getSafeInternalRedirect', () => {
  it('keeps an internal deployment intent with its query string', () => {
    expect(
      getSafeInternalRedirect('/dashboard/apps?deploy=Google.Chrome'),
    ).toBe('/dashboard/apps?deploy=Google.Chrome');
  });

  it('keeps encoded Microsoft Store package IDs', () => {
    expect(
      getSafeInternalRedirect('/dashboard/apps?deploy=9WZDNCRFJ3PZ'),
    ).toBe('/dashboard/apps?deploy=9WZDNCRFJ3PZ');
  });

  it.each([
    'https://evil.example/dashboard',
    '//evil.example/dashboard',
    '/\\evil.example/dashboard',
    'javascript:alert(1)',
    '/..//evil.example',
    '/a/..//evil.example',
    '/\t/evil.example',
  ])('rejects unsafe redirect value %s', (value) => {
    expect(getSafeInternalRedirect(value)).toBe('/dashboard');
  });

  it('keeps percent-encoded characters as an internal path without decoding', () => {
    expect(getSafeInternalRedirect('/%2F%2Fevil.example')).toBe('/%2F%2Fevil.example');
    expect(getSafeInternalRedirect('/%5C%5Cevil.example')).toBe('/%5C%5Cevil.example');
  });

  it('uses a safe fallback for missing values', () => {
    expect(getSafeInternalRedirect(null, '/dashboard/apps')).toBe('/dashboard/apps');
  });

  it('falls back to the default when the fallback itself is unsafe', () => {
    expect(getSafeInternalRedirect(null, '//evil.example')).toBe('/dashboard');
  });
});
