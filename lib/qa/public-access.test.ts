import { afterEach, describe, expect, it, vi } from 'vitest';
import { isQaLivePublicEnabled } from './public-access';

describe('public QA access policy', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('allows the canonical production host when no override exists', () => {
    vi.stubEnv('QA_LIVE_PUBLIC_ENABLED', undefined);
    expect(isQaLivePublicEnabled('www.intuneget.com')).toBe(true);
  });

  it('keeps non-canonical self-hosts disabled by default', () => {
    vi.stubEnv('QA_LIVE_PUBLIC_ENABLED', undefined);
    expect(isQaLivePublicEnabled('localhost:3000')).toBe(false);
    expect(isQaLivePublicEnabled('intuneget.internal')).toBe(false);
  });

  it('honors explicit operator overrides before hostname defaults', () => {
    vi.stubEnv('QA_LIVE_PUBLIC_ENABLED', 'false');
    expect(isQaLivePublicEnabled('www.intuneget.com')).toBe(false);
    vi.stubEnv('QA_LIVE_PUBLIC_ENABLED', 'true');
    expect(isQaLivePublicEnabled('localhost:3000')).toBe(true);
  });
});
