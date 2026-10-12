import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CURATED_APPS } from './definitions';
import { releaseFixture, signedFixture } from './test-fixtures';

const state = vi.hoisted(() => ({ envelope: {} as Record<string, unknown>, getCatalog: vi.fn() }));
vi.mock('@/catalog/curated/catalog.json', () => ({ default: state.envelope }));
vi.mock('@/lib/catalog', () => ({ getCatalogSource: state.getCatalog }));
import { getLatestInstallerInfo } from '@/lib/auto-update/trigger';
import { buildDefaultDeploymentConfig } from '@/lib/update-policies/build-deployment-config';
import { triggerSqliteAutoUpdate } from '@/lib/auto-update/sqlite';
import { buildCuratedCartItem } from './package';
import type { DatabaseAdapter } from '@/lib/db/types';
import type { AppUpdatePolicy } from '@/types/update-policies';

afterEach(() => { vi.unstubAllEnvs(); state.getCatalog.mockReset(); });
describe('curated updates', () => {
  it('refreshes the self-hosted execution config and persists release provenance', async () => {
    const fixture = signedFixture();
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
    const item = buildCuratedCartItem(CURATED_APPS[0], fixture.envelope.payload.releases[0]);
    const create = vi.fn(async () => ({ id: 'new-job' }));
    const db = { jobs: { create, getApprovalFailures: vi.fn().mockResolvedValue([]) }, autoUpdateHistory: { create: vi.fn(async () => ({ id: 'history' })), update: vi.fn() },
      updatePolicies: { update: vi.fn() } } as unknown as DatabaseAdapter;
    const policy = { id: 'policy', user_id: 'user', tenant_id: 'tenant', policy_type: 'auto_update',
      is_enabled: true, consecutive_failures: 0, original_upload_history_id: 'original',
      deployment_config: { ...item, installCommand: 'old-command', detectionRules: [],
        assignments: [{ type: 'allDevices', intent: 'required' }] } } as unknown as AppUpdatePolicy;
    const result = await triggerSqliteAutoUpdate(db, policy, { wingetId: item.wingetId,
      currentVersion: '119.0.0.0', latestVersion: item.version, currentIntuneAppId: 'intune-id',
      displayName: item.displayName, installerUrl: item.installerUrl, installerSha256: item.installerSha256,
      installerType: item.installerType, installCommand: 'ignored-old-command', uninstallCommand: '', installScope: 'machine' },
    { skipRateLimits: true });
    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ install_command: item.installCommand,
      detection_rules: item.detectionRules, package_config: expect.objectContaining({
        sourceType: 'curated', curatedReleaseId: item.curatedReleaseId,
        psadtConfig: item.psadtConfig, assignments: [{ type: 'allDevices', intent: 'required' }],
      }) }));
  });
  it('resolves the signed latest version without querying Winget', async () => {
    const fixture = signedFixture();
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
    const result = await getLatestInstallerInfo(null as unknown as SupabaseClient, CURATED_APPS[0].packageId, 'x64', 'machine');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info.sourceType).toBe('curated');
      expect(result.info.curatedReleaseId).toBe(fixture.envelope.payload.releases[0].id);
    }
    expect(state.getCatalog).not.toHaveBeenCalled();
    const config = await buildDefaultDeploymentConfig(null as never, CURATED_APPS[0].packageId, '120.0.0.0');
    expect(config?.sourceType).toBe('curated');
    expect(state.getCatalog).not.toHaveBeenCalled();
  });
  it('rejects invalid trust and incompatible scope without falling back', async () => {
    const fixture = signedFixture();
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', '{}');
    expect((await getLatestInstallerInfo(null as never, CURATED_APPS[0].packageId)).ok).toBe(false);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
    expect((await getLatestInstallerInfo(null as never, CURATED_APPS[0].packageId, 'x64', 'user')).ok).toBe(false);
    expect(state.getCatalog).not.toHaveBeenCalled();
  });
});

describe('curated licence attestation for self-hosted automatic updates', () => {
  const acrobat = CURATED_APPS.find(app => app.id === 'acrobat-reader')!;
  const attestation = acrobat.licenceAttestation!;
  function setup(acceptedVersion?: string, acceptedTenant = 'tenant') {
    const fixture = signedFixture([releaseFixture(acrobat)]);
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
    const item = buildCuratedCartItem(acrobat, fixture.envelope.payload.releases[0]);
    const create = vi.fn(async () => ({ id: 'new-job' }));
    const get = vi.fn(async (tenantId: string, id: string, version: string) =>
      acceptedVersion && tenantId === acceptedTenant && id === attestation.id && version === acceptedVersion
        ? { id: 'acceptance', tenant_id: tenantId, app_id: acrobat.id, attestation_id: id, attestation_version: version,
            accepted_by_user_id: 'admin', accepted_by_email: 'admin@contoso.test', accepted_at: '2026-10-04T00:00:00.000Z' }
        : null);
    const db = { jobs: { create, getApprovalFailures: vi.fn().mockResolvedValue([]) }, autoUpdateHistory: { create: vi.fn(async () => ({ id: 'history' })), update: vi.fn() },
      updatePolicies: { update: vi.fn() }, curatedLicenceAttestations: { get } } as unknown as DatabaseAdapter;
    const policy = { id: 'policy', user_id: 'user', tenant_id: 'tenant', policy_type: 'auto_update',
      is_enabled: true, consecutive_failures: 0, original_upload_history_id: 'original',
      deployment_config: { ...item, assignments: [] } } as unknown as AppUpdatePolicy;
    const run = () => triggerSqliteAutoUpdate(db, policy, { wingetId: item.wingetId,
      currentVersion: '119.0.0.0', latestVersion: item.version, currentIntuneAppId: 'intune-id',
      displayName: item.displayName, installerUrl: item.installerUrl, installerSha256: item.installerSha256,
      installerType: item.installerType, installCommand: '', uninstallCommand: '', installScope: 'machine' },
    { skipRateLimits: true });
    return { run, create };
  }
  it.each([
    ['has not accepted', undefined, 'tenant'],
    ['accepted only an earlier agreement version', '2025-01-01', 'tenant'],
    ['is a different tenant from the one that accepted', attestation.version, 'other-tenant'],
  ])('skips with a clear reason when the tenant %s', async (_label, version, tenant) => {
    const { run, create } = setup(version, tenant);
    const result = await run();
    expect(result).toMatchObject({ success: false, skipped: true, code: 'CURATED_LICENCE_NOT_ACCEPTED' });
    expect(result.skipReason).toContain(attestation.title);
    expect(create).not.toHaveBeenCalled();
  });
  it('queues the update and records the acceptance once accepted', async () => {
    const { run, create } = setup(attestation.version);
    expect((await run()).success).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ package_config: expect.objectContaining({
      curatedLicenceAcceptance: expect.objectContaining({ attestationId: attestation.id, attestationVersion: attestation.version }),
    }) }));
  });
});
