import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuthorizedCronRequest, isBearerSecret } from './cron-auth';

const request = (authorization?: string) => new Request('https://example.test/api/cron/fixture', {
  headers: authorization === undefined ? {} : { authorization },
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('isAuthorizedCronRequest', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])('rejects every request when CRON_SECRET is %s', (_label, value) => {
    vi.stubEnv('CRON_SECRET', value);
    expect(isAuthorizedCronRequest(request())).toBe(false);
    expect(isAuthorizedCronRequest(request('Bearer undefined'))).toBe(false);
    expect(isAuthorizedCronRequest(request('Bearer '))).toBe(false);
    expect(isAuthorizedCronRequest(request('Bearer'))).toBe(false);
    expect(isAuthorizedCronRequest(request('Bearer null'))).toBe(false);
    expect(isAuthorizedCronRequest(request(''))).toBe(false);
  });

  it('accepts only the exact configured secret', () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    expect(isAuthorizedCronRequest(request('Bearer correct-secret'))).toBe(true);

    expect(isAuthorizedCronRequest(request())).toBe(false);
    expect(isAuthorizedCronRequest(request('Bearer undefined'))).toBe(false);
    // Same length as the real value
    expect(isAuthorizedCronRequest(request('Bearer correct-secreT'))).toBe(false);
    expect(isAuthorizedCronRequest(request('Bearer xorrect-secret'))).toBe(false);
    // Different length
    expect(isAuthorizedCronRequest(request('Bearer correct-secret-and-more'))).toBe(false);
    expect(isAuthorizedCronRequest(request('Bearer correct'))).toBe(false);
    // Scheme and bare value
    expect(isAuthorizedCronRequest(request('bearer correct-secret'))).toBe(false);
    expect(isAuthorizedCronRequest(request('Basic correct-secret'))).toBe(false);
    expect(isAuthorizedCronRequest(request('correct-secret'))).toBe(false);
  });

  it('reads the header regardless of its casing', () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const upper = new Request('https://example.test/', { headers: { Authorization: 'Bearer correct-secret' } });
    expect(isAuthorizedCronRequest(upper)).toBe(true);
  });

  it('compares multi-byte secrets by bytes without throwing', () => {
    vi.stubEnv('CRON_SECRET', 'sécret');
    // Same character count, different byte length
    expect(isBearerSecret('Bearer secret', 'sécret')).toBe(false);
    expect(isBearerSecret('Bearer sécret', 'sécret')).toBe(true);
  });
});

describe('isBearerSecret', () => {
  it('fails closed without a secret', () => {
    expect(isBearerSecret('Bearer undefined', undefined)).toBe(false);
    expect(isBearerSecret('Bearer ', '')).toBe(false);
    expect(isBearerSecret(null, undefined)).toBe(false);
  });

  it('requires the header', () => {
    expect(isBearerSecret(null, 'secret')).toBe(false);
    expect(isBearerSecret('', 'secret')).toBe(false);
  });

  it('accepts the matching bearer value only', () => {
    expect(isBearerSecret('Bearer secret', 'secret')).toBe(true);
    expect(isBearerSecret('Bearer secreT', 'secret')).toBe(false);
  });
});
