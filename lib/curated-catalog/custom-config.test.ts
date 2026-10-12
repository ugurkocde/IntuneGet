import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from './definitions';
import { buildCuratedCartItem, curatedWorkflowInput } from './package';
import { releaseFixture } from './test-fixtures';
import { QA_PSADT_TOOLCHAIN } from '@/lib/qa/package-profile';
import { createCuratedVerificationProfile, rebuildCuratedExecutionConfig } from './verification-profile';

const db = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, inserted: [] as unknown[], updated: [] as unknown[], configured: true }));
vi.mock('@/lib/supabase', () => ({
  getServerClientOrNull: () => db.configured ? {
    from: () => ({
      select: () => ({ eq: (_key: string, releaseId: string) => ({ eq: (_hashKey: string, hash: string) => ({
        maybeSingle: async () => ({ data: db.row && (!db.row.release_id ||
          (db.row.release_id === releaseId && db.row.psadt_config_sha256 === hash)) ? db.row : null, error: null }),
      }) }) }),
      insert: async (value: unknown) => { db.inserted.push(value); return { error: null }; },
      update: (value: unknown) => ({ eq: () => ({ eq: async () => { db.updated.push(value); return { error: null }; } }) }),
    }),
  } : null,
}));
import { authorizeCuratedExecution, compareCuratedExecution, CuratedConfigVerificationError } from './custom-config';

const app = CURATED_APPS[0];
const release = releaseFixture(app);
const base = () => curatedWorkflowInput(buildCuratedCartItem(app, release));
const customised = () => {
  const item = buildCuratedCartItem(app, release);
  return curatedWorkflowInput({ ...item, psadtConfig: { ...item.psadtConfig, processesToClose: [{ name: 'chrome', description: 'Google Chrome' }] } });
};

describe('curated custom PSADT execution settings', () => {
  beforeEach(() => { db.row = null; db.inserted = []; db.updated = []; db.configured = true; });

  it('accepts the signed default and presentation-only changes without verification', async () => {
    expect(compareCuratedExecution(app, release, base()).custom).toBe(false);
    const item = buildCuratedCartItem(app, release);
    const branded = curatedWorkflowInput({ ...item, psadtConfig: { ...item.psadtConfig, brandingCompanyName: 'Contoso' } });
    await expect(authorizeCuratedExecution(app, release, branded)).resolves.toMatchObject({ custom: false });
    expect(db.inserted).toHaveLength(0);
  });

  it('rejects changes outside the PSADT configuration even with a verified config', () => {
    expect(() => compareCuratedExecution(app, release, { ...customised(), silentSwitches: '/qn EXTRA=1' })).toThrow(/differs from the approved/);
  });

  it('queues an unverified custom configuration and refuses it until verified', async () => {
    const error = await authorizeCuratedExecution(app, release, customised(), { tenantId: 'tenant-1', userId: 'user-1' }).catch(e => e);
    expect(error).toBeInstanceOf(CuratedConfigVerificationError);
    expect(error.code).toBe('CURATED_CONFIG_VERIFICATION_REQUIRED');
    expect(error.message).toMatch(/queued/);
    expect(db.inserted).toEqual([expect.objectContaining({ release_id: release.id, status: 'requested', tenant_id: 'tenant-1', psadt_config_sha256: compareCuratedExecution(app, release, customised()).psadtConfigSha256 })]);
  });

  it('does not queue without a request context', async () => {
    await expect(authorizeCuratedExecution(app, release, customised())).rejects.toThrow(/must pass/);
    expect(db.inserted).toHaveLength(0);
  });

  it.each(['requested', 'verifying'])('polls %s without changing dispatch state or timestamps', async (status) => {
    db.row = { id: 'v1', status, packager_commit: null, execution_profile_sha256: null, failure_detail: null };
    const error = await authorizeCuratedExecution(app, release, customised(), { tenantId: 't' }).catch(e => e);
    expect(error.status).toBe(status);
    expect(db.updated).toHaveLength(0);
    expect(db.inserted).toHaveLength(0);
  });

  it('allows a configuration that passed verification for this release', async () => {
    const comparison = compareCuratedExecution(app, release, customised());
    db.row = { id: 'v1', status: 'passed', packager_commit: QA_PSADT_TOOLCHAIN.packagerCommit, execution_profile_sha256: comparison.executionProfileSha256, failure_detail: null };
    await expect(authorizeCuratedExecution(app, release, customised())).resolves.toMatchObject({ custom: true });
  });

  it('finds a carried 7-Zip configuration only after its exact new release verification passes', async () => {
    const sevenZip = CURATED_APPS.find(item => item.id === '7zip')!;
    const previous = releaseFixture(sevenZip, '26.03');
    const next = releaseFixture(sevenZip, '26.04');
    const previousProfile = createCuratedVerificationProfile(previous.candidate, previous.installerSha256, {
      deployMode: 'Silent', processesToClose: [{ name: '7zFM', description: '7-Zip' }],
    });
    const carried = rebuildCuratedExecutionConfig(next, JSON.parse(previousProfile.workflowInput.psadtConfig));
    const item = buildCuratedCartItem(sevenZip, next);
    const input = curatedWorkflowInput({ ...item, psadtConfig: carried.executionConfig as unknown as typeof item.psadtConfig });
    const comparison = compareCuratedExecution(sevenZip, next, input);
    expect(carried.psadtConfigSha256).toBe(comparison.psadtConfigSha256);
    expect(carried.psadtConfigSha256).not.toBe(previousProfile.psadtConfigSha256);
    const verified = { id: 'carried', release_id: next.id, psadt_config_sha256: carried.psadtConfigSha256,
      status: 'requested', packager_commit: QA_PSADT_TOOLCHAIN.packagerCommit,
      execution_profile_sha256: comparison.executionProfileSha256, failure_detail: null };
    db.row = verified;
    await expect(authorizeCuratedExecution(sevenZip, next, input)).rejects.toThrow(CuratedConfigVerificationError);
    db.row = { ...verified, status: 'passed' };
    await expect(authorizeCuratedExecution(sevenZip, next, input)).resolves.toMatchObject({ custom: true });
    db.row = { ...verified, status: 'passed', psadt_config_sha256: previousProfile.psadtConfigSha256 };
    await expect(authorizeCuratedExecution(sevenZip, next, input)).rejects.toThrow(CuratedConfigVerificationError);
    expect(db.inserted).toHaveLength(0);
    expect(db.updated).toHaveLength(0);
  });

  it('re-verifies a pass that is no longer compatible and explains a failed configuration', async () => {
    db.row = { id: 'v1', status: 'passed', packager_commit: 'f'.repeat(40), execution_profile_sha256: 'a'.repeat(64), failure_detail: null };
    await expect(authorizeCuratedExecution(app, release, customised(), { tenantId: 't' })).rejects.toThrow(CuratedConfigVerificationError);
    expect(db.updated).toEqual([expect.objectContaining({ status: 'requested' })]);
    db.row = { id: 'v2', status: 'failed', packager_commit: null, execution_profile_sha256: null, failure_detail: 'cleanUninstall; exit code (60001)' };
    const failed = await authorizeCuratedExecution(app, release, customised(), { tenantId: 't' }).catch(e => e);
    expect(failed.code).toBe('CURATED_CONFIG_VERIFICATION_FAILED');
    expect(failed.message).toMatch(/failed verification.*60001/);
  });

  it('keeps self-hosted installations on the verified defaults', async () => {
    db.configured = false;
    await expect(authorizeCuratedExecution(app, release, base())).resolves.toMatchObject({ custom: false });
    await expect(authorizeCuratedExecution(app, release, customised())).rejects.toThrow(/hosted IntuneGet QA service/);
  });
});
