import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from './definitions';
import { buildCuratedCartItem, curatedWorkflowInput } from './package';
import { releaseFixture, signedFixture } from './test-fixtures';
import type { PackagingJob } from '@/lib/db/types';

const state = vi.hoisted(() => ({ envelope: {} as Record<string, unknown> }));
vi.mock('@/catalog/curated/catalog.json', () => ({ default: state.envelope }));
import { authorizeCuratedWorkflow, getApprovedCuratedRelease, getCuratedCatalog, getCuratedLatestVersions,
  reconcileCuratedCartItem, validateCuratedPackagingJob } from './server';

describe('curated deployment authorization', () => {
  beforeEach(() => {
    const fixture = signedFixture();
    Object.keys(state.envelope).forEach(key => delete state.envelope[key]);
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
  });
  afterEach(() => vi.unstubAllEnvs());
  const item = () => ({ ...buildCuratedCartItem(CURATED_APPS[0], releaseFixture()), id: 'test-cart', addedAt: new Date() });

  it('provides approved releases and independent latest versions', () => {
    expect(getApprovedCuratedRelease(CURATED_APPS[0].packageId).release.candidate.version).toBe('120.0.0.0');
    expect(getCuratedLatestVersions()).toEqual([{ winget_id: CURATED_APPS[0].packageId, latest_version: '120.0.0.0' }]);
  });
  it('keeps assignments while reconciling the approved package', async () => {
    const cart = { ...item(), assignments: [{ type: 'allDevices' as const, intent: 'required' as const }] };
    const reconciled = await reconcileCuratedCartItem(cart);
    expect(reconciled.item.assignments).toEqual(cart.assignments);
    expect(reconciled.item.sourceType).toBe('curated');
    expect(reconciled.trustedInstallers[0].sha256).toBe(cart.installerSha256);
  });
  it.each(CURATED_APPS)('uses verified defaults for $name while preserving branding and assignments', async app => {
    const release = releaseFixture(app);
    const fixture = signedFixture([release]);
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
    const cart = { ...buildCuratedCartItem(app, release), id: 'defaults', addedAt: new Date(),
      assignments: [{ type: 'allDevices' as const, intent: 'required' as const }] };
    cart.psadtConfig = { ...cart.psadtConfig, processesToClose: [{ name: 'untested', description: '' }], brandingCompanyName: 'Example Company' };
    const reconciled = await reconcileCuratedCartItem(cart);
    expect(reconciled.item.psadtConfig.processesToClose).toEqual([]);
    expect(reconciled.item.psadtConfig.brandingCompanyName).toBe('Example Company');
    expect(reconciled.item.assignments).toEqual(cart.assignments);
    expect(reconciled.item.curatedSettingsMode).toBe('tested-defaults');
  });
  it('retains the verification gate for opt-in and legacy custom settings', async () => {
    const cart = item();
    cart.psadtConfig.processesToClose = [{ name: 'untested', description: '' }];
    await expect(reconcileCuratedCartItem({ ...cart, curatedSettingsMode: 'custom' })).rejects.toThrow(/verification/);
    await expect(reconcileCuratedCartItem({ ...cart, curatedSettingsMode: undefined })).rejects.toThrow(/verification/);
  });
  it('rejects source downgrades and QA overrides', async () => {
    await expect(reconcileCuratedCartItem({ ...item(), sourceType: 'custom' })).rejects.toThrow(/approved release/);
    await expect(reconcileCuratedCartItem({ ...item(), qaOverride: true })).rejects.toThrow(/approved release/);
  });
  it.each(['url', 'hash', 'scope', 'architecture', 'switches', 'detection', 'successCodes', 'nested'] as const)('rejects changed %s', async field => {
    const cart = item();
    const input = { ...curatedWorkflowInput(cart), installerUrl: cart.installerUrl, curatedReleaseId: cart.curatedReleaseId };
    if (field === 'url') input.installerUrl = 'https://evil.test/app.msi';
    if (field === 'hash') input.installerSha256 = 'b'.repeat(64);
    if (field === 'scope') input.installScope = 'user';
    if (field === 'architecture') input.architecture = 'arm64';
    if (field === 'switches') input.silentSwitches = '/qn UNKNOWN=YES';
    if (field === 'detection') input.detectionRules = JSON.stringify([{ type: 'script', scriptContent: 'Write-Output "incorrect"; exit 0', enforceSignatureCheck: false, runAs32Bit: false }]);
    if (field === 'successCodes') input.installerSuccessCodes = [42];
    if (field === 'nested') input.nestedInstallerPath = 'payload.exe';
    await expect(authorizeCuratedWorkflow(input)).rejects.toThrow(/approved curated release/);
  });
  it('revalidates queued local-packager jobs before handing off an installer', async () => {
    const cart = item();
    const job = {
      winget_id: cart.wingetId, version: cart.version, display_name: cart.displayName,
      publisher: cart.publisher, architecture: cart.architecture, install_scope: cart.installScope,
      installer_type: cart.installerType, installer_url: cart.installerUrl,
      installer_sha256: cart.installerSha256, install_command: cart.installCommand,
      uninstall_command: cart.uninstallCommand, detection_rules: cart.detectionRules,
      package_config: { sourceType: 'curated', curatedReleaseId: cart.curatedReleaseId, psadtConfig: cart.psadtConfig },
    } as unknown as PackagingJob;
    await expect(validateCuratedPackagingJob(job)).resolves.toBeUndefined();
    job.installer_sha256 = 'b'.repeat(64);
    await expect(validateCuratedPackagingJob(job)).rejects.toThrow(/metadata differs/);
  });
  it('rejects revoked releases and does not substitute a Winget release', () => {
    const release = releaseFixture();
    const fixture = signedFixture([release], [release.id]);
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
    expect(getCuratedLatestVersions()).toEqual([]);
    expect(() => getApprovedCuratedRelease(CURATED_APPS[0].packageId)).toThrow(/withdrawn/);
  });
  it('withholds only a release whose packaging profile is no longer current', () => {
    const stale = releaseFixture();
    stale.executionProfileSha256 = 'c'.repeat(64);
    stale.evidence.qa.executionProfileSha256 = stale.executionProfileSha256;
    const current = releaseFixture(CURATED_APPS[1], '140.2.0');
    const fixture = signedFixture([stale, current]);
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
    const entries = getCuratedCatalog().entries;
    expect(entries.find(entry => entry.app.id === CURATED_APPS[0].id)).toMatchObject({ status: 'pending', release: null });
    expect(entries.find(entry => entry.app.id === CURATED_APPS[1].id)?.status).toBe('approved');
    expect(getCuratedLatestVersions()).toEqual([{ winget_id: CURATED_APPS[1].packageId, latest_version: '140.2.0' }]);
    expect(() => getApprovedCuratedRelease(CURATED_APPS[0].packageId)).toThrow(/awaiting verification/);
  });
  it('leaves ordinary packaging jobs untouched', async () => {
    await expect(validateCuratedPackagingJob({ winget_id: 'Google.Chrome', package_config: {} } as PackagingJob)).resolves.toBeUndefined();
  });
});
