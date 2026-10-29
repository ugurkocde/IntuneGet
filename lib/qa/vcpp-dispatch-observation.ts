export interface VcppDispatchClaim {
  nonce: string;
  label: string;
  expectedSourceSha: string;
  originalRunId: string;
  claimedAt: string;
  expiresAt: string;
  repositoryId: number;
  repository: string;
}

export interface VcppObservedRun {
  id: string;
  runAttempt: 1;
  headSha: string;
  headBranch: 'main';
  event: 'workflow_dispatch';
  path: '.github/workflows/intune-qa.yml';
  displayTitle: string;
  createdAt: string;
  actor: { login: 'ugurkocde'; type: 'User'; id: number };
}

export type VcppDispatchObservation =
  | { kind: 'matched'; run: VcppObservedRun }
  | { kind: 'waiting'; reason: 'inventory_incomplete' | 'awaiting_run' | 'awaiting_host' }
  | { kind: 'refused'; reason: 'invalid_claim' | 'expired' | 'invalid_inventory' |
      'inventory_stale' | 'ambiguous_nonce' | 'run_provenance' | 'host_run_mismatch' };

const REPOSITORY = 'ugurkocde/IntuneGet-Workflows';
const WORKFLOW = '.github/workflows/intune-qa.yml';
const TITLE_PREFIX = 'Intune QA - ';
const MAX_INVENTORY = 1000;
const FRESHNESS_MS = 120_000;
const CLOCK_TOLERANCE_MS = 5000;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const positiveId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function utcTime(value: unknown): number {
  if (typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)) return NaN;
  const time = Date.parse(value);
  // Date.parse normalizes nonexistent dates, which must not extend a claim.
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19) ? time : NaN;
}

/**
 * Pure initial-binding validation, not execution or admission authority.
 *
 * The future server caller must supply the immutable database claim and a
 * fresh authenticated GitHub inventory for this repository and workflow. It
 * must fetch ALL pages of the creation window starting claimedAt - 5 seconds,
 * without actor, branch, event, status or source filters that hide duplicate
 * nonce runs. A supplied boolean cannot establish completeness or provenance.
 * expectedSourceSha equality detects drift; source review remains a separate
 * activation gate. The result must still pass the transactional DB binder and
 * a pre-execution gate before any installer may run. This module has no caller
 * wired into dispatch, VM execution, authorization transitions or publication.
 */
export function observeVcppDispatch(
  claim: VcppDispatchClaim,
  input: unknown,
  hostRunId: string | null,
  now = new Date(),
): VcppDispatchObservation {
  if (!object(claim) || ['nonce', 'label', 'expectedSourceSha', 'originalRunId', 'claimedAt', 'expiresAt', 'repository']
    .some(key => typeof (claim as unknown as Record<string, unknown>)[key] !== 'string')) {
    return { kind: 'refused', reason: 'invalid_claim' };
  }
  const claimedAt = utcTime(claim.claimedAt);
  const expiresAt = utcTime(claim.expiresAt);
  const current = now.getTime();
  if (!Number.isFinite(current) || !Number.isFinite(claimedAt) || !Number.isFinite(expiresAt) ||
    claimedAt > current || expiresAt <= claimedAt ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(claim.nonce) ||
    claim.label.length + TITLE_PREFIX.length > 255 ||
    !/^[\x20-\x7e]+$/.test(claim.label) || !claim.label.endsWith(` [vcpp:${claim.nonce}]`) ||
    !/^[a-f0-9]{40}$/.test(claim.expectedSourceSha) ||
    !/^[1-9][0-9]{0,19}$/.test(claim.originalRunId) ||
    !positiveId(claim.repositoryId) || claim.repository !== REPOSITORY) {
    return { kind: 'refused', reason: 'invalid_claim' };
  }
  if (current > expiresAt) return { kind: 'refused', reason: 'expired' };
  const envelope = object(input);
  const observedAt = utcTime(envelope?.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > current) return { kind: 'refused', reason: 'invalid_inventory' };
  if (current - observedAt > FRESHNESS_MS) return { kind: 'refused', reason: 'inventory_stale' };
  if (observedAt < claimedAt) return { kind: 'refused', reason: 'invalid_inventory' };
  const response = object(envelope?.response);
  const rows = response?.workflow_runs;
  const total = response?.total_count;
  if (!Array.isArray(rows) || rows.length > MAX_INVENTORY ||
    typeof total !== 'number' || !Number.isSafeInteger(total) || total < rows.length || total > MAX_INVENTORY) {
    return { kind: 'refused', reason: 'invalid_inventory' };
  }
  const ids = new Set<number>();
  const candidates: Record<string, unknown>[] = [];
  for (const raw of rows) {
    const run = object(raw);
    if (!run || !positiveId(run.id) || ids.has(run.id) ||
      typeof run.display_title !== 'string' || run.display_title.length > 500 ||
      !Number.isFinite(utcTime(run.created_at))) return { kind: 'refused', reason: 'invalid_inventory' };
    ids.add(run.id);
    // Count before filtering provenance: a copied label on a different ref or
    // actor is ambiguity, never a reason to select the convenient first match.
    if (run.display_title === TITLE_PREFIX + claim.label) candidates.push(run);
  }
  if (total !== rows.length) return { kind: 'waiting', reason: 'inventory_incomplete' };
  if (candidates.length > 1) return { kind: 'refused', reason: 'ambiguous_nonce' };
  if (!candidates.length) return { kind: 'waiting', reason: 'awaiting_run' };
  const run = candidates[0];
  const repository = object(run.repository);
  const headRepository = object(run.head_repository);
  const actor = object(run.actor);
  const createdAt = utcTime(run.created_at);
  if (run.run_attempt !== 1 || run.head_sha !== claim.expectedSourceSha ||
    run.head_branch !== 'main' || run.event !== 'workflow_dispatch' || run.path !== WORKFLOW ||
    actor?.login !== 'ugurkocde' || actor.type !== 'User' || !positiveId(actor.id) ||
    repository?.id !== claim.repositoryId || repository.full_name !== REPOSITORY ||
    headRepository?.id !== claim.repositoryId || headRepository.full_name !== REPOSITORY ||
    BigInt(run.id as number) <= BigInt(claim.originalRunId) ||
    createdAt < claimedAt - CLOCK_TOLERANCE_MS || createdAt > observedAt || createdAt > expiresAt) {
    return { kind: 'refused', reason: 'run_provenance' };
  }
  if (hostRunId === null) return { kind: 'waiting', reason: 'awaiting_host' };
  if (hostRunId !== String(run.id)) return { kind: 'refused', reason: 'host_run_mismatch' };
  return { kind: 'matched', run: {
    id: String(run.id), runAttempt: 1, headSha: claim.expectedSourceSha,
    headBranch: 'main', event: 'workflow_dispatch', path: WORKFLOW,
    displayTitle: `Intune QA - ${claim.label}`, createdAt: run.created_at as string,
    actor: { login: 'ugurkocde', type: 'User', id: actor.id },
  } };
}
