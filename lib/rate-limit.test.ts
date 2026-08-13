import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getIpKey } from './rate-limit';

describe('getIpKey', () => {
  it('prefers the trusted edge peer address', () => {
    const request = new Request('https://example.com', {
      headers: {
        'x-real-ip': '203.0.113.10',
        'x-forwarded-for': '198.51.100.1, 192.0.2.20',
      },
    });
    expect(getIpKey(request)).toBe('ip:203.0.113.10');
  });

  it('uses the last forwarded hop instead of a client-controlled first hop', () => {
    const request = new Request('https://example.com', {
      headers: { 'x-forwarded-for': '198.51.100.1, 192.0.2.20' },
    });
    expect(getIpKey(request)).toBe('ip:192.0.2.20');
  });
});
