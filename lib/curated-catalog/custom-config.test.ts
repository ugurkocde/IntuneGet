import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from './definitions';
import { buildCuratedCartItem, curatedWorkflowInput } from './package';
import { releaseFixture } from './test-fixtures';
import { QA_PSADT_TOOLCHAIN } from '@/lib/qa/package-profile';

const db = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, inserted: [] as unknown[], updated: [] as unknown[], configured: true }));
vi.mock('@/lib/supabase', () => ({
  getServerClientOrNull: () => db.configured ? {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.row, error: null }) }) }) }),
      insert: async (value: unknown) => { db.inserted.push(value); return { error: null }; },
      update: (value: unknown) => ({ eq: async () => { db.updated.push(value); return { error: null }; } }),
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

  it('allows a configuration that passed verification for this release', async () => {
    const comparison = compareCuratedExecution(app, release, customised());
    db.row = { id: 'v1', status: 'passed', packager_commit: QA_PSADT_TOOLCHAIN.packagerCommit, execution_profile_sha256: comparison.executionProfileSha256, failure_detail: null };
    await expect(authorizeCuratedExecution(app, release, customised())).resolves.toMatchObject({ custom: true });
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
