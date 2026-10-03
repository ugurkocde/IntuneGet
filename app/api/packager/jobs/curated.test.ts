import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import { signedFixture } from '@/lib/curated-catalog/test-fixtures';
import { buildCuratedCartItem } from '@/lib/curated-catalog/package';

const state = vi.hoisted(() => ({ envelope: {} as Record<string, unknown>, claim: vi.fn(), update: vi.fn() }));
vi.mock('@/catalog/curated/catalog.json', () => ({ default: state.envelope }));
vi.mock('@/lib/db', () => ({ getDatabase: () => ({ jobs: { claim: state.claim, update: state.update } }), verifyPackagerApiKey: () => true }));
vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: true }) }));
import { POST } from './route';
const request = () => new NextRequest('http://localhost/api/packager/jobs', {
  method: 'POST', headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
  body: JSON.stringify({ jobId: 'job', packagerId: 'worker' }),
});
describe('curated local-worker handoff', () => {
  beforeEach(() => {
    state.claim.mockReset(); state.update.mockReset();
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
