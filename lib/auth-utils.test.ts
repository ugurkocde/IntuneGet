import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseAccessToken, signConsentState, verifyConsentState } from './auth-utils';

const CLIENT_ID = '11111111-aaaa-4bbb-8ccc-222222222222';
const TENANT_ID = '33333333-aaaa-4bbb-8ccc-444444444444';
const GLOBAL_ADMIN = '62e90394-69f5-4237-9190-012177145e10';

let counter = 0;

/** An unsigned token with the given claims. Graph is mocked, so only the payload matters. */
function token(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  // A unique jti keeps the in-process verification cache from mixing tests.
  const payload = { tid: TENANT_ID, exp: Math.floor(Date.now() / 1000) + 3600, jti: `t-${counter++}`, ...claims };
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

function graphAccepts() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ id: 'user-1', displayName: 'Alex Admin', userPrincipalName: 'alex@contoso.example' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  );
}

describe('parseAccessToken', () => {
  beforeEach(() => {
    vi.stubEnv('AZURE_CLIENT_ID', '');
    vi.stubEnv('AZURE_AD_CLIENT_ID', '');
    vi.stubEnv('ALLOWED_TOKEN_CLIENT_IDS', '');
    vi.stubEnv('NEXT_PUBLIC_AZURE_AD_CLIENT_ID', CLIENT_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('accepts a token issued to this app (v1.0 appid)', async () => {
    vi.stubGlobal('fetch', graphAccepts());
    const user = await parseAccessToken(`Bearer ${token({ appid: CLIENT_ID })}`);
    expect(user).toMatchObject({ userId: 'user-1', tenantId: TENANT_ID, userEmail: 'alex@contoso.example' });
  });

  it('accepts a token issued to this app (v2.0 azp) regardless of letter case', async () => {
    vi.stubGlobal('fetch', graphAccepts());
    const user = await parseAccessToken(`Bearer ${token({ azp: CLIENT_ID.toUpperCase() })}`);
    expect(user?.tenantId).toBe(TENANT_ID);
  });

  it('rejects a genuine Graph token that was issued to another app', async () => {
    // Graph Explorer. Graph accepts the token, but it is not an IntuneGet sign-in.
    vi.stubGlobal('fetch', graphAccepts());
    const user = await parseAccessToken(`Bearer ${token({ appid: 'de8bc8b5-d9f9-48b1-a8ad-b748da725064' })}`);
    expect(user).toBeNull();
  });

  it('rejects a token that names no client app at all', async () => {
    vi.stubGlobal('fetch', graphAccepts());
    expect(await parseAccessToken(`Bearer ${token({})}`)).toBeNull();
  });

  it('rejects every token when no client id is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_AZURE_AD_CLIENT_ID', '');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', graphAccepts());
    expect(await parseAccessToken(`Bearer ${token({ appid: CLIENT_ID })}`)).toBeNull();
  });

  it('accepts the server side client id name as well', async () => {
    vi.stubEnv('NEXT_PUBLIC_AZURE_AD_CLIENT_ID', '');
    vi.stubEnv('AZURE_CLIENT_ID', CLIENT_ID);
    vi.stubGlobal('fetch', graphAccepts());
    expect(await parseAccessToken(`Bearer ${token({ appid: CLIENT_ID })}`)).not.toBeNull();
  });

  it('accepts a further client id only when the operator lists it', async () => {
    const scriptApp = '99999999-aaaa-4bbb-8ccc-000000000000';
    vi.stubGlobal('fetch', graphAccepts());
    expect(await parseAccessToken(`Bearer ${token({ appid: scriptApp })}`)).toBeNull();

    vi.stubEnv('ALLOWED_TOKEN_CLIENT_IDS', ` other-id , ${scriptApp.toUpperCase()} `);
    expect(await parseAccessToken(`Bearer ${token({ appid: scriptApp })}`)).not.toBeNull();
  });

  it('rejects a token that Graph does not accept, whatever it claims', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    expect(await parseAccessToken(`Bearer ${token({ appid: CLIENT_ID })}`)).toBeNull();
  });

  it('exposes directory roles from wids, and leaves them undefined when the claim is absent', async () => {
    vi.stubGlobal('fetch', graphAccepts());
    const admin = await parseAccessToken(`Bearer ${token({ appid: CLIENT_ID, wids: [GLOBAL_ADMIN.toUpperCase()] })}`);
    expect(admin?.directoryRoles).toEqual([GLOBAL_ADMIN]);

    const unknown = await parseAccessToken(`Bearer ${token({ appid: CLIENT_ID })}`);
    expect(unknown).not.toBeNull();
    expect(unknown?.directoryRoles).toBeUndefined();
  });
});

describe('consent state', () => {
  const ORG = '55555555-aaaa-4bbb-8ccc-666666666666';
  const RECORD = '77777777-aaaa-4bbb-8ccc-888888888888';

  beforeEach(() => {
    vi.stubEnv('MSP_STATE_SECRET', 'unit-test-secret');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('round trips', () => {
    expect(verifyConsentState(signConsentState(ORG, RECORD))).toEqual({ mspOrgId: ORG, tenantRecordId: RECORD });
  });

  it('carries the full HMAC, not a shortened one', () => {
    const signature = signConsentState(ORG, RECORD).split(':')[3];
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a changed record id, a changed signature and a shortened signature', () => {
    const state = signConsentState(ORG, RECORD);
    const [org, , timestamp, signature] = state.split(':');
    expect(verifyConsentState(`${org}:99999999-aaaa-4bbb-8ccc-000000000000:${timestamp}:${signature}`)).toBeNull();
    expect(verifyConsentState(`${state.slice(0, -1)}${state.endsWith('0') ? '1' : '0'}`)).toBeNull();
    expect(verifyConsentState(`${org}:${RECORD}:${timestamp}:${signature.slice(0, 16)}`)).toBeNull();
  });

  it('rejects a state signed with another secret', () => {
    const state = signConsentState(ORG, RECORD);
    vi.stubEnv('MSP_STATE_SECRET', 'another-secret');
    expect(verifyConsentState(state)).toBeNull();
  });

  it('expires after one hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    const state = signConsentState(ORG, RECORD);
    vi.setSystemTime(new Date('2026-11-13T10:59:00Z'));
    expect(verifyConsentState(state)).not.toBeNull();
    vi.setSystemTime(new Date('2026-11-13T11:00:01Z'));
    expect(verifyConsentState(state)).toBeNull();
  });

  it('rejects a timestamp from the future, which would otherwise never expire', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    const fromTheFuture = signConsentState(ORG, RECORD);
    vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));
    expect(verifyConsentState(fromTheFuture)).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(verifyConsentState('')).toBeNull();
    expect(verifyConsentState('a:b:c')).toBeNull();
    expect(verifyConsentState(`${ORG}:${RECORD}:not-a-number:abc`)).toBeNull();
  });
});
