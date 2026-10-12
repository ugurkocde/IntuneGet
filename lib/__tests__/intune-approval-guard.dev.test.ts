import { describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '@/lib/db/types';
import { findPendingApprovalBlocks } from '@/lib/intune-approval-guard';
const { getDatabase } = vi.hoisted(() => ({ getDatabase: vi.fn(() => { throw new Error('Live database access forbidden'); }) }));
vi.mock('@/lib/db', () => ({ getDatabase }));

// Enabled only by the private pinned-tenant verification runner; CI is offline.
describe.skipIf(process.env.INTUNEGET_DEV_GRAPH_VERIFICATION !== 'pinned-read-only-v1')('dev tenant approval guard', () => {
  it('anchors a retained-app block and missing-app release to one pinned application token', async () => {
    const tenant = process.env.INTUNEGET_DEV_TENANT_ID;
    const client = process.env.AZURE_CLIENT_ID;
    const present = process.env.INTUNEGET_DEV_PRESENT_APP_ID;
    const absent = process.env.INTUNEGET_DEV_ABSENT_APP_ID;
    const idsValid = [tenant, client, present, absent].every(value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value));
    expect(idsValid).toBe(true);
    expect(process.env.AZURE_AUTH_MODE === 'client-secret').toBe(true);
    const nativeFetch = globalThis.fetch;
    const calls: Array<{ method: string; pathTemplate: string; status: number }> = [];
    let tokenCalls = 0, outsideAllowlist = 0, graph404BodyHasCode = false;
    let token: string | undefined;
    let claimsMatch = false;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const tokenRequest = url === `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token` && method === 'POST';
      const graphRequest = [present, absent].some(id => url === `https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/${id}?$select=id`) && method === 'GET';
      if (!tokenRequest && !graphRequest) { outsideAllowlist++; throw new Error('Verification request outside allowlist'); }
      if (tokenRequest) {
        tokenCalls++;
        const form = new URLSearchParams(String(init?.body));
        if (tokenCalls !== 1 || form.get('grant_type') !== 'client_credentials' || form.get('client_id') !== client ||
            form.get('client_secret') !== process.env.AZURE_CLIENT_SECRET) throw new Error('Verification credential path mismatch');
      } else if (!token || new Headers(init?.headers).get('Authorization') !== `Bearer ${token}`) {
        throw new Error('Verification token mismatch');
      }
      const response = await nativeFetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(20_000) });
      calls.push({ method, pathTemplate: tokenRequest ? '/{tenant}/oauth2/v2.0/token' : '/beta/deviceAppManagement/mobileApps/{id}?$select=id', status: response.status });
      if (tokenRequest && response.status === 200) {
        const body = await response.clone().json();
        token = body.access_token;
        const claims = JSON.parse(Buffer.from(token!.split('.')[1], 'base64url').toString('utf8'));
        claimsMatch = claims.tid?.toLowerCase() === tenant?.toLowerCase() &&
          (claims.appid || claims.azp)?.toLowerCase() === client?.toLowerCase() &&
          claims.idtyp === 'app' && !claims.scp && claims.roles?.includes('DeviceManagementApps.ReadWrite.All') === true;
        if (!claimsMatch) throw new Error('Verification application claims mismatch');
      }
      if (graphRequest && response.status === 404) graph404BodyHasCode = typeof (await response.clone().json()).error?.code === 'string';
      return response;
    };
    try {
      const query = vi.fn(async (_tenant: string, wingetId: string) => [{
        tenant_id: tenant, winget_id: wingetId, status: 'failed', error_category: 'approval',
        error_details: { intuneAppId: wingetId === 'Verification.Present' ? present : absent },
      }]);
      const result = await findPendingApprovalBlocks({ tenantId: tenant!, wingetIds: ['Verification.Present', 'Verification.Absent'] },
        { db: { jobs: { getApprovalFailures: query } } as unknown as DatabaseAdapter });
      const actualReasonsCorrect = result.length === 1 && result[0].wingetId === 'Verification.Present' && result[0].reason === 'retained_app_present';
      const statusesCorrect = calls.length === 3 && calls[0].status === 200 && calls[1].status === 200 && calls[2].status === 404;
      const liveVerified = actualReasonsCorrect && statusesCorrect && claimsMatch && graph404BodyHasCode && tokenCalls === 1 && outsideAllowlist === 0 && getDatabase.mock.calls.length === 0;
      console.log('INTUNEGET_DEV_GRAPH_EVIDENCE:' + JSON.stringify({ liveVerified, actualReasonsCorrect, statusesCorrect,
        appOnlyPermissionParity: claimsMatch, graph404BodyHasCode, tokenRequests: tokenCalls, graphReads: calls.filter(c => c.method === 'GET').length,
        graphWrites: 0, outsideAllowlist, databaseCalls: getDatabase.mock.calls.length, calls,
        retainedReason: actualReasonsCorrect ? 'retained_app_present' : 'verification_failed', absentReleased: actualReasonsCorrect,
        managedIdentityTested: false, verifiedAt: new Date().toISOString() }));
      expect(liveVerified).toBe(true);
    } finally { globalThis.fetch = nativeFetch; token = undefined; }
  }, 60_000);
});
