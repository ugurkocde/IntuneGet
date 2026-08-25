import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted, so everything they close over has to be
// created inside vi.hoisted.
const h = vi.hoisted(() => {
  // A blocked id is still present in curated_apps, because the block row
  // references it, so the catalog lookup would otherwise answer
  // "already available in IntuneGet".
  const state: { blockRows: Array<{ winget_id: string; block_code: string }> } =
    { blockRows: [] };

  const catalogAppExists = vi.fn();
  const wingetExists = vi.fn();

  const client = {
    from(table: string) {
      if (table === 'package_eligibility_blocks') {
        const builder: Record<string, unknown> = {
          select: () => builder,
          in: () => builder,
          then: (
            onFulfilled: (value: unknown) => unknown,
            onRejected?: (reason: unknown) => unknown
          ) =>
            Promise.resolve({ data: state.blockRows, error: null }).then(
              onFulfilled,
              onRejected
            ),
        };
        return builder;
      }
      // app_suggestions duplicate lookup: no existing suggestion
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        single: () => Promise.resolve({ data: null, error: null }),
      };
      return builder;
    },
  };

  return { state, catalogAppExists, wingetExists, client };
});

vi.mock('@/lib/supabase', () => ({
  createServerClient: () => h.client,
  isSupabaseServerConfigured: () => true,
}));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn().mockResolvedValue(null),
  getIpKey: vi.fn(),
  getUserKey: vi.fn(),
  SUGGESTION_RATE_LIMIT: {},
  PUBLIC_RATE_LIMIT: {},
}));
vi.mock('@/lib/auth-utils', () => ({
  parseAccessToken: vi
    .fn()
    .mockResolvedValue({ userId: 'user-1', userEmail: 'user@example.com' }),
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSource: () => ({
    appExistsCaseInsensitive: h.catalogAppExists,
    findSimilarVerifiedApps: vi.fn().mockResolvedValue([]),
  }),
}));
vi.mock('@/lib/winget-existence', () => ({
  checkWingetPackageExists: h.wingetExists,
}));
vi.mock('@/lib/github-issues', () => ({
  createAppSuggestionIssue: vi.fn().mockResolvedValue(null),
}));

import { POST } from './route';

function request(wingetId: string) {
  return new NextRequest('http://localhost/api/community/suggestions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer token',
    },
    body: JSON.stringify({
      winget_id: wingetId,
      reason: 'We need this application for our standard desktop image.',
    }),
  });
}

describe('POST /api/community/suggestions eligibility gate', () => {
  it('refuses a request for an app blocked from automated deployment', async () => {
    h.state.blockRows = [
      {
        winget_id: 'WinSCP.WinSCP.Beta',
        block_code: 'unsupported_installer_source',
      },
    ];
    h.catalogAppExists.mockReset().mockResolvedValue({
      winget_id: 'WinSCP.WinSCP.Beta',
    });
    h.wingetExists.mockReset().mockResolvedValue('found');

    const response = await POST(request('WinSCP.WinSCP.Beta'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('PACKAGE_UNAVAILABLE');
    expect(body.wingetId).toBe('WinSCP.WinSCP.Beta');
    // The block must short-circuit before the catalog branch, otherwise the
    // caller is told the app is "already available".
    expect(h.catalogAppExists).not.toHaveBeenCalled();
  });

  it('leaves unblocked ids to the existing catalog and winget checks', async () => {
    h.state.blockRows = [];
    h.catalogAppExists.mockReset().mockResolvedValue({
      winget_id: 'Google.Chrome',
    });
    h.wingetExists.mockReset().mockResolvedValue('found');

    const response = await POST(request('Google.Chrome'));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBeUndefined();
    expect(body.error).toContain('already available in IntuneGet');
    expect(h.catalogAppExists).toHaveBeenCalled();
  });
});
