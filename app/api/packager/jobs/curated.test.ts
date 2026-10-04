import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import { releaseFixture, signedFixture } from '@/lib/curated-catalog/test-fixtures';
import { buildCuratedCartItem } from '@/lib/curated-catalog/package';

const state = vi.hoisted(() => ({ envelope: {} as Record<string, unknown>, claim: vi.fn(), update: vi.fn(), acceptances: new Set<string>() }));
vi.mock('@/catalog/curated/catalog.json', () => ({ default: state.envelope }));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { claim: state.claim, update: state.update },
  curatedLicenceAttestations: { get: async (tenantId: string, id: string, version: string) => state.acceptances.has(`${tenantId}|${id}|${version}`)
    ? { tenant_id: tenantId, attestation_id: id, attestation_version: version, accepted_at: '2026-10-04T00:00:00.000Z', accepted_by_user_id: 'admin', accepted_by_email: null } : null } }),
  verifyPackagerApiKey: () => true }));
vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: true }) }));
import { POST } from './route';
const request = () => new NextRequest('http://localhost/api/packager/jobs', {
  method: 'POST', headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
  body: JSON.stringify({ jobId: 'job', packagerId: 'worker' }),
});
describe('curated local-worker handoff', () => {
  beforeEach(() => {
    state.claim.mockReset(); state.update.mockReset(); state.acceptances.clear();
    const fixture = signedFixture();
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
    const item = buildCuratedCartItem(CURATED_APPS[0], fixture.envelope.payload.releases[0]);
    state.claim.mockResolvedValue({ id: 'job', winget_id: item.wingetId, version: item.version,
      display_name: item.displayName, publisher: item.publisher, architecture: item.architecture,
      install_scope: item.installScope, installer_type: item.installerType, installer_url: item.installerUrl,
      installer_sha256: item.installerSha256, install_command: item.installCommand,
      uninstall_command: item.uninstallCommand, detection_rules: item.detectionRules, package_config: item });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('hands an approved job to the worker', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).claimed).toBe(true);
    expect(state.update).not.toHaveBeenCalled();
  });
  it('fails a queued curated job when its catalog is no longer trusted', async () => {
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', '{}');
    const response = await POST(request());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.claimed).toBe(false);
    expect(body).not.toHaveProperty('job');
    expect(state.update).toHaveBeenCalledWith('job', expect.objectContaining({ status: 'failed', error_code: 'CURATED_RELEASE_UNAVAILABLE' }), { status: 'packaging' });
  });
});

describe('curated licence attestation at local-worker handoff', () => {
  const acrobat = CURATED_APPS.find(app => app.id === 'acrobat-reader')!;
  const attestation = acrobat.licenceAttestation!;
  beforeEach(() => {
    state.claim.mockReset(); state.update.mockReset(); state.acceptances.clear();
    const fixture = signedFixture([releaseFixture(acrobat)]);
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
    const item = buildCuratedCartItem(acrobat, fixture.envelope.payload.releases[0]);
    state.claim.mockResolvedValue({ id: 'job', tenant_id: 'tenant-a', winget_id: item.wingetId, version: item.version,
      display_name: item.displayName, publisher: item.publisher, architecture: item.architecture,
      install_scope: item.installScope, installer_type: item.installerType, installer_url: item.installerUrl,
      installer_sha256: item.installerSha256, install_command: item.installCommand,
      uninstall_command: item.uninstallCommand, detection_rules: item.detectionRules, package_config: item });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('fails the job when the tenant has not accepted the agreement', async () => {
    const response = await POST(request());
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({ claimed: false, code: 'CURATED_LICENCE_NOT_ACCEPTED' });
    expect(body).not.toHaveProperty('job');
    expect(state.update).toHaveBeenCalledWith('job', expect.objectContaining({ status: 'failed', error_code: 'CURATED_LICENCE_NOT_ACCEPTED' }), { status: 'packaging' });
  });
  it('does not accept another tenant\'s acceptance or an earlier agreement version', async () => {
    state.acceptances.add(`tenant-b|${attestation.id}|${attestation.version}`);
    state.acceptances.add(`tenant-a|${attestation.id}|2025-01-01`);
    expect((await POST(request())).status).toBe(409);
  });
  it('hands the job to the worker once the tenant accepted the current agreement', async () => {
    state.acceptances.add(`tenant-a|${attestation.id}|${attestation.version}`);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).claimed).toBe(true);
    expect(state.update).not.toHaveBeenCalled();
  });
});
