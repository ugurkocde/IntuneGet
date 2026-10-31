import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import { releaseFixture } from '@/lib/curated-catalog/test-fixtures';
import { buildCuratedCartItem, curatedWorkflowInput } from '@/lib/curated-catalog/package';

const state = vi.hoisted(() => ({
  rows: [] as Array<{ sha256: string; next_check_at: string; malicious_verdicts: number; released_at?: string }>,
  readError: false, thrown: false, nullData: false, configured: true, custom: false,
  approved: {} as Record<string, unknown>, job: {} as Record<string, unknown>,
  tables: [] as string[], hashes: [] as string[], releasedFilter: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({
  isSupabaseServerConfigured: () => state.configured,
  createServerClient: () => {
    if (state.thrown || !state.configured) throw new Error('Synthetic unavailable reader');
    return { from: (table: string) => {
      state.tables.push(table);
      return { select: () => ({ in: (_key: string, hashes: string[]) => {
        state.hashes = hashes;
        return { is: async (...args: unknown[]) => {
          state.releasedFilter(...args);
          return { data: state.nullData ? null : state.rows.filter(r => !r.released_at), error: state.readError ? { message: 'Synthetic read failure' } : null };
        } };
      } }) };
    } };
  },
}));
vi.mock('@/lib/curated-catalog/server', () => ({
  getApprovedCuratedRelease: () => state.approved,
  validateCuratedPackagingJob: vi.fn().mockResolvedValue(undefined),
  authorizeCuratedWorkflow: async () => ({ ...state.approved, execution: { custom: state.custom } }),
}));
vi.mock('@/lib/curated-catalog/licence', () => ({
  assertCuratedLicenceAccepted: vi.fn().mockResolvedValue(undefined),
  CuratedLicenceError: class extends Error {},
}));
vi.mock('@/lib/db', () => ({
  verifyPackagerApiKey: () => true,
  getDatabase: () => ({ jobs: { claim: async () => state.job, update: state.update } }),
}));
vi.mock('@/lib/features', () => ({ getFeatureFlags: () => ({ localPackager: true }) }));
vi.mock('@/lib/update-policies/ensure-policy', () => ({ ensureUpdatePolicy: vi.fn(), parseCartUpdatePolicy: vi.fn() }));
vi.mock('@/lib/installer-preflight', () => ({ enforceInstallerPreflight: vi.fn().mockResolvedValue(undefined), InstallerPreflightError: class extends Error {} }));
vi.mock('@/lib/winget-dependencies', () => ({ resolveWingetPackageDependencies: vi.fn().mockResolvedValue([]) }));

import { describeQaGateError, enforceQaGate, QaGateNotPassedError } from './gate';
import { POST } from '@/app/api/packager/jobs/route';
import { triggerPackagingWorkflow, type WorkflowInputs } from '@/lib/github-actions';

const app = CURATED_APPS[0], release = releaseFixture(app), hash = release.installerSha256.toLowerCase();
const input = () => ({ wingetId: app.packageId, version: release.candidate.version, architecture: app.architecture,
  installerSha256: hash.toUpperCase(), sourceType: 'curated' as const, curatedReleaseId: release.id });
const held = (malicious = 2) => ({ sha256: hash, next_check_at: '2030-01-01T00:00:00Z', malicious_verdicts: malicious });
const claim = () => POST(new NextRequest('https://example.test/api/packager/jobs', { method: 'POST',
  headers: { Authorization: 'Bearer synthetic-fixture', 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: 'fixture-job', packagerId: 'fixture-packager' }) }));
const dispatch = () => {
  const item = buildCuratedCartItem(app, release);
  const inputs = { ...curatedWorkflowInput(item), installerUrl: item.installerUrl, curatedReleaseId: release.id,
    sourceType: 'curated', jobId: 'fixture-job', tenantId: 'fixture-tenant', callbackUrl: 'https://example.test/callback' } as WorkflowInputs;
  return triggerPackagingWorkflow(inputs, { token: 'synthetic-fixture', owner: 'fixture', repo: 'fixture', workflowsRepo: 'fixture', workflowFile: 'fixture.yml', ref: 'main' }, { skipRunCapture: true });
};
beforeEach(() => {
  state.rows = []; state.readError = false; state.thrown = false; state.nullData = false; state.configured = true;
  state.custom = false; state.tables = []; state.hashes = []; state.releasedFilter.mockClear(); state.update.mockReset().mockResolvedValue(true);
  state.approved = { app, release, installer: {} };
  state.job = { id: 'fixture-job', winget_id: app.packageId, version: release.candidate.version, architecture: app.architecture,
    installer_sha256: hash, tenant_id: 'fixture-tenant', package_config: { sourceType: 'curated', curatedReleaseId: release.id }, packaging_started_at: '2030-01-01T00:00:00Z' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});
afterEach(() => vi.unstubAllGlobals());

describe('curated customer exact installer security boundary', () => {
  it.each([0, 1, 2])('refuses an unreleased hold with %s malicious verdicts despite signed approval', async count => {
    state.rows = [held(count)];
    await expect(enforceQaGate(input())).rejects.toBeInstanceOf(QaGateNotPassedError);
    expect(state.hashes).toEqual([hash]); expect(state.releasedFilter).toHaveBeenCalledWith('released_at', null);
  });
  it.each(['readError', 'thrown', 'nullData'] as const)('fails closed on %s', async key => {
    state[key] = true; await expect(enforceQaGate(input())).rejects.toMatchObject({ details: { reason: 'reputation' } });
  });
  it.each([{ next_check_at: 'invalid' }, { malicious_verdicts: -1 }, { sha256: 'invalid' }])('refuses unverifiable hold data %j', async invalid => {
    state.rows = [{ ...held(), ...invalid }]; await expect(enforceQaGate(input())).rejects.toThrow();
  });
  it.each(['invalid', '0'.repeat(64), hash + '\n'])('refuses an unverifiable signed hash %s', async invalid => {
    state.approved = { app, release: { ...release, installerSha256: invalid } };
    await expect(enforceQaGate({ ...input(), installerSha256: invalid })).rejects.toThrow(); expect(state.tables).toEqual([]);
  });
  it('preserves clean Defender approval without requiring a VT row', async () => {
    await expect(enforceQaGate(input())).resolves.toBeUndefined(); expect(state.tables).toEqual(['qa_installer_security_holds']);
  });
  it('does not prescribe a fresh VirusTotal scan when curated eligibility cannot be read', async () => {
    state.readError = true;
    const error = await enforceQaGate(input()).catch(error => error);
    expect(error).toBeInstanceOf(QaGateNotPassedError);
    expect(describeQaGateError(error)).not.toContain('VirusTotal');
    expect(describeQaGateError(error)).toContain('eligibility');
  });
  it('preserves explicit released holds and ignores unrelated installer bytes', async () => {
    state.rows = [{ ...held(), released_at: '2029-01-01T00:00:00Z' }, { ...held(), sha256: 'b'.repeat(64) }];
    await expect(enforceQaGate(input())).resolves.toBeUndefined(); expect(state.tables).toEqual(['qa_installer_security_holds']);
  });
  it.each([{ qaOverride: true }, { sourceType: 'custom' as const }, { installerSha256: 'b'.repeat(64) }, { architecture: 'wrong' }])('preserves provenance refusal %j', async override => {
    state.rows = [held()]; await expect(enforceQaGate({ ...input(), ...override })).rejects.toThrow(); expect(state.tables).toEqual([]);
  });
  for (const custom of [false, true]) {
    describe(custom ? 'verified custom profile' : 'default profile', () => {
      beforeEach(() => { state.custom = custom; state.job.package_config = { sourceType: 'curated', curatedReleaseId: release.id, psadtConfig: custom ? { deployMode: 'Interactive' } : {} }; });
      it.each(['held', 'readError', 'unconfigured'] as const)('never admits local execution when %s', async condition => {
        if (condition === 'held') state.rows = [held()]; else if (condition === 'readError') state.readError = true; else state.configured = false;
        const response = await claim(); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ claimed: false });
        expect(state.update).toHaveBeenCalledWith('fixture-job', expect.objectContaining({ status: 'awaiting_qa', packager_id: null, claimed_at: null }), expect.anything());
      });
      it.each(['held', 'readError', 'unconfigured'] as const)('never dispatches hosted execution when %s', async condition => {
        if (condition === 'held') state.rows = [held()]; else if (condition === 'readError') state.readError = true; else state.configured = false;
        await expect(dispatch()).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
      });
      it.each(['clean', 'released', 'unrelated'] as const)('preserves eligible %s execution at both sinks', async condition => {
        if (condition === 'released') state.rows = [{ ...held(), released_at: '2029-01-01T00:00:00Z' }];
        if (condition === 'unrelated') state.rows = [{ ...held(), sha256: 'b'.repeat(64) }];
        expect(await (await claim()).json()).toMatchObject({ claimed: true });
        await expect(dispatch()).resolves.toMatchObject({ success: true }); expect(fetch).toHaveBeenCalledTimes(1);
      });
    });
  }
});
