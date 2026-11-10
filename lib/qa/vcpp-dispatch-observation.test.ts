import { describe, expect, it } from 'vitest';
import { observeVcppDispatch, type VcppDispatchClaim } from './vcpp-dispatch-observation';

const now = new Date('2026-10-29T03:00:30Z');
const claim: VcppDispatchClaim = {
  nonce: '79910000-0000-4000-8000-000000000001',
  label: 'Fixture.Vcpp 1.0 x64 [vcpp:79910000-0000-4000-8000-000000000001]',
  expectedSourceSha: 'a'.repeat(40), originalRunId: '100',
  claimedAt: '2026-10-29T03:00:00Z', expiresAt: '2026-10-29T04:00:00Z',
  repositoryId: 123, repository: 'ugurkocde/IntuneGet-Workflows',
  expectedActorId: 456,
};
const run = (patch: Record<string, unknown> = {}) => ({
  id: 101, run_attempt: 1, head_sha: claim.expectedSourceSha, head_branch: 'main',
  event: 'workflow_dispatch', path: '.github/workflows/intune-qa.yml',
  display_title: `Intune QA - ${claim.label}`, created_at: '2026-10-29T03:00:05Z',
  actor: { login: 'ugurkocde', type: 'User', id: 456 },
  repository: { id: 123, full_name: claim.repository },
  head_repository: { id: 123, full_name: claim.repository }, ...patch,
});
const inventory = (rows: unknown[] = [run()], total = rows.length) => ({
  observedAt: '2026-10-29T03:00:20Z', response: { total_count: total, workflow_runs: rows },
});

describe('VC++ dispatch observation (no mutation or execution authority)', () => {
  it('returns exact API identity only when the host agrees', () => {
    expect(observeVcppDispatch(claim, inventory(), '101', now)).toEqual({ kind: 'matched', run: {
      id: '101', runAttempt: 1, headSha: claim.expectedSourceSha, headBranch: 'main',
      event: 'workflow_dispatch', path: '.github/workflows/intune-qa.yml',
      displayTitle: `Intune QA - ${claim.label}`, createdAt: '2026-10-29T03:00:05Z',
      actor: { login: 'ugurkocde', type: 'User', id: 456 },
    } });
  });
  it('refuses two different runs with the nonce even when one has the wrong source', () => {
    expect(observeVcppDispatch(claim, inventory([run(), run({ id: 102, head_sha: 'b'.repeat(40) })]), '101', now))
      .toEqual({ kind: 'refused', reason: 'ambiguous_nonce' });
  });
  it('refuses a second nonce occurrence under a different title', () => {
    const changedTitle = `Intune QA - Other 1.0 x64 [vcpp:${claim.nonce}]`;
    expect(observeVcppDispatch(claim, inventory([run(), run({ id: 102, display_title: changedTitle })]), '101', now))
      .toEqual({ kind: 'refused', reason: 'ambiguous_nonce' });
  });
  it('refuses a single nonce occurrence whose full title changed', () => {
    expect(observeVcppDispatch(claim, inventory([run({ display_title: `Other [vcpp:${claim.nonce}]` })]), '101', now))
      .toEqual({ kind: 'refused', reason: 'run_provenance' });
  });
  it('makes no decision from a truncated inventory even when its first run matches', () => {
    expect(observeVcppDispatch(claim, inventory([run()], 2), '101', now))
      .toEqual({ kind: 'waiting', reason: 'inventory_incomplete' });
  });
  it('waits for an absent run and for the host without inventing a binding', () => {
    expect(observeVcppDispatch(claim, inventory([]), null, now)).toEqual({ kind: 'waiting', reason: 'awaiting_run' });
    expect(observeVcppDispatch(claim, inventory(), null, now)).toEqual({ kind: 'waiting', reason: 'awaiting_host' });
  });
  it('refuses a different host run', () => {
    expect(observeVcppDispatch(claim, inventory(), '102', now)).toEqual({ kind: 'refused', reason: 'host_run_mismatch' });
  });
  it.each([
    { run_attempt: 2 }, { run_attempt: null }, { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature' }, { event: 'push' }, { path: '.github/workflows/other.yml' },
    { actor: { login: 'ugurlabs-agent[bot]', type: 'Bot', id: 456 } },
    { actor: { login: 'ugurkocde', type: 'Bot', id: 456 } },
    { actor: { login: 'ugurkocde', type: 'User', id: 457 } },
    { repository: { id: 124, full_name: claim.repository } },
    { head_repository: { id: 123, full_name: 'external/fork' } },
    { repository: null }, { head_repository: null }, { actor: null },
    { actor: { login: 'ugurkocde', type: 'User', id: 0 } },
    { id: 100 }, { created_at: '2026-10-29T02:59:54Z' },
    { created_at: '2026-10-29T03:00:21Z' },
  ])('refuses nonce run with changed provenance: %j', patch => {
    expect(observeVcppDispatch(claim, inventory([run(patch)]), '101', now))
      .toEqual({ kind: 'refused', reason: 'run_provenance' });
  });
  it('accepts the five second creation tolerance but not a future observation', () => {
    expect(observeVcppDispatch(claim, inventory([run({ created_at: '2026-10-29T02:59:55Z' })]), '101', now).kind).toBe('matched');
    expect(observeVcppDispatch(claim, { ...inventory(), observedAt: '2026-10-29T03:00:31Z' }, '101', now).kind).toBe('refused');
  });
  it('ignores other nonce labels without treating them as this dispatch', () => {
    expect(observeVcppDispatch(claim, inventory([run({ display_title: 'Intune QA - unrelated' })]), null, now))
      .toEqual({ kind: 'waiting', reason: 'awaiting_run' });
  });
  it.each([
    null, {}, { observedAt: 'bad', response: {} },
    inventory([run()], -1), inventory([run()], 0), inventory([run()], 1.5),
    inventory([run(), run()]), inventory([run({ id: Number.MAX_SAFE_INTEGER + 1 })]),
    inventory([run({ id: '101' })]), inventory([run({ created_at: 'bad' })]),
    inventory(Array.from({ length: 1001 }, (_, i) => run({ id: i + 101 }))),
  ])('refuses malformed or excessive inventory: %j', input => {
    expect(observeVcppDispatch(claim, input, '101', now))
      .toEqual({ kind: 'refused', reason: 'invalid_inventory' });
  });
  it('refuses stale reads and an expired initial binding', () => {
    expect(observeVcppDispatch(claim, inventory(), '101', new Date('2026-10-29T03:02:21Z')))
      .toEqual({ kind: 'refused', reason: 'inventory_stale' });
    expect(observeVcppDispatch(claim, inventory(), '101', new Date('2026-10-29T04:00:01Z')))
      .toEqual({ kind: 'refused', reason: 'expired' });
  });
  it.each([
    { nonce: 'bad' }, { label: 'Fixture [vcpp:another]' },
    { expectedSourceSha: 'main' }, { originalRunId: '0' },
    { originalRunId: '1e2' }, { claimedAt: 'bad' }, { expiresAt: claim.claimedAt },
    { repositoryId: 0 }, { repository: 'external/fork' },
    { expectedActorId: 0 },
    { nonce: '79910000-0000-4000-8000-000000000002' },
    { originalRunId: 100 }, { claimedAt: '2026-02-31T03:00:00Z' },
    { claimedAt: '2026-10-29T03:00:31Z' },
    { label: 'x'.repeat(230) + ` [vcpp:${claim.nonce}]` },
  ])('refuses malformed claim: %j', patch => {
    expect(observeVcppDispatch({ ...claim, ...patch } as VcppDispatchClaim, inventory(), '101', now))
      .toEqual({ kind: 'refused', reason: 'invalid_claim' });
  });
  it('refuses a missing database claim rather than throwing', () => {
    expect(observeVcppDispatch(null as unknown as VcppDispatchClaim, inventory(), '101', now))
      .toEqual({ kind: 'refused', reason: 'invalid_claim' });
  });
  it('does not modify the claim, inventory or host state', () => {
    const input = inventory(); const before = JSON.stringify({ claim, input });
    observeVcppDispatch(claim, input, '101', now);
    expect(JSON.stringify({ claim, input })).toBe(before);
  });
});
