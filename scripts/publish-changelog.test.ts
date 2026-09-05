import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { apiRequest, publicationPayload, publishEntry, validateConfig, validateEntry } from './publish-changelog.mjs';
import config from '../.ugurlabs/changelog.json';

const entry = { title: 'A faster app catalog', summary: 'Browse large catalogs with smoother scrolling.', type: 'improved' };
const filename = 'frontend-performance.json';
const commit = 'a'.repeat(40);
const url = 'https://changelog.ugurlabs.com/api/changelog/intuneget';

describe('automatic changelog publication', () => {
  it('uses stable product-scoped keys and commit dates across reruns', () => {
    const payload = publicationPayload(config, entry, filename, commit, '2026-09-05');
    expect(payload).toEqual({ ...entry, publishedOn: '2026-09-05', sourceCommit: commit, idempotencyKey: 'intuneget:entry:frontend-performance' });
    expect(publicationPayload(config, entry, filename, commit, '2026-09-05')).toEqual(payload);
    expect(() => publicationPayload(config, entry, filename, commit, '2026-02-30')).toThrow();
  });

  it.each([
    { ...entry, summary: 'Short' }, { ...entry, type: 'breaking' },
    { ...entry, sourceUrl: 'https://example.com/?token=private' },
    { ...entry, secret: 'unexpected-field' },
  ])('rejects invalid public entries: %j', value => {
    expect(() => validateEntry(value, filename)).toThrow();
  });

  it('rejects alternate credential destinations and unsafe filenames', async () => {
    expect(() => validateConfig({ ...config, apiUrl: 'https://example.com' })).toThrow();
    expect(() => validateEntry(entry, '../unexpected.json')).toThrow();
    await expect(apiRequest('POST', 'https://example.com', 'test-only', {})).rejects.toThrow('destination');
  });

  it('retries an ambiguous publication with the same body/key and accepts the duplicate response', async () => {
    const payload = publicationPayload(config, entry, filename, commit, '2026-09-05');
    const request = vi.fn().mockRejectedValueOnce(new Error('network timeout')).mockResolvedValue({ id: 'entry-id', created: false });
    await expect(publishEntry(url, 'test-only', payload, request)).resolves.toEqual({ id: 'entry-id', created: false });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);
  });

  it('does not retry rejected credentials or treat malformed responses as success', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Changelog API POST failed with HTTP 401'));
    await expect(publishEntry(url, 'test-only', entry, request)).rejects.toThrow('401');
    expect(request).toHaveBeenCalledTimes(1);
    await expect(publishEntry(url, 'test-only', entry, vi.fn().mockResolvedValue({}))).rejects.toThrow('Unexpected publication');
  });

  it('omits credentials on public reads and refuses redirects on writes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [] }) });
    await apiRequest('GET', `${url}?limit=100`, 'test-only', undefined, fetchMock);
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    await apiRequest('POST', url, 'test-only', entry, fetchMock);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: 'error', headers: { Authorization: 'Bearer test-only' } });
  });

  it('gates credentialed publication on successful same-repository push CI for main', () => {
    const workflow = parse(readFileSync('.github/workflows/publish-changelog.yml', 'utf8'));
    expect(workflow.on).toEqual({ workflow_run: { workflows: ['CI'], types: ['completed'], branches: ['main'] } });
    expect(workflow.permissions).toEqual({ contents: 'read' });
    const job = workflow.jobs.publish;
    for (const condition of ["conclusion == 'success'", "event == 'push'", "head_branch == 'main'", 'head_repository.full_name == github.repository']) expect(job.if).toContain(condition);
    expect(job.steps[0].with.ref).toBe('${{ github.event.workflow_run.head_sha }}');
    expect(job.steps[0].with['persist-credentials']).toBe(false);
  });

  it('registers a missing product, publishes committed entries, verifies the feed, and safely reruns', () => {
    const directory = mkdtempSync(join(tmpdir(), 'intuneget-changelog-test-'));
    try {
      mkdirSync(join(directory, '.ugurlabs/entries'), { recursive: true });
      writeFileSync(join(directory, '.ugurlabs/changelog.json'), JSON.stringify(config));
      writeFileSync(join(directory, '.ugurlabs/entries', filename), JSON.stringify(entry));
      for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Test entry']]) {
        expect(spawnSync('git', args, { cwd: directory }).status).toBe(0);
      }
      const scriptUrl = pathToFileURL(resolve('scripts/publish-changelog.mjs')).href;
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import {main} from ${JSON.stringify(scriptUrl)};
        let registered=false, publications=0, registrations=0, firstPayload;
        globalThis.fetch=async (url, options)=>{
          let value;
          if(options.method==='GET') {
            assert.equal(options.headers.Authorization, undefined);
            if(!registered) return {ok:false,status:404};
            value={product:{id:'intuneget',name:'IntuneGet',websiteUrl:'https://www.intuneget.com/'},entries:publications?[{id:'published-id'}]:[]};
          } else {
            assert.equal(options.headers.Authorization, 'Bearer test-only');
            assert.equal(options.redirect, 'error');
            if(options.method==='PUT') {registered=true;registrations++;value={product:{slug:'intuneget'}};}
            else {
              const payload=JSON.parse(options.body);
              assert.equal(payload.idempotencyKey,'intuneget:entry:frontend-performance');
              if(firstPayload) assert.deepEqual(payload,firstPayload);
              firstPayload=payload;
              value={id:'published-id',created:publications++===0};
            }
          }
          return {ok:true,status:200,json:async()=>value};
        };
        await main(); await main();
        assert.equal(registrations,1);
        assert.equal(publications,2);
      `], { cwd: directory, env: { ...process.env, CHANGELOG_PUBLISH_TOKEN: 'test-only' }, encoding: 'utf8' });
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Published: frontend-performance.json');
      expect(result.stdout).toContain('Already published: frontend-performance.json');
      expect(result.stdout).toContain('Verified public IntuneGet feed (1 new entries)');
      expect(result.stdout).not.toContain('test-only');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
