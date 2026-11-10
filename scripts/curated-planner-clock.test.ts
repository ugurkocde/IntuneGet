import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { CURATED_APPS } from '../lib/curated-catalog/definitions';
import { createCandidate } from '../lib/curated-catalog/core.mjs';
import { discoverCandidate, upgradeBaselineFromApproved } from '../lib/curated-catalog/discovery.mjs';
import type { CuratedRelease } from '../lib/curated-catalog/types';

afterEach(() => vi.useRealTimers());

it('selects an approved archive baseline after discovery advances beyond the plan clock', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T10:00:00Z'));
  const now = new Date();
  const app = CURATED_APPS.find(app => app.id === 'calibre')!;
  const previousHash = 'a'.repeat(64);
  const latest = {
    candidate: createCandidate(app, {
      version: '9.16.0',
      installerUrl: 'https://github.com/kovidgoyal/calibre/releases/download/v9.16.0/calibre-64bit-9.16.0.msi',
      vendorSha256: previousHash,
    }),
    installerSha256: previousHash,
  } as CuratedRelease;

  vi.setSystemTime(new Date(now.getTime() + 1000));
  const fetcher = vi.fn(async () => new Response(JSON.stringify({
    tag_name: 'v9.17.0',
    html_url: 'https://github.com/kovidgoyal/calibre/releases/tag/v9.17.0',
    assets: [{
      name: 'calibre-64bit-9.17.0.msi',
      browser_download_url: 'https://github.com/kovidgoyal/calibre/releases/download/v9.17.0/calibre-64bit-9.17.0.msi',
      digest: 'sha256:' + 'b'.repeat(64),
    }],
  }), { headers: { 'content-type': 'application/json' } }));
  const discovered = await discoverCandidate(app, fetcher);
  if (discovered.state !== 'candidate') throw new Error('Expected a discovered release');
  const candidate = discovered.candidate;
  expect(() => upgradeBaselineFromApproved(app, latest, candidate, now)).toThrow(/future/);

  // Exercise the production call without starting the CLI, GH or VM orchestration.
  const source = ts.createSourceFile(
    'curated-automation.mjs',
    readFileSync(new URL('./curated-automation.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS,
  );
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'upgradeBaselineFromApproved') calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(calls).toHaveLength(1);
  const selected = runInNewContext(
    calls[0].getText(source),
    { app, latest, candidate, now, Date, upgradeBaselineFromApproved },
    { timeout: 1000 },
  );
  expect(selected).toMatchObject({
    appId: 'calibre',
    version: '9.16.0',
    installerUrl: 'https://download.calibre-ebook.com/9.16.0/calibre-64bit-9.16.0.msi',
    vendorSha256: previousHash,
  });
  expect(selected.id).not.toBe(latest.candidate.id);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
