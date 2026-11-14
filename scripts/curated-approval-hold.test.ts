import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';

const source = ts.createSourceFile('curated-automation.mjs', readFileSync(new URL('./curated-automation.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const declaration = (name: string) => source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name) as ts.FunctionDeclaration;
const publish = declaration('publish');
const selection = publish.body!.statements.find(node => ts.isForOfStatement(node))!;
const hash = 'a'.repeat(64);
const otherHash = 'b'.repeat(64);

function fixture() {
  const held = new Set<string>();
  const readHold = vi.fn(async (value: string) => held.has(value));
  const runEvidence = vi.fn(async (id: number) => ({ artifact: { id }, artifactSha256: 'c'.repeat(64), report: {
    candidate: { id: String(id), appId: String(id) }, provenance: { websiteCommit: 'd'.repeat(40) },
    inspection: { current: { installerSha256: id === 42 ? hash : otherHash } },
  } }));
  const approve = runInNewContext(`(${declaration('approvedRelease').getText(source)})`, {
    QA: 'owner/qa', WEBSITE: 'owner/site', VERIFY_WORKFLOW: 'curated-catalog-verification.yml', AUTOMATED_APPROVER: 'fixture',
    gh: async (args: string[]) => args[1].includes('/compare/') ? { status: 'identical' } : { status: 'completed', conclusion: 'success', head_branch: 'main', path: '.github/workflows/curated-catalog-verification.yml', head_sha: 'e'.repeat(40) },
    runEvidence, appById: (id: string) => ({ id }), automatedApprovalExceptions: () => ({}),
    releaseFromVerification: (report: { candidate: { id: string; appId: string }; inspection: { current: { installerSha256: string } } }) => ({ id: report.candidate.appId, candidate: report.candidate, installerSha256: report.inspection.current.installerSha256 }),
    assertCuratedPackageProfile: () => {}, curatedInstallerSecurityHeld: readHold,
  });
  return { held, readHold, approve };
}

it('omits a hold created after dispatch and planning while publishing the unrelated eligible release', async () => {
  const f = fixture();
  expect(await f.approve(42, '2026-11-14T00:00:00Z')).not.toBeNull();
  f.held.add(hash); // Ordinary reputation checking creates a hold after the successful curated lifecycle.
  const releases: Array<{ id: string }> = [];
  const evidenceFiles: unknown[] = [];
  await runInNewContext(`(async () => { ${selection.getText(source)} })()`, {
    process: { env: { CURATED_APPROVALS: '[42,43]' } }, approvedAt: '2026-11-14T00:01:00Z',
    approvedRelease: f.approve, releaseAlreadySigned: () => false, releases, withdrawnReleaseIds: [], evidenceFiles, console: { log: () => {} },
  });
  expect(releases.map(release => release.id)).toEqual(['43']);
  expect(evidenceFiles).toHaveLength(1);
  expect(f.readHold.mock.calls.map(call => call[0])).toEqual([hash, hash, otherHash]);
});

it('does not turn a held passing run into a failed lifecycle or enqueue another verification', async () => {
  let successBlock: ts.IfStatement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.expression.getText(source) === 'success' && node.getText(source).includes('approvals.push(success.id)')) successBlock = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(successBlock).toBeDefined();
  const approvals: number[] = [], failures: unknown[] = [];
  const row: { state?: string } = {};
  await runInNewContext(`(async () => { for (let i=0;i<1;i++) { ${successBlock!.getText(source)} } })()`, {
    success: { id: 42 }, now: new Date(), approvedRelease: async () => null, approvals, failures, row,
  });
  expect(approvals).toEqual([]);
  expect(failures).toEqual([]);
  expect(row.state).toMatch(/held/i);
});

it('does not retry a passing lifecycle when its current security evidence is unavailable', async () => {
  const f = fixture();
  f.readHold.mockRejectedValueOnce(new Error('storage unavailable'));
  let block: ts.IfStatement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.expression.getText(source) === 'success' && node.getText(source).includes('approvals.push(success.id)')) block = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  const approvals: number[] = [], failures: unknown[] = [];
  const row: { state?: string } = {};
  await runInNewContext(`(async () => { for (let i=0;i<1;i++) { ${block!.getText(source)} } })()`, {
    success: { id: 42 }, now: new Date(), approvedRelease: f.approve, approvals, failures, row,
  });
  expect(approvals).toEqual([]);
  expect(failures).toEqual([]);
  expect(row.state).toMatch(/unavailable/i);
});

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function holdReader(response: unknown, status = 200, configured = true, origin = 'https://mbhajocqtogfbgojkwhd.supabase.co') {
  vi.resetModules();
  vi.stubEnv('SUPABASE_URL', configured ? origin : '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', configured ? 'fixture-service-key' : '');
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(response), { status }));
  vi.stubGlobal('fetch', fetcher);
  const store = await import('./curated-qa-store.mjs');
  return { read: store.curatedInstallerSecurityHeld, fetcher };
}

it('checks the exact lowercase hash and every unreleased hold, including unknown coverage with zero detections', async () => {
  const { read, fetcher } = await holdReader([{ sha256: hash }]);
  expect(await read(hash.toUpperCase())).toBe(true);
  expect(fetcher.mock.calls[0][0]).toBe(`https://mbhajocqtogfbgojkwhd.supabase.co/rest/v1/qa_installer_security_holds?select=sha256&sha256=eq.${hash}&released_at=is.null&limit=1`);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET' });
});

it('allows a release only when the current unreleased-hold query is empty', async () => {
  const { read } = await holdReader([]);
  expect(await read(hash)).toBe(false);
});

it.each([
  'https://another-project.supabase.co', '', 'not-a-url',
  'http://mbhajocqtogfbgojkwhd.supabase.co',
  'https://mbhajocqtogfbgojkwhd.supabase.co/unexpected',
  'https://mbhajocqtogfbgojkwhd.supabase.co?project=other',
  'https://mbhajocqtogfbgojkwhd.supabase.co#other',
  'https://user:password@mbhajocqtogfbgojkwhd.supabase.co',
])('refuses unqualified hold storage before a successful empty response can admit a release: %s', async origin => {
  const { read, fetcher } = await holdReader([], 200, true, origin);
  await expect(read(hash)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([null, {}, [{ sha256: otherHash }]])('fails closed on malformed hold evidence %j', async response => {
  const { read } = await holdReader(response);
  await expect(read(hash)).rejects.toThrow();
});

it('fails closed when hold storage cannot be read', async () => {
  const { read } = await holdReader({}, 503);
  await expect(read(hash)).rejects.toThrow(/HTTP 503/);
});

it('fails closed without storage credentials or with an invalid installer hash', async () => {
  const { read, fetcher } = await holdReader([], 200, false);
  await expect(read(hash)).rejects.toThrow();
  await expect(read('not-a-hash')).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
