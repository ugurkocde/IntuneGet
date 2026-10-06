import { describe, expect, it, vi } from 'vitest';
import { createCuratedGitHubClient, GITHUB_RATE_LIMIT_WAIT_MS } from './curated-github.mjs';

const start = Date.parse('2026-10-06T07:30:40Z');
const commits = ['api', 'repos/ugurkocde/IntuneGet-Workflows/commits?sha=main&path=qa%2Fcurated&per_page=1'];
function response(status: number, headers: Record<string, string> = {}, body: unknown = {}, newline = '\r\n') {
  return {
    status: status >= 400 ? 1 : 0,
    stdout: Buffer.concat([
      Buffer.from([`HTTP/2.0 ${status} Response`, ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`), '', ''].join(newline)),
      Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
    ]),
    stderr: Buffer.from(status >= 400 ? `gh: HTTP ${status}` : ''),
  };
}
const primaryLimit = (reset = start + 12 * 60_000) => response(403, {
  'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(reset / 1000),
}, { message: 'API rate limit exceeded for user ID 43906965.' });

function harness(responses: ReturnType<typeof response>[], options = {}) {
  let clock = start;
  const spawn = vi.fn(() => {
    const next = responses.shift();
    if (!next) throw new Error('Unexpected additional GitHub request');
    return next;
  });
  const wait = vi.fn(async (ms: number) => { clock += ms; });
  const log = vi.fn();
  const tokenFor = vi.fn(() => 'private-qa-token');
  const gh = createCuratedGitHubClient({ spawn, wait, log, tokenFor, now: () => clock, ...options });
  return { gh, spawn, wait, log, tokenFor, now: () => clock };
}

describe('curated GitHub quota recovery', () => {
  it('resumes the incident commit-history request only after the primary quota resets', async () => {
    const reset = Date.parse('2026-10-06T07:42:22Z');
    const history = [{ commit: { committer: { date: '2026-10-05T22:00:00Z' } } }];
    const h = harness([primaryLimit(reset), response(200, {}, history)]);
    await expect(h.gh(commits)).resolves.toEqual(history);
    expect(h.now()).toBe(reset + 1000);
    expect(h.spawn).toHaveBeenCalledTimes(2);
    expect(h.tokenFor).toHaveBeenCalledOnce();
    for (const call of h.spawn.mock.calls as unknown as [string, string[], { env: Record<string, string> }][]) {
      expect(call[0]).toBe('gh');
      expect(call[1]).toEqual([...commits, '--include']);
      expect(call[2].env.GH_TOKEN).toBe('private-qa-token');
    }
    expect(h.wait.mock.calls.every(([ms]) => ms <= 60_000)).toBe(true);
    expect(h.log.mock.calls.flat().join(' ')).not.toContain('private-qa-token');
  });

  it('covers a full hourly primary quota reset', async () => {
    const h = harness([primaryLimit(start + 3_600_000), response(200, {}, [])]);
    await expect(h.gh(commits)).resolves.toEqual([]);
    expect(h.now() - start).toBe(3_601_000);
  });

  it.each([403, 429])('honors Retry-After for HTTP %s', async status => {
    const h = harness([response(status, { 'Retry-After': '90' }), response(200, {}, { ok: true })]);
    await expect(h.gh(commits)).resolves.toEqual({ ok: true });
    expect(h.now() - start).toBe(91_000);
  });

  it('respects the later of Retry-After and a primary reset', async () => {
    const h = harness([response(429, {
      'retry-after': '10', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((start + 120_000) / 1000),
    }), response(200)]);
    await h.gh(commits);
    expect(h.now() - start).toBe(121_000);
  });

  it('accepts a Retry-After HTTP date', async () => {
    const h = harness([response(429, { 'retry-after': new Date(start + 90_000).toUTCString() }), response(200)]);
    await h.gh(commits);
    expect(h.now() - start).toBe(91_000);
  });

  it('backs off exponentially for secondary limits without usable timing headers', async () => {
    const limited = () => response(403, {}, { message: 'You have exceeded a secondary rate limit.' });
    const h = harness([limited(), limited(), limited(), response(200)]);
    await h.gh(commits);
    expect(h.now() - start).toBe((60 + 120 + 240) * 1000);
    expect(h.log.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining('waiting 60s'), expect.stringContaining('waiting 120s'), expect.stringContaining('waiting 240s'),
    ]);
  });

  it.each([
    { 'retry-after': 'invalid', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': 'invalid' },
    { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((start - 1000) / 1000) },
    {},
  ])('uses a one-minute fallback for missing, malformed or expired reset metadata: %j', async headers => {
    const h = harness([response(429, headers), response(200)]);
    await h.gh(commits);
    expect(h.now() - start).toBe(60_000);
  });

  it('stops after three retries instead of masking a persistent quota failure', async () => {
    const h = harness(Array.from({ length: 4 }, () => response(429)));
    await expect(h.gh(commits)).rejects.toThrow('rate limit retry budget exhausted');
    expect(h.spawn).toHaveBeenCalledTimes(4);
    expect(h.now() - start).toBe(420_000);
  });

  it('does not retry early when the reset exceeds the job wait budget, even for optional reads', async () => {
    const h = harness([primaryLimit(start + GITHUB_RATE_LIMIT_WAIT_MS + 1)]);
    await expect(h.gh(commits, { optional: true })).rejects.toThrow('Next permitted attempt no earlier than');
    expect(h.wait).not.toHaveBeenCalled();
    expect(h.spawn).toHaveBeenCalledOnce();
  });

  it('shares the wait budget across requests rather than resetting it for each endpoint', async () => {
    const h = harness([response(429, { 'retry-after': '40' }), response(200), response(429, { 'retry-after': '40' })], { maxTotalWaitMs: 60_000 });
    await h.gh(commits);
    await expect(h.gh(['api', 'repos/ugurkocde/IntuneGet/pulls'])).rejects.toThrow('retry budget exhausted');
    expect(h.now() - start).toBe(41_000);
    expect(h.spawn).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403, 404, 422, 500, 503])('does not retry an ordinary HTTP %s failure or replay an ambiguous write', async status => {
    const h = harness([response(status, {}, { message: 'Request failed' })]);
    await expect(h.gh(['api', '-X', 'POST', 'repos/ugurkocde/IntuneGet/pulls'], { input: '{"title":"test"}' })).rejects.toThrow('GitHub request failed');
    expect(h.spawn).toHaveBeenCalledOnce();
    expect(h.wait).not.toHaveBeenCalled();
  });

  it('does not replay a write after a transport failure', async () => {
    const h = harness([{ status: 1, stdout: Buffer.alloc(0), stderr: Buffer.from('connection reset') }]);
    await expect(h.gh(['api', '-X', 'POST', 'repos/ugurkocde/IntuneGet/pulls'])).rejects.toThrow('connection reset');
    expect(h.spawn).toHaveBeenCalledOnce();
  });

  it('retries an explicitly rate-limited write with the same request body', async () => {
    const h = harness([response(429, { 'retry-after': '1' }), response(201, {}, { number: 123 })]);
    const input = JSON.stringify({ title: 'Publish verified curated releases' });
    await expect(h.gh(['api', '-X', 'POST', 'repos/ugurkocde/IntuneGet/pulls', '--input', '-'], { input })).resolves.toEqual({ number: 123 });
    for (const call of h.spawn.mock.calls as unknown as [string, string[], { input: string }][]) expect(call[2].input).toBe(input);
  });

  it('preserves binary evidence bytes across redirects and a rate-limit retry', async () => {
    const archive = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0xfe, 0x80, 0x0d, 0x0a]);
    const final = response(200, { 'Content-Type': 'application/zip' }, archive);
    final.stdout = Buffer.concat([response(302, { Location: 'https://artifacts.test/signed' }, '').stdout, final.stdout]);
    const h = harness([primaryLimit(start + 1000), final]);
    await expect(h.gh(['api', 'repos/ugurkocde/IntuneGet-Workflows/actions/artifacts/123/zip'], { raw: true })).resolves.toEqual(archive);
  });

  it('handles LF-delimited headers and an empty successful response', async () => {
    const h = harness([response(200, {}, { ok: true }, '\n'), response(204, {}, '')]);
    await expect(h.gh(commits)).resolves.toEqual({ ok: true });
    await expect(h.gh(commits)).resolves.toBeNull();
    expect(h.wait).not.toHaveBeenCalled();
  });

  it('preserves the existing optional-read fallback for non-quota errors', async () => {
    const h = harness([response(404)]);
    await expect(h.gh(commits, { optional: true })).resolves.toBeNull();
    expect(h.wait).not.toHaveBeenCalled();
  });
});
