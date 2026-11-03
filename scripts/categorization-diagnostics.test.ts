import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'vitest';

const require = createRequire(import.meta.url);

const source = fs.readFileSync(new URL('../.github/scripts/categorize-apps.js', import.meta.url), 'utf8');
const batch = [{ winget_id: 'Example.One' }, { winget_id: 'Example.Two' }];
function load(responses: any[] = []) {
  const warnings: string[] = [], requests: any[] = [], delays: number[] = [];
  const fixtureModule = { exports: {} as any };
  const context = {
    module: fixtureModule, require: Object.assign((name: string) => name === '@supabase/supabase-js'
      ? { createClient() { throw new Error('Database access forbidden'); } } : require(name), { main: {} }),
    process: { env: {}, exit() { throw new Error('Entry point ran during import'); } },
    console: { log() {}, warn: (s: string) => warnings.push(s), error() {} },
    AbortSignal, setTimeout: (fn: () => void, ms: number) => { delays.push(ms); fn(); },
    fetch: async (_url: string, options: { body: string }) => {
      requests.push(JSON.parse(options.body));
      assert.ok(responses.length, 'Unexpected request');
      const response = responses.shift();
      return { ok: true, json: async () => response };
    },
  };
  vm.runInNewContext(source, context, { filename: 'categorize-apps.js' });
  return { ...fixtureModule.exports, warnings, requests, delays };
}
const plain = (v: any) => JSON.parse(JSON.stringify(v));
const response = (ids: string[], extra = {}) => ({ id: 'resp_test123', status: 'completed',
  output_text: JSON.stringify({ classifications: ids.map(winget_id => ({ winget_id, category: 'utilities', confidence: 0.9 })) }), ...extra });

test('exact response remains eligible, including reversed order', () => {
  const { validateClassifications } = load();
  assert.equal(validateClassifications(batch, [{ winget_id: 'Example.Two' }, { winget_id: 'Example.One' }]).valid, true);
});
for (const [name, ids, counts] of [
  ['missing', ['Example.One'], [1, 0, 0]],
  ['extra', ['Example.One', 'Example.Two', 'Example.Three'], [0, 1, 0]],
  ['duplicate', ['Example.One', 'Example.One'], [1, 0, 1]],
  ['changed case', ['example.one', 'Example.Two'], [1, 1, 0]],
] as [string, string[], number[]][]) test(`${name} response is refused with specific counts`, () => {
  const result = load().validateClassifications(batch, ids.map(winget_id => ({ winget_id })));
  assert.equal(result.valid, false);
  assert.deepEqual([result.diagnostics.missingCount, result.diagnostics.unexpectedCount, result.diagnostics.duplicateCount], counts);
  assert.equal(result.diagnostics.returnedCount, ids.length);
});

test('diagnostic lists are bounded fingerprints and never echo hostile model strings', () => {
  const hostile = 'SECRET_SENTINEL\n::error::\u202e```<script>' + 'x'.repeat(10000);
  const result = load().validateClassifications(batch, Array.from({ length: 30 }, (_, i) => ({ winget_id: hostile + i })));
  assert.equal(result.diagnostics.unexpectedCount, 30);
  assert.equal(result.diagnostics.unexpectedIdHashes.length, 10);
  assert.ok(result.diagnostics.unexpectedIdHashes.every((s: string) => /^[a-f0-9]{64}$/.test(s)));
  const text = JSON.stringify(result);
  assert.ok(!text.includes('SECRET_SENTINEL') && !text.includes('::error::') && !text.includes('\u202e'));
  assert.ok(text.length < 3000);
});

test('invalid or absent IDs preserve refusal and report invalid item count', () => {
  const result = load().validateClassifications(batch, [null, { winget_id: 42 }]);
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.invalidIdCount, 2);
});

test('three rejected attempts retain safe API metadata and unchanged retry delays', async () => {
  const runtime = load([response(['Example.One']), response(['Example.One']), response(['Example.One'], {
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
  })]);
  await assert.rejects(runtime.callOpenAI(batch), (error: any) => {
    assert.equal(error.classificationDiagnostics.length, 3);
    const last = error.classificationDiagnostics[2];
    assert.equal(last.attempt, 3);
    assert.equal(last.responseStatus, 'incomplete');
    assert.equal(last.incompleteReason, 'max_output_tokens');
    assert.equal(last.responseId, 'resp_test123');
    assert.equal(last.missingCount, 1);
    return true;
  });
  assert.deepEqual(runtime.delays, [1200, 2400]);
  assert.equal(runtime.requests.length, 3);
  assert.equal(runtime.warnings.filter((s: string) => s.startsWith('Classification rejection: ')).length, 3);
});

test('a later exact response succeeds without changing payload or accepting the earlier partial result', async () => {
  const runtime = load([response(['Example.One']), response(['Example.One', 'Example.Two'])]);
  const result = await runtime.callOpenAI(batch);
  assert.equal(result.classifications.length, 2);
  assert.deepEqual(runtime.requests[0], runtime.requests[1]);
  assert.deepEqual(runtime.delays, [1200]);
});

test('outer metadata is allowlisted and raw output is never included', async () => {
  const runtime = load(Array.from({ length: 3 }, () => response(['EVIL_SENTINEL\n::error::'], {
    id: 'resp_bad\n::error::', status: 'SECRET_SENTINEL', incomplete_details: { reason: '<script>SECRET_SENTINEL</script>' },
  })));
  await assert.rejects(runtime.callOpenAI(batch), (error: any) => {
    const data = JSON.stringify(error.classificationDiagnostics);
    assert.ok(!data.includes('SENTINEL') && !data.includes('::error::'));
    assert.equal(error.classificationDiagnostics[0].responseId, null);
    assert.equal(error.classificationDiagnostics[0].responseStatus, null);
    assert.equal(error.classificationDiagnostics[0].incompleteReason, null);
    return true;
  });
});

test('an earlier rejection survives a later response-format failure', async () => {
  const runtime = load([response(['Example.One']), { output_text: '' }, { output_text: '' }]);
  await assert.rejects(runtime.callOpenAI(batch), (error: any) => {
    assert.equal(error.message, 'OpenAI response did not include output_text');
    assert.equal(error.classificationDiagnostics.length, 1);
    assert.equal(error.classificationDiagnostics[0].missingCount, 1);
    return true;
  });
  assert.equal(runtime.requests.length, 3);
});

test('workflow summary persists the bounded diagnostics without raw batch IDs or error text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'categorization-test-'));
  try {
    const file = path.join(dir, 'summary.md');
    const runtime = load();
    const diagnostics = plain(runtime.validateClassifications(batch, [{ winget_id: 'Example.One' }]).diagnostics);
    runtime.writeFailureSummary([{ batch: 1, winget_ids: ['SECRET_SENTINEL'], error: 'SECRET_SENTINEL', classificationDiagnostics: [diagnostics] }], file);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes('Categorization rejection diagnostics'));
    assert.ok(text.includes('"missingCount":1'));
    assert.ok(!text.includes('SECRET_SENTINEL'));
    assert.ok(!text.includes('Example.Two'));
    const capped = path.join(dir, 'capped.md');
    runtime.writeFailureSummary(Array.from({ length: 25 }, (_, i) => ({ batch: i + 1, classificationDiagnostics: [diagnostics] })), capped);
    const cappedText = fs.readFileSync(capped, 'utf8');
    assert.ok(cappedText.includes('"batch":20'));
    assert.ok(!cappedText.includes('"batch":21'));
    runtime.writeFailureSummary([], path.join(dir, 'unused.md'));
    assert.ok(!fs.existsSync(path.join(dir, 'unused.md')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
