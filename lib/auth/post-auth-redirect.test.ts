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
  ])('rejects unsafe redirect value %s', (value) => {
    expect(getSafeInternalRedirect(value)).toBe('/dashboard');
  });

  it('uses a safe fallback for missing values', () => {
    expect(getSafeInternalRedirect(null, '/dashboard/apps')).toBe('/dashboard/apps');
  });
});
