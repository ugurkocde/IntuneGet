import { describe, expect, it, vi } from 'vitest';
import { prepareCuratedPublication } from './curated-publication.mjs';

const headSha = 'a'.repeat(40);
const pr = { number: 42, html_url: 'https://github.com/ugurkocde/IntuneGet/pull/42', state: 'open', auto_merge: null, head: { sha: headSha }, base: { ref: 'main' } };
function harness(existing = true, armed = false) {
  let current = { ...pr, auto_merge: armed ? { merge_method: 'squash' } : null };
  const events: string[] = [];
  const gh = vi.fn(async (args: string[]) => {
    if (args.some(arg => arg.includes('pulls?'))) return existing ? [current] : [];
    if (args.includes('POST')) { events.push('create'); return current; }
    if (args.includes('PATCH')) { events.push('update'); return current; }
    events.push('read'); return current;
  });
  const spawn = vi.fn(() => { events.push('disable'); current = { ...current, auto_merge: null }; return { status: 0 }; });
  const push = vi.fn(async () => { events.push('push'); });
  const wait = vi.fn(async (_ms: number) => {});
  const run = () => prepareCuratedPublication({ gh, spawn, push, wait, repo: 'ugurkocde/IntuneGet', branch: 'automation/curated-catalog', title: 'Renew catalog', details: 'Signed catalog.', headSha });
  return { gh, spawn, push, wait, events, run, set: (value: typeof current) => { current = value; } };
}
describe('curated publication review handoff', () => {
  it('refuses to push when the matching PR targets another base', async () => {
    const h = harness();
    h.set({ ...pr, base: { ref: 'other' } });
    await expect(h.run()).rejects.toThrow('unexpected base');
    expect(h.push).not.toHaveBeenCalled();
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it('rejects an unexpected base even when a valid match is listed first', async () => {
    const h = harness();
    h.gh.mockResolvedValueOnce([pr, { ...pr, number: 43, base: { ref: 'other' } }]);
    await expect(h.run()).rejects.toThrow('unexpected base');
    expect(h.push).not.toHaveBeenCalled();
  });
  it('rejects multiple matching PRs without choosing an arbitrary merge state', async () => {
    const h = harness();
    h.gh.mockResolvedValueOnce([pr, { ...pr, number: 43 }]);
    await expect(h.run()).rejects.toThrow('Multiple');
    expect(h.push).not.toHaveBeenCalled();
  });
  it('rejects a malformed lookup rather than assuming no PR exists', async () => {
    const h = harness();
    h.gh.mockResolvedValueOnce(null as never);
    await expect(h.run()).rejects.toThrow('invalid response');
    expect(h.push).not.toHaveBeenCalled();
  });
  it('disables a legacy merge request and verifies it before pushing a replacement', async () => {
    const h = harness(true, true);
    expect(await h.run()).toEqual({ number: 42, url: pr.html_url, headSha });
    expect(h.events.slice(0, 4)).toEqual(['read', 'disable', 'read', 'push']);
    expect(h.spawn.mock.calls[0][1]).toEqual(['pr', 'merge', '42', '--repo', 'ugurkocde/IntuneGet', '--disable-auto']);
  });
  it('opens a new PR with the exact revision without arming a merge', async () => {
    const h = harness(false);
    await h.run();
    expect(h.spawn).not.toHaveBeenCalled();
    const call = h.gh.mock.calls.find(([args]) => args.includes('POST'))!;
    const body = JSON.parse(call[1].input).body;
    expect(body).toContain(headSha);
    expect(body).toContain('independent review of this exact revision');
    expect(body).not.toContain('Opened and merged');
  });
  it('fails before pushing if disabling auto merge fails', async () => {
    const h = harness(true, true);
    h.spawn.mockImplementation(() => ({ status: 1 }));
    await expect(h.run()).rejects.toThrow('Disabling');
    expect(h.push).not.toHaveBeenCalled();
  });
  it('fails before pushing if readback still reports armed auto merge', async () => {
    const h = harness(true, true);
    h.spawn.mockImplementation(() => ({ status: 0 }));
    await expect(h.run()).rejects.toThrow('unverified');
    expect(h.push).not.toHaveBeenCalled();
  });
  it('fails closed when auto merge state is omitted', async () => {
    const h = harness();
    h.set({ ...pr, auto_merge: undefined } as never);
    await expect(h.run()).rejects.toThrow('unverified');
    expect(h.push).not.toHaveBeenCalled();
  });
  it('rejects a changed head after publication', async () => {
    const h = harness();
    h.push.mockImplementation(async () => { h.set({ ...pr, head: { sha: 'b'.repeat(40) } }); });
    await expect(h.run()).rejects.toThrow('does not match');
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.wait).toHaveBeenCalledTimes(4);
  });
  it('accepts the expected head after bounded GitHub propagation delay', async () => {
    const h = harness();
    h.push.mockImplementation(async () => { h.set({ ...pr, head: { sha: 'b'.repeat(40) } }); });
    h.wait.mockImplementation(async () => { h.set({ ...pr }); });
    expect(await h.run()).toEqual({ number: 42, url: pr.html_url, headSha });
    expect(h.wait).toHaveBeenCalledExactlyOnceWith(2000);
  });
  it.each(['armed', 'omitted', 'closed'])('stops head readback immediately when merge state becomes %s', async state => {
    const h = harness();
    h.push.mockImplementation(async () => { h.set({ ...pr, head: { sha: 'b'.repeat(40) } }); });
    h.wait.mockImplementation(async () => {
      h.set({ ...pr, state: state === 'closed' ? 'closed' : 'open', auto_merge: state === 'armed' ? {} : state === 'omitted' ? undefined : null } as never);
    });
    await expect(h.run()).rejects.toThrow('unverified');
    expect(h.wait).toHaveBeenCalledTimes(1);
    expect(h.spawn).not.toHaveBeenCalled();
  });
  it('does not push if the PR merged during preflight', async () => {
    const h = harness();
    h.set({ ...pr, state: 'closed' });
    await expect(h.run()).rejects.toThrow('no longer open');
    expect(h.push).not.toHaveBeenCalled();
  });
});
