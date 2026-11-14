import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';

const source = ts.createSourceFile('curated-automation.mjs', readFileSync(new URL('./curated-automation.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const publish = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'publish')!;
const releases = [
  { id: 'old-withdrawal', installerSha256: 'a'.repeat(64) },
  { id: 'held-latest', installerSha256: 'b'.repeat(64) },
  { id: 'held-fallback', installerSha256: 'c'.repeat(64) },
  { id: 'clean', installerSha256: 'd'.repeat(64) },
];

function fixture(held: string[], manualWithdraw = '') {
  const readHold = vi.fn(async (hash: string) => held.includes(hash));
  const sign = vi.fn((_payload: unknown) => { throw new Error('signing boundary'); });
  const write = vi.fn();
  const run = () => runInNewContext(`(${publish.getText(source)})()`, {
    assertCuratedSecurityProject: () => {}, trustedKeys: async () => ({}),
    readJson: async () => ({ fixture: {} }), CATALOG_PATH: 'catalog.json', KEYS_PATH: 'keys.json',
    loadCatalog: async () => ({ payload: { releases, withdrawnReleaseIds: ['old-withdrawal'] } }),
    process: { env: { CURATED_CATALOG_SIGNING_KEY: 'fixture-key', CURATED_APPROVALS: '[]', CURATED_WITHDRAW_RELEASE_ID: manualWithdraw, CURATED_WITHDRAW_REASON: 'An existing explicit withdrawal reason.' } },
    curatedInstallerSecurityHeld: readHold, CURATED_APPS: [], canonicalJson: JSON.stringify,
    sha256: () => 'e'.repeat(64), signCatalog: sign, writeFile: write, console: { log: () => {} },
  });
  return { run, readHold, sign, write };
}

it('withdraws already-published held hashes, including older fallbacks, before renewal signing', async () => {
  const f = fixture([releases[1].installerSha256, releases[2].installerSha256]);
  await expect(f.run()).rejects.toThrow('signing boundary');
  expect(f.sign.mock.calls[0][0]).toMatchObject({ releases, withdrawnReleaseIds: ['old-withdrawal', 'held-latest', 'held-fallback'] });
  expect(f.readHold.mock.calls.map(([hash]) => hash)).toEqual(releases.slice(1).map(r => r.installerSha256));
  expect(f.write).not.toHaveBeenCalled();
});

it('fails closed before signing or writing when any retained release hold lookup is unavailable', async () => {
  const f = fixture([]);
  f.readHold.mockRejectedValueOnce(new Error('hold lookup unavailable'));
  await expect(f.run()).rejects.toThrow('hold lookup unavailable');
  expect(f.sign).not.toHaveBeenCalled();
  expect(f.write).not.toHaveBeenCalled();
});

it('preserves clean releases and existing withdrawals without duplicating an explicit withdrawal', async () => {
  const f = fixture([], 'held-latest');
  await expect(f.run()).rejects.toThrow('signing boundary');
  expect(f.sign.mock.calls[0][0]).toMatchObject({ releases, withdrawnReleaseIds: ['old-withdrawal', 'held-latest'] });
  expect(f.readHold.mock.calls.map(([hash]) => hash)).toEqual(releases.slice(2).map(r => r.installerSha256));
});
