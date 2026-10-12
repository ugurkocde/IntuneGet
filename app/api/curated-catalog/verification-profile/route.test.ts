import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The committed catalog changes whenever the automation publishes, so these
// tests use the unsigned bootstrap catalog instead.
vi.mock('@/catalog/curated/catalog.json', () => ({ default: {
  payload: { schemaVersion: 1, generatedAt: null, expiresAt: null, definitionsSha256: null, releases: [], withdrawnReleaseIds: [] },
  keyId: null, signature: null,
} }));
import { POST } from './route';
import { GET } from '../route';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import { releaseFixture } from '@/lib/curated-catalog/test-fixtures';

const request = (body: unknown, token = 'operator-test') => new NextRequest('http://localhost/api/curated-catalog/verification-profile', {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
afterEach(() => vi.unstubAllEnvs());
describe('curated catalog APIs', () => {
  it('shows every definition pending and no deployable cart items without signed releases', async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.entries).toHaveLength(CURATED_APPS.length);
    expect(body.entries.every((entry: { status: string; cartItem: unknown }) => entry.status === 'pending' && !entry.cartItem)).toBe(true);
    const licences = body.entries.filter((entry: { app: { licenceAttestation: unknown } }) => entry.app.licenceAttestation);
    expect(licences.map((entry: { app: { id: string } }) => entry.app.id)).toEqual(['acrobat-reader']);
    expect(licences[0].app.licenceAttestation).toEqual(CURATED_APPS.find(app => app.id === 'acrobat-reader')!.licenceAttestation);
  });
  it('requires operator authentication, including when no token is configured', async () => {
    vi.stubEnv('CURATED_CATALOG_OPERATOR_TOKEN', '');
    expect((await POST(request({}))).status).toBe(401);
    vi.stubEnv('CURATED_CATALOG_OPERATOR_TOKEN', 'operator-test');
    expect((await POST(request({}, 'wrong'))).status).toBe(401);
  });
  it('produces the exact test profile without approving the candidate', async () => {
    vi.stubEnv('CURATED_CATALOG_OPERATOR_TOKEN', 'operator-test');
    const release = releaseFixture();
    const response = await POST(request({ candidate: release.candidate, installerSha256: release.installerSha256 }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.executionProfileSha256).toBe(release.executionProfileSha256);
    expect(body.approvalRequired).toBe(true);
    expect(body.packageId).toBe(CURATED_APPS[0].packageId);
    expect(body).not.toHaveProperty('approvedAt');
  });
  it('rejects a mismatched vendor hash and oversized metadata', async () => {
    vi.stubEnv('CURATED_CATALOG_OPERATOR_TOKEN', 'operator-test');
    const release = releaseFixture();
    expect((await POST(request({ candidate: release.candidate, installerSha256: 'b'.repeat(64) }))).status).toBe(400);
    expect((await POST(request({ metadata: 'a'.repeat(17_000) }))).status).toBe(413);
  });
});
