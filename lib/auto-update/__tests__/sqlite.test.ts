import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import { releaseFixture } from '@/lib/curated-catalog/test-fixtures';
import { buildCuratedCartItem } from '@/lib/curated-catalog/package';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type { DetectionRule } from '@/types/intune';
import { DEFAULT_REGISTRY_MARKER_PATH } from '@/lib/registry-marker';

const getAppsByWingetIdsMock = vi.hoisted(() => vi.fn());
const getLatestInstallerInfoMock = vi.hoisted(() => vi.fn());
const curatedApproval = vi.hoisted(() => ({ value: null as unknown }));
const acquireGraphTokenMock = vi.hoisted(() => vi.fn(() => { throw new Error('No Graph in fixture tests'); }));
vi.mock('@/lib/curated-catalog/server', async importOriginal => ({
  ...(await importOriginal<object>()),
  assertCuratedInstaller: vi.fn(() => curatedApproval.value),
}));
vi.mock('@/lib/graph-token', () => ({ acquireGraphToken: acquireGraphTokenMock }));

vi.mock('@/lib/catalog', () => ({
  getCatalogSource: () => ({
    getAppsByWingetIds: getAppsByWingetIdsMock,
    getAppForInstaller: vi.fn(),
  }),
}));

vi.mock('@/lib/auto-update/trigger', () => ({
  getLatestInstallerInfo: getLatestInstallerInfoMock,
}));

let tempDir: string;

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'intuneget-autoupdate-'));
  process.env.DATABASE_PATH = join(tempDir, 'app.db');
  getAppsByWingetIdsMock.mockReset();
  getLatestInstallerInfoMock.mockReset();
  acquireGraphTokenMock.mockClear();
  curatedApproval.value = null;
});

afterEach(async () => {
  const { closeSqliteDb } = await import('@/lib/db/sqlite');
  closeSqliteDb();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATABASE_PATH;
});

async function load() {
  const { sqliteDb } = await import('@/lib/db/sqlite');
  const { runSqliteUpdateCheck, triggerSqliteAutoUpdate } = await import('@/lib/auto-update/sqlite');
  return { db: sqliteDb, runSqliteUpdateCheck, triggerSqliteAutoUpdate };
}

function installerResolution() {
  return {
    ok: true,
    info: {
      wingetId: 'Vendor.App',
      currentVersion: '',
      latestVersion: '1.1.0',
      displayName: 'Vendor App',
      installerUrl: 'https://example.com/app.exe',
      installerSha256: 'ABCDEF',
      installerType: 'exe',
      installCommand: 'app.exe /s',
      uninstallCommand: 'app.exe /x',
      detectionRules: [],
      silentSwitches: '/s',
      installerSuccessCodes: [0],
      installScope: 'machine',
    },
  };
}

const deploymentConfig = {
  displayName: 'Vendor App',
  publisher: 'Vendor',
  architecture: 'x64',
  installerType: 'exe',
  installCommand: 'app.exe /s',
  uninstallCommand: 'app.exe /x',
  installScope: 'machine',
  detectionRules: [],
};

async function seedDeployment(db: Awaited<ReturnType<typeof load>>['db'], withPrior = true) {
  const policy = await db.updatePolicies.upsert({
    user_id: 'u1',
    tenant_id: 't1',
    winget_id: 'Vendor.App',
    policy_type: 'auto_update',
    deployment_config: deploymentConfig,
    original_upload_history_id: withPrior ? 'u1-history' : null,
    is_enabled: true,
  });
  await db.uploadHistory.create({
    id: 'u1-history',
    user_id: 'u1',
    winget_id: 'Vendor.App',
    version: '1.0.0',
    display_name: 'Vendor App',
    intune_app_id: 'app-1',
    intune_tenant_id: 't1',
  });
  return policy;
}

describe('sqlite auto-update check', () => {
  const versionRules = (version: string): DetectionRule[] => [{
    type: 'registry', keyPath: `HKEY_LOCAL_MACHINE\\${DEFAULT_REGISTRY_MARKER_PATH}\\Vendor_App`,
    valueName: 'Version', check32BitOn64System: false,
    detectionType: 'version', operator: 'greaterThanOrEqual', detectionValue: version,
  }];

  it('queues current version rules through the update check without rewriting the saved policy', async () => {
    const { db, runSqliteUpdateCheck } = await load();
    const original = await seedDeployment(db);
    const config = { ...deploymentConfig, detectionRules: versionRules('1.0.0'),
      psadtConfig: { ...DEFAULT_PSADT_CONFIG, detectionRules: versionRules('1.0.0') } };
    await db.updatePolicies.upsert({ ...original, deployment_config: config });
    getAppsByWingetIdsMock.mockResolvedValue([{ winget_id: 'Vendor.App', latest_version: '1.1.0' }]);
    getLatestInstallerInfoMock.mockResolvedValue({ ...installerResolution(),
      info: { ...installerResolution().info, detectionRules: versionRules('1.1.0') } });
    expect((await runSqliteUpdateCheck(db)).triggered).toBe(1);
    const [job] = await db.jobs.getByTenantId('t1');
    expect(job.version).toBe('1.1.0');
    expect(job.detection_rules).toEqual(versionRules('1.1.0'));
    expect(job.package_config).toMatchObject({ psadtConfig: { detectionRules: versionRules('1.1.0') } });
    expect((await db.updatePolicies.getById(original.id, 'u1'))?.deployment_config).toEqual(config);
  });

  it('binds fresh managed marker rules to the saved marker location and scope', async () => {
    const { db, triggerSqliteAutoUpdate } = await load();
    const original = await seedDeployment(db);
    const config = { ...deploymentConfig, installScope: 'user', detectionRules: versionRules('1.0.0'),
      psadtConfig: { ...DEFAULT_PSADT_CONFIG, registryMarkerPath: 'SOFTWARE\\FixtureMarker' } };
    const policy = await db.updatePolicies.upsert({ ...original, deployment_config: config });
    const result = await triggerSqliteAutoUpdate(db, policy, { ...installerResolution().info,
      installScope: 'user', currentIntuneAppId: 'app-1', detectionRules: versionRules('1.1.0') });
    expect(result.success).toBe(true);
    const [job] = await db.jobs.getByTenantId('t1');
    expect(job.detection_rules).toEqual([{ ...versionRules('1.1.0')[0],
      keyPath: 'HKEY_CURRENT_USER\\SOFTWARE\\FixtureMarker\\Vendor_App', check32BitOn64System: false }]);
    expect((await db.updatePolicies.getById(original.id, 'u1'))?.deployment_config).toEqual(config);
  });

  it.each(['unknown-settings', 'no-current-rules', 'empty-current-rules'])('preserves detection fallback semantics for %s', async mode => {
    const { db, triggerSqliteAutoUpdate } = await load();
    const original = await seedDeployment(db);
    const config = { ...deploymentConfig, detectionRules: versionRules('1.0.0'),
      ...(mode !== 'unknown-settings' ? { psadtConfig: { ...DEFAULT_PSADT_CONFIG } } : {}) };
    const policy = await db.updatePolicies.upsert({ ...original, deployment_config: config });
    const info = { ...installerResolution().info, currentIntuneAppId: 'app-1',
      detectionRules: mode === 'no-current-rules' ? undefined : mode === 'empty-current-rules' ? [] : versionRules('1.1.0') };
    expect((await triggerSqliteAutoUpdate(db, policy, info)).success).toBe(true);
    expect((await db.jobs.getByTenantId('t1'))[0].detection_rules).toEqual(mode === 'empty-current-rules' ? [] : versionRules('1.0.0'));
  });

  it.each([
    { savedScope: 'machine', installerScope: 'USER', expectedScope: 'user' },
    { savedScope: 'UsEr', installerScope: null, expectedScope: 'user' },
    { savedScope: undefined, installerScope: null, expectedScope: undefined },
  ])('uses the same canonical scope for marker rules and the queued job: $savedScope/$installerScope', async ({ savedScope, installerScope, expectedScope }) => {
    const { db, triggerSqliteAutoUpdate } = await load();
    const original = await seedDeployment(db);
    const policy = await db.updatePolicies.upsert({ ...original, deployment_config: {
      ...deploymentConfig, installScope: savedScope, psadtConfig: { ...DEFAULT_PSADT_CONFIG },
    } });
    const create = vi.spyOn(db.jobs, 'create');
    const result = await triggerSqliteAutoUpdate(db, policy, { ...installerResolution().info,
      currentIntuneAppId: 'app-1', installScope: installerScope, detectionRules: versionRules('1.1.0') });
    expect(result.success).toBe(true);
    expect(create.mock.calls[0][0].install_scope).toBe(expectedScope);
    expect((await db.jobs.getByTenantId('t1'))[0].detection_rules).toEqual([
      { ...versionRules('1.1.0')[0], keyPath: `${expectedScope === 'user' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE'}\\${DEFAULT_REGISTRY_MARKER_PATH}\\Vendor_App` },
    ]);
  });

  it.each(['canonical', 'submitted'])('blocks a mixed case curated approval checkpoint stored under the %s ID', async storedCase => {
    const { db, triggerSqliteAutoUpdate } = await load();
    const app = { ...CURATED_APPS[0], id: 'fixture-app', packageId: 'IntuneGet.Curated.FixtureApp' };
    curatedApproval.value = { app, release: releaseFixture(app), installer: {} };
    const submitted = app.packageId.toUpperCase();
    expect(submitted).not.toBe(app.packageId);
    const policy = await db.updatePolicies.upsert({ user_id: 'u1', tenant_id: 't1', winget_id: submitted,
      policy_type: 'auto_update', deployment_config: deploymentConfig, original_upload_history_id: null, is_enabled: true });
    const checkpoint = await db.jobs.create({ user_id: 'another-user', tenant_id: 't1',
      winget_id: storedCase === 'canonical' ? app.packageId : submitted,
      version: '1.0.0', display_name: 'Fixture App', installer_type: 'exe',
      installer_url: 'https://example.test/fixture.exe', installer_sha256: 'A'.repeat(64), status: 'queued' });
    await db.jobs.update(checkpoint.id, { status: 'failed', error_code: 'INTUNE_APPROVAL_REQUIRED', archived_at: new Date().toISOString() });
    const result = await triggerSqliteAutoUpdate(db, policy, { ...installerResolution().info, wingetId: submitted, currentIntuneAppId: null },
      { skipRateLimits: true, skipPriorDeploymentCheck: true });
    expect(result).toMatchObject({ success: false, skipped: true, code: 'INTUNE_APPROVAL_PENDING' });
    expect(await db.jobs.getByTenantId('t1')).toHaveLength(0);
    expect((await db.jobs.getById(checkpoint.id))?.error_code).toBe('INTUNE_APPROVAL_REQUIRED');
    expect(await db.autoUpdateHistory.list('u1', { limit: 50, offset: 0 })).toHaveLength(0);
    expect((await db.updatePolicies.getById(policy.id, 'u1'))?.consecutive_failures).toBe(0);
    expect(acquireGraphTokenMock).not.toHaveBeenCalled();
  });

  it('queues a curated update when no approval checkpoint exists', async () => {
    const { db, triggerSqliteAutoUpdate } = await load();
    const app = { ...CURATED_APPS[0], id: 'fixture-app', packageId: 'IntuneGet.Curated.FixtureApp' };
    const release = releaseFixture(app);
    curatedApproval.value = { app, release, installer: {} };
    const policy = await db.updatePolicies.upsert({ user_id: 'u1', tenant_id: 't1', winget_id: app.packageId.toUpperCase(),
      policy_type: 'auto_update', deployment_config: { ...deploymentConfig, psadtConfig: { ...DEFAULT_PSADT_CONFIG } }, original_upload_history_id: null, is_enabled: true });
    const result = await triggerSqliteAutoUpdate(db, policy, { ...installerResolution().info, wingetId: policy.winget_id, detectionRules: versionRules('9.9.9') },
      { skipRateLimits: true, skipPriorDeploymentCheck: true });
    expect(result.success).toBe(true);
    expect(await db.jobs.getByTenantId('t1')).toHaveLength(1);
    expect((await db.jobs.getByTenantId('t1'))[0].package_config).toMatchObject({ sourceType: 'curated' });
    expect((await db.jobs.getByTenantId('t1'))[0].detection_rules).toEqual(buildCuratedCartItem(app, release).detectionRules);
    expect(acquireGraphTokenMock).not.toHaveBeenCalled();
  });

  it('preserves an archived approval checkpoint and skips a new version even with manual bypass flags', async () => {
    const { db, triggerSqliteAutoUpdate } = await load();
    const policy = await seedDeployment(db);
    const job = await db.jobs.create({ user_id: 'another-user', tenant_id: 't1', winget_id: 'Vendor.App',
      version: '1.0.0', display_name: 'App', installer_type: 'exe', installer_url: 'https://example.com/test.exe',
      installer_sha256: 'A'.repeat(64), status: 'queued' });
    await db.jobs.update(job.id, { status: 'failed', error_code: 'INTUNE_APPROVAL_REQUIRED', archived_at: new Date().toISOString() });
    const result = await triggerSqliteAutoUpdate(db, policy, { ...installerResolution().info, currentIntuneAppId: null },
      { skipRateLimits: true, skipPriorDeploymentCheck: true });
    expect(result).toMatchObject({ success: false, skipped: true, code: 'INTUNE_APPROVAL_PENDING' });
    expect(await db.jobs.getByTenantId('t1')).toHaveLength(0);
    expect(await db.autoUpdateHistory.list('u1', { limit: 50, offset: 0 })).toHaveLength(0);
    expect((await db.updatePolicies.getById(policy.id, 'u1'))?.consecutive_failures).toBe(0);
  });
  it('holds fixed rules without changing policy, history or jobs in automatic and manual modes', async () => {
    const { db, triggerSqliteAutoUpdate } = await load();
    const policy = await seedDeployment(db);
    const config = { ...deploymentConfig, psadtConfig: { ...((await import('@/types/psadt')).DEFAULT_PSADT_CONFIG), customDetection: true } };
    const saved = await db.updatePolicies.upsert({ ...policy, deployment_config: config });
    const before = await db.updatePolicies.getById(policy.id, 'u1');
    for (const options of [undefined, { skipRateLimits: true, skipPriorDeploymentCheck: true }]) {
      const result = await triggerSqliteAutoUpdate(db, saved, installerResolution().info, options);
      expect(result).toEqual({ success: false, skipped: true, skipReason: 'Custom detection rules are fixed. Deploy 1.1.0 from the catalog with updated rules.' });
    }
    expect(await db.jobs.getByTenantId('t1')).toHaveLength(0);
    expect(await db.autoUpdateHistory.list('u1', { limit: 50, offset: 0 })).toHaveLength(0);
    expect(await db.updatePolicies.getById(policy.id, 'u1')).toEqual(before);
  });
  it('detects an available update and queues an auto-update job', async () => {
    const { db, runSqliteUpdateCheck } = await load();
    const policy = await seedDeployment(db);
    getAppsByWingetIdsMock.mockResolvedValue([{ winget_id: 'Vendor.App', name: 'Vendor App', latest_version: '1.1.0' }]);
    getLatestInstallerInfoMock.mockResolvedValue(installerResolution());

    const summary = await runSqliteUpdateCheck(db);

    expect(summary.available).toBe(1);
    expect(summary.triggered).toBe(1);

    const results = await db.updateCheckResults.list('u1', {});
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ current_version: '1.0.0', latest_version: '1.1.0' });

    const jobs = await db.jobs.getByTenantId('t1');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      winget_id: 'Vendor.App',
      version: '1.1.0',
      status: 'queued',
      auto_update_policy_id: policy.id,
    });
    expect(jobs[0].is_auto_update).toBeTruthy();

    const history = await db.autoUpdateHistory.list('u1', { limit: 50, offset: 0 });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from_version: '1.0.0', to_version: '1.1.0', packaging_job_id: jobs[0].id });

    const updatedPolicy = await db.updatePolicies.getById(policy.id, 'u1');
    expect(updatedPolicy?.last_auto_update_version).toBe('1.1.0');
  });

  it('removes a stored detection once the app is no longer behind', async () => {
    const { db, runSqliteUpdateCheck } = await load();
    await seedDeployment(db);
    getAppsByWingetIdsMock.mockResolvedValue([{ winget_id: 'Vendor.App', name: 'Vendor App', latest_version: '1.1.0' }]);
    getLatestInstallerInfoMock.mockResolvedValue(installerResolution());
    await runSqliteUpdateCheck(db);
    expect(await db.updateCheckResults.list('u1', { includeDismissed: true })).toHaveLength(1);

    getAppsByWingetIdsMock.mockResolvedValue([{ winget_id: 'Vendor.App', name: 'Vendor App', latest_version: '1.0.0' }]);
    const summary = await runSqliteUpdateCheck(db);
    expect(summary.available).toBe(0);
    expect(await db.updateCheckResults.list('u1', { includeDismissed: true })).toHaveLength(0);
  });

  it('never cleans another user when scoped to one user', async () => {
    const { db, runSqliteUpdateCheck } = await load();
    await db.updateCheckResults.upsert({
      user_id: 'u2',
      tenant_id: 't2',
      winget_id: 'Other.App',
      intune_app_id: 'other-1',
      display_name: 'Other App',
      current_version: '1.0.0',
      latest_version: '2.0.0',
    });
    await db.updatePolicies.upsert({ user_id: 'u2', tenant_id: 't2', winget_id: 'Other.App', policy_type: 'notify' });
    await seedDeployment(db);
    getAppsByWingetIdsMock.mockResolvedValue([{ winget_id: 'Vendor.App', name: 'Vendor App', latest_version: '1.0.0' }]);

    await runSqliteUpdateCheck(db, { userId: 'u1' });

    expect(await db.updateCheckResults.list('u2', { includeDismissed: true })).toHaveLength(1);
  });

  it('records nothing when every deployed app is up to date', async () => {
    const { db, runSqliteUpdateCheck } = await load();
    await seedDeployment(db);
    getAppsByWingetIdsMock.mockResolvedValue([{ winget_id: 'Vendor.App', name: 'Vendor App', latest_version: '1.0.0' }]);

    const summary = await runSqliteUpdateCheck(db);
    expect(summary.available).toBe(0);
    expect(summary.triggered).toBe(0);
    expect(await db.jobs.getByTenantId('t1')).toHaveLength(0);
  });
});

describe('sqlite auto-update trigger safety', () => {
  it('returns an error when the policy has no prior deployment', async () => {
    const { db, triggerSqliteAutoUpdate } = await load();
    const policy = await seedDeployment(db, false);

    const result = await triggerSqliteAutoUpdate(db, policy, {
      wingetId: 'Vendor.App',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      currentIntuneAppId: 'app-1',
      displayName: 'Vendor App',
      installerUrl: 'https://example.com/app.exe',
      installerSha256: 'ABCDEF',
      installerType: 'exe',
      installCommand: 'app.exe /s',
      uninstallCommand: 'app.exe /x',
      installScope: 'machine',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/prior manual deployment/i);
  });

  it('skips a policy that hit the failure threshold', async () => {
    const { db, triggerSqliteAutoUpdate } = await load();
    const policy = await seedDeployment(db);
    const broken = { ...policy, consecutive_failures: 3 };

    const result = await triggerSqliteAutoUpdate(db, broken, {
      wingetId: 'Vendor.App',
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      currentIntuneAppId: 'app-1',
      displayName: 'Vendor App',
      installerUrl: 'https://example.com/app.exe',
      installerSha256: 'ABCDEF',
      installerType: 'exe',
      installCommand: 'app.exe /s',
      uninstallCommand: 'app.exe /x',
      installScope: 'machine',
    });

    expect(result.success).toBe(false);
    expect(result.skipped).toBe(true);
    expect(await db.jobs.getByTenantId('t1')).toHaveLength(0);
  });
});


it.each(['minor', 'major'] as const)('SQLite scope %s holds before history, jobs or QA work and preserves redeploy scope', async scope => {
  const { db, triggerSqliteAutoUpdate } = await load();
  const original = await seedDeployment(db);
  const policy = await db.updatePolicies.update(original.id, 'u1', { auto_update_scope: scope });
  const redeployed = await db.updatePolicies.upsert({ user_id: 'u1', tenant_id: 't1', winget_id: 'Vendor.App', policy_type: 'auto_update', deployment_config: deploymentConfig });
  expect(redeployed.auto_update_scope).toBe(scope);
  const create = vi.spyOn(db.jobs, 'create');
  const history = vi.spyOn(db.autoUpdateHistory, 'create');
  for (const currentVersion of ['1.0.0', 'unknown']) {
    const result = await triggerSqliteAutoUpdate(db, policy!, { ...installerResolution().info, currentVersion, latestVersion: '1.0.1' });
    expect(result).toMatchObject({ skipped: true, code: 'UPDATE_SCOPE_HELD' });
  }
  expect(create).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
  expect(acquireGraphTokenMock).not.toHaveBeenCalled();
});
