import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({ config: vi.fn(), validate: vi.fn(), process: vi.fn(), post: vi.fn() }));
vi.mock('../dist/config.js', () => ({ loadConfig: mocks.config, validateConfig: mocks.validate }));
vi.mock('../dist/graph-client.js', () => ({ GraphClient: class { post = undefined; } }));
vi.mock('../dist/job-processor.js', () => ({ JobProcessor: class {
  constructor(private config: unknown, private sink: unknown) {}
  processJob(job: unknown) { return mocks.process(this.config, this.sink, job); }
} }));
// The operator command is JavaScript and is not part of the TypeScript build.
// @ts-expect-error No declaration file for the one-off proof script.
import { fixtureJob, runSingleFixture } from '../qa/g7-single-fixture.mjs';
import { GraphClient } from '../dist/graph-client.js';

const tenant = '11111111-1111-4111-8111-111111111111';
const appId = '22222222-2222-4222-8222-222222222222';
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
let root: string, proof: string, stdout: ReturnType<typeof vi.spyOn>;
type Sink = { updateJobStatus(id: string, status: string, data?: unknown): Promise<void> };
type Job = ReturnType<typeof fixtureJob>;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'g7-unit-'));
  proof = path.join(root, 'proof');
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ azure: { tenantId: tenant }, paths: { work: 'unused', tools: 'unused' } });
  mocks.validate.mockReturnValue([]);
  Reflect.set(GraphClient.prototype, 'post', mocks.post);
  mocks.post.mockResolvedValue({ id: appId });
  stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform);
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
async function packaged(config: { paths: { work: string } }, sink: Sink, job: Job) {
  const out = path.join(config.paths.work, job.id + '-random', 'Output', 'intunewin-random');
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, 'Invoke-AppDeployToolkit.intunewin'), 'synthetic container');
  await fs.writeFile(path.join(out, 'IntunePackage.intunewin'), 'synthetic encrypted payload');
  await sink.updateJobStatus(job.id, 'uploading');
}
async function created(job: Job) {
  // Call the same prototype method that the product uploader uses.
  return GraphClient.prototype.post.call({}, '/deviceAppManagement/mobileApps', {
    description: job.package_config.description + '\nSource: IntuneGet.com',
  });
}
describe('human single-fixture G7 command', () => {
  it('pins the accepted manifest, profile, tenant and empty side-effect configuration', () => {
    const j = fixtureJob(tenant, 'marker');
    expect(j).toMatchObject({ tenant_id: tenant, winget_id: 'IntuneGet.Curated.NotepadPlusPlus', version: '8.9.8.1', architecture: 'x64', installer_type: 'nullsoft', install_scope: 'machine', installer_sha256: '26f3bcced788fadbac4e7e577b430ea2ce6060cf3bcad993ef4612ecd7d743da' });
    expect(j.package_config.psadtConfig.postInstallCommands).toEqual([]);
    expect(j.package_config.psadtConfig.detectionRules).toEqual(j.detection_rules);
    for (const k of ['forceCreate','assignments','relationships','categories','iconPath','assignmentMigration','sourceIntuneAppId','nestedInstallerType']) expect(j.package_config).not.toHaveProperty(k);
  });
  it('retains the outer package, records the created ID and invokes only one job', async () => {
    mocks.process.mockImplementation(async (c, s, j) => {
      await packaged(c, s, j);
      const app = await created(j);
      await s.updateJobStatus(j.id, 'deployed', { intune_app_id: app.id });
    });
    await runSingleFixture(proof, tenant);
    expect(mocks.process).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(path.join(proof, 'fixture.intunewin'), 'utf8')).toBe('synthetic container');
    const ledger = await fs.readFile(path.join(proof, 'receipt.jsonl'), 'utf8');
    expect(ledger).toContain(appId);
    expect(ledger.indexOf('create_attempted')).toBeLessThan(ledger.indexOf('"stage":"created"'));
    expect(ledger).toContain(createHash('sha256').update('synthetic container').digest('hex'));
    expect(stdout.mock.calls.flat().join('')).not.toContain(tenant);
    expect(GraphClient.prototype.post).toBe(mocks.post);
  });
  it('refuses rerunning an existing proof directory before processing', async () => {
    await fs.mkdir(proof);
    await expect(runSingleFixture(proof, tenant)).rejects.toThrow();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('refuses the wrong tenant before processing or creating a proof directory', async () => {
    await expect(runSingleFixture(proof, appId)).rejects.toThrow('DEV_CONFIGURATION_MISMATCH');
    expect(mocks.process).not.toHaveBeenCalled();
    await expect(fs.stat(proof)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('refuses a Windows host before reading configuration', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    await expect(runSingleFixture(proof, tenant)).rejects.toThrow('LINUX_NODE22_REQUIRED');
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it('refuses dotenv files in the working directory before product configuration', async () => {
    vi.spyOn(fs, 'stat').mockResolvedValueOnce({} as Awaited<ReturnType<typeof fs.stat>>);
    await expect(runSingleFixture(proof, tenant)).rejects.toThrow('EMPTY_WORKING_DIRECTORY_REQUIRED');
    expect(mocks.config).not.toHaveBeenCalled();
  });
  it('refuses invalid product configuration before a proof directory or Graph call', async () => {
    mocks.validate.mockReturnValue(['synthetic invalid configuration']);
    await expect(runSingleFixture(proof, tenant)).rejects.toThrow('DEV_CONFIGURATION_MISMATCH');
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('stops before any Graph call when the expected container is missing', async () => {
    mocks.process.mockImplementation(async (c, s, j) => {
      await fs.mkdir(path.join(c.paths.work, j.id + '-random', 'Output'), { recursive: true });
      await s.updateJobStatus(j.id, 'uploading');
      await created(j);
    });
    await expect(runSingleFixture(proof, tenant)).rejects.toThrow('STOP_RECONCILE');
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it.each(['throw', 'invalid'])('preserves an ambiguous create without retry: %s', async mode => {
    if (mode === 'throw') mocks.post.mockRejectedValue(new Error('synthetic secret URL ?token=do-not-print'));
    else mocks.post.mockResolvedValue({ id: 'not-an-id' });
    mocks.process.mockImplementation(async (c, s, j) => { await packaged(c, s, j); await created(j); });
    await expect(runSingleFixture(proof, tenant)).rejects.toThrow('STOP_RECONCILE');
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(path.join(proof, 'receipt.jsonl'), 'utf8')).toContain('ambiguous_lokka_required');
    expect(stdout.mock.calls.flat().join('')).not.toMatch(/do-not-print|not-an-id/);
  });
  it('reports a duplicate as no create and refuses success', async () => {
    mocks.process.mockImplementation(async (_c, s, j) => s.updateJobStatus(j.id, 'duplicate_skipped', { intune_app_id: appId }));
    await expect(runSingleFixture(proof, tenant)).rejects.toThrow('STOP_RECONCILE');
    expect(mocks.post).not.toHaveBeenCalled();
    const ledger = await fs.readFile(path.join(proof, 'receipt.jsonl'), 'utf8');
    expect(ledger).toContain('no_create_duplicate');
    expect(ledger).not.toContain(appId);
  });
  it('keeps a returned ID on later upload failure and restores the product method', async () => {
    mocks.process.mockImplementation(async (c, s, j) => { await packaged(c, s, j); await created(j); throw new Error('synthetic upload failure'); });
    await expect(runSingleFixture(proof, tenant)).rejects.toThrow('STOP_RECONCILE');
    const ledger = await fs.readFile(path.join(proof, 'receipt.jsonl'), 'utf8');
    expect(ledger).toContain('ambiguous_lokka_required');
    expect(ledger).toContain(appId);
    expect(GraphClient.prototype.post).toBe(mocks.post);
  });
  it('does not forward a second create or report a mismatched deployed ID as success', async () => {
    mocks.process.mockImplementation(async (c, s, j) => {
      await packaged(c, s, j); await created(j);
      await expect(created(j)).rejects.toThrow('UNEXPECTED_APP_CREATE');
      await s.updateJobStatus(j.id, 'deployed', { intune_app_id: tenant });
    });
    await expect(runSingleFixture(proof, tenant)).rejects.toThrow('STOP_RECONCILE');
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });
});
