/**
 * Tests for parseAccessToken / verifyTokenWithGraph in lib/auth-utils.ts
 *
 * Critical security contract under test:
 *   - A forged JWT (valid structure, fake claims, no real signature) MUST be
 *     rejected because Microsoft Graph will refuse it.
 *   - Only tokens that Microsoft Graph accepts are trusted.
 *   - Verified results are cached so Graph is not called a second time for
 *     the same token.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock fetch globally before importing the module under test ────────────────

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ── Mock jose so we can control what decodeJwt returns ───────────────────────

vi.mock('jose', () => ({
  decodeJwt: vi.fn(),
}));

import { decodeJwt } from 'jose';
import { parseAccessToken } from '../auth-utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a syntactically valid 3-part JWT string (payload is not real). */
function fakeJwt(payload: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = 'fakesignature';
  return `${header}.${body}.${sig}`;
}

/** Resolve an expiry timestamp (seconds) N minutes from now. */
function expIn(minutes: number): number {
  return Math.floor(Date.now() / 1000) + minutes * 60;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('parseAccessToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Input validation ────────────────────────────────────────────────────────

  it('returns null when authHeader is null', async () => {
    expect(await parseAccessToken(null)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when authHeader does not start with "Bearer "', async () => {
    expect(await parseAccessToken('Basic abc123')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null for a token that is not a 3-part JWT', async () => {
    expect(await parseAccessToken('Bearer notajwt')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── CRITICAL: forged / invalid tokens must be rejected ─────────────────────

  it('rejects a forged JWT whose signature Microsoft Graph does not accept', async () => {
    const forgedToken = fakeJwt({ oid: 'victim-user', tid: 'victim-tenant', exp: expIn(60) });

    // Simulate Microsoft Graph rejecting the token (401 Unauthorized)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });

    const result = await parseAccessToken(`Bearer ${forgedToken}`);

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('graph.microsoft.com/v1.0/me'),
      expect.objectContaining({ headers: { Authorization: `Bearer ${forgedToken}` } })
    );
  });

  it('rejects an expired token that Microsoft Graph refuses', async () => {
    const expiredToken = fakeJwt({ oid: 'user-1', tid: 'tenant-1', exp: expIn(-10) });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });

    expect(await parseAccessToken(`Bearer ${expiredToken}`)).toBeNull();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('returns verified user info when Graph accepts the token', async () => {
    const token = fakeJwt({ oid: 'user-abc', tid: 'tenant-xyz', exp: expIn(60) });

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'user-abc',
        displayName: 'Alice',
        userPrincipalName: 'alice@contoso.com',
        mail: null,
      }),
    });

    vi.mocked(decodeJwt).mockReturnValueOnce({
      tid: 'tenant-xyz',
      exp: expIn(60),
    } as ReturnType<typeof decodeJwt>);

    const result = await parseAccessToken(`Bearer ${token}`);

    expect(result).toEqual({
      userId: 'user-abc',
      userEmail: 'alice@contoso.com',
      tenantId: 'tenant-xyz',
      userName: 'Alice',
    });
  });

  // ── Caching ─────────────────────────────────────────────────────────────────

  it('does not call Graph a second time for the same token (cache hit)', async () => {
    // Use a unique token so previous test's cache entry doesn't interfere.
    const token = fakeJwt({ oid: 'user-cache', tid: 'tenant-cache', exp: expIn(60), _unique: 'cache-test' });

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'user-cache',
        displayName: 'Bob',
        userPrincipalName: 'bob@contoso.com',
        mail: null,
      }),
    });

    vi.mocked(decodeJwt).mockReturnValue({
      tid: 'tenant-cache',
      exp: expIn(60),
    } as ReturnType<typeof decodeJwt>);

    const first = await parseAccessToken(`Bearer ${token}`);
    const second = await parseAccessToken(`Bearer ${token}`);

    expect(first).toEqual(second);
    // Graph should only have been called once despite two parseAccessToken calls.
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
