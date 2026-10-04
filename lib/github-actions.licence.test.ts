import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURATED_APPS } from './curated-catalog/definitions';
import { buildCuratedCartItem, curatedWorkflowInput } from './curated-catalog/package';
import { releaseFixture, signedFixture } from './curated-catalog/test-fixtures';
import { CuratedLicenceError } from './curated-catalog/licence';
import { triggerPackagingWorkflow, type GitHubActionsConfig } from './github-actions';

const state = vi.hoisted(() => ({ envelope: {} as Record<string, unknown>, acceptances: new Set<string>() }));
vi.mock('@/catalog/curated/catalog.json', () => ({ default: state.envelope }));
vi.mock('@/lib/db', () => ({
  getDatabase: () => ({
    curatedLicenceAttestations: {
      get: async (tenantId: string, id: string, version: string) => state.acceptances.has(`${tenantId}|${id}|${version}`)
        ? { id: 'acceptance', tenant_id: tenantId, app_id: 'acrobat-reader', attestation_id: id, attestation_version: version,
            accepted_by_user_id: 'admin', accepted_by_email: null, accepted_at: '2026-10-04T00:00:00.000Z' }
        : null,
    },
  }),
}));
vi.mock('./installer-preflight', async (importOriginal) => ({
  ...await importOriginal<typeof import('./installer-preflight')>(),
  enforceInstallerPreflight: vi.fn(),
}));
vi.mock('./qa/gate', async (importOriginal) => ({
  ...await importOriginal<typeof import('./qa/gate')>(),
  enforceQaGate: vi.fn(),
}));

const config: GitHubActionsConfig = {
  token: 'test-token', owner: 'example', repo: 'public-repo', workflowsRepo: 'workflow-repo',
  workflowFile: 'package-intunewin.yml', ref: 'main',
};
const acrobat = CURATED_APPS.find(app => app.id === 'acrobat-reader')!;
const attestation = acrobat.licenceAttestation!;

describe('hosted dispatch licence enforcement', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let inputs: Parameters<typeof triggerPackagingWorkflow>[0];
  let chromeInputs: Parameters<typeof triggerPackagingWorkflow>[0];
  beforeEach(() => {
    state.acceptances.clear();
    const fixture = signedFixture([releaseFixture(acrobat), releaseFixture(CURATED_APPS[0])]);
    Object.keys(state.envelope).forEach(key => delete state.envelope[key]);
    Object.assign(state.envelope, fixture.envelope);
    vi.stubEnv('CURATED_CATALOG_PUBLIC_KEYS', JSON.stringify(fixture.keys));
    fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const build = (release: (typeof fixture.envelope.payload.releases)[number], app = acrobat) => {
      const item = buildCuratedCartItem(app, release);
      return {
        ...curatedWorkflowInput(item), jobId: 'job-1', tenantId: 'tenant-a', installerUrl: item.installerUrl,
        callbackUrl: 'https://example.test/api/package/callback', hashValidationMode: 'strict' as const,
        sourceType: 'curated' as const, curatedReleaseId: item.curatedReleaseId,
        uninstallCommand: item.uninstallCommand,
      };
    };
    inputs = build(fixture.envelope.payload.releases[0]);
    chromeInputs = build(fixture.envelope.payload.releases[1], CURATED_APPS[0]);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('refuses to dispatch before the tenant accepts the agreement', async () => {
    await expect(triggerPackagingWorkflow(inputs, config, { skipRunCapture: true })).rejects.toBeInstanceOf(CuratedLicenceError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('refuses another tenant\'s acceptance and an earlier agreement version', async () => {
    state.acceptances.add(`tenant-b|${attestation.id}|${attestation.version}`);
    state.acceptances.add(`tenant-a|${attestation.id}|2025-01-01`);
    await expect(triggerPackagingWorkflow(inputs, config, { skipRunCapture: true })).rejects.toMatchObject({ code: 'CURATED_LICENCE_NOT_ACCEPTED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('dispatches once the tenant accepted the current agreement', async () => {
    state.acceptances.add(`tenant-a|${attestation.id}|${attestation.version}`);
    await expect(triggerPackagingWorkflow(inputs, config, { skipRunCapture: true })).resolves.toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('leaves curated applications without an agreement unaffected', async () => {
    await expect(triggerPackagingWorkflow(chromeInputs, config, { skipRunCapture: true })).resolves.toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
