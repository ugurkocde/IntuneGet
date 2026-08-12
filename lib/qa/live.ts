import 'server-only';

import { createServerClient } from '@/lib/supabase';
import { QA_LIVE_FRAME_MAX_AGE_MS } from '@/lib/qa/constants';
import { getQaPipelineControl, type QaPipelineControl } from '@/lib/qa/pipeline-control';
import type { Json } from '@/types/database';
import type { QaArchitecture, QaLiveActivity, QaLiveLog, QaLivePhase, QaLiveResponse, QaLiveUiConfiguration, QaOutcome } from '@/types/qa';

const RUNNER_STALE_MS = 10 * 60 * 1000;
const POLL_STALE_MS = 5 * 60 * 1000;
export const QA_LIVE_RECENT_RESULT_COLUMNS =
  'winget_id, tested_version, architecture, outcome, tested_at_utc, overall_duration_seconds';

interface CandidateRow {
  id: string;
  winget_id: string;
  version: string;
  architecture: string;
  status: string;
  priority: number;
  enqueued_at: string;
  dispatched_at: string | null;
  started_at: string | null;
  phase: string | null;
  phase_started_at: string | null;
  phase_updated_at: string | null;
  live_activity?: Json | null;
  activity_updated_at?: string | null;
  live_log?: Json | null;
  log_updated_at?: string | null;
  test_config: Json;
}

interface FrameRow {
  candidate_id: string;
  sequence: number;
  captured_at: string;
  updated_at: string;
  width: number;
  height: number;
}

interface PollRow {
  status: 'running' | 'succeeded' | 'partial' | 'failed';
  started_at: string;
  finished_at: string | null;
  errors: Json;
}

interface ResultRow {
  winget_id: string;
  display_name?: string | null;
  tested_version: string;
  architecture: string;
  outcome: string;
  tested_at_utc: string;
  overall_duration_seconds?: number | null;
}

interface AppRow {
  winget_id: string;
  name: string;
  publisher: string | null;
  latest_version: string | null;
}

export interface QaLiveSnapshotInput {
  now: Date;
  current: CandidateRow | null;
  queuedCount: number;
  queued: CandidateRow[];
  poll: PollRow | null;
  consecutivePollFailures: number;
  recent: ResultRow[];
  apps: AppRow[];
  frame: FrameRow | null;
  control?: QaPipelineControl;
}

const VALID_PHASES = new Set<QaLivePhase>([
  'queued',
  'preparing_package',
  'restoring_vm',
  'installing',
  'detecting_install',
  'uninstalling',
  'verifying_removal',
  'publishing',
]);
const LIVE_ACTIVITY_TARGET = /^(?:%(?:PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMDATA|WINDIR|PUBLIC|USERPROFILE|LOCALAPPDATA|APPDATA)%\\|HK(?:LM|CU)\\)/i;

function architecture(value: string): QaArchitecture {
  return value === 'x86' || value === 'arm64' ? value : 'x64';
}

function phase(value: string | null): QaLivePhase {
  return value && VALID_PHASES.has(value as QaLivePhase)
    ? (value as QaLivePhase)
    : 'preparing_package';
}

function liveActivity(value: Json | undefined, observedAt: string | null | undefined, attemptStartedAt: string | null): QaLiveActivity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !observedAt || !attemptStartedAt) return null;
  if (new Date(observedAt).getTime() < new Date(attemptStartedAt).getTime()) return null;
  const stage = value.stage;
  if (stage !== 'during_install' && stage !== 'after_install' && stage !== 'after_uninstall') return null;
  const rawCounts = value.counts;
  if (!rawCounts || typeof rawCounts !== 'object' || Array.isArray(rawCounts)) return null;
  const countNames = [
    'registryAdded', 'registryChanged', 'registryRemoved',
    'filesAdded', 'filesChanged', 'filesRemoved',
  ] as const;
  const counts = {} as QaLiveActivity['counts'];
  for (const name of countNames) {
    const candidate = rawCounts[name];
    if (!Number.isInteger(candidate) || Number(candidate) < 0 || Number(candidate) > 50_000_000) return null;
    counts[name] = Number(candidate);
  }
  if (!Array.isArray(value.items) || value.items.length > 40 || typeof value.truncated !== 'boolean') return null;
  const items: QaLiveActivity['items'] = [];
  for (const item of value.items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const kind = item.kind;
    const change = item.change;
    const target = item.target;
    if (
      (kind !== 'file' && kind !== 'registry') ||
      (change !== 'added' && change !== 'changed' && change !== 'removed') ||
      typeof target !== 'string' || target.length < 1 || target.length > 240 ||
      /[\u0000-\u001f\u007f]/.test(target) || !LIVE_ACTIVITY_TARGET.test(target)
    ) return null;
    items.push({ kind, change, target });
  }
  return { stage, observedAt, counts, items, truncated: value.truncated };
}

function liveLog(value: Json | undefined, observedAt: string | null | undefined, attemptStartedAt: string | null): QaLiveLog | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !observedAt || !attemptStartedAt) return null;
  if (new Date(observedAt).getTime() < new Date(attemptStartedAt).getTime()) return null;
  if (value.source !== 'PSADT' || typeof value.lastWriteAt !== 'string' || !Array.isArray(value.lines) || value.lines.length > 8) return null;
  if (!Number.isFinite(new Date(value.lastWriteAt).getTime())) return null;
  const lines: string[] = [];
  for (const line of value.lines) {
    if (typeof line !== 'string' || line.length < 1 || line.length > 180 || /[\u0000-\u001f\u007f]/.test(line) || /[A-Z]:\\|INTUNE-QA\\/i.test(line)) return null;
    lines.push(line);
  }
  return { source: 'PSADT', observedAt, lastWriteAt: value.lastWriteAt, lines };
}

function executionContext(config: Json): 'LocalSystem' | 'User' {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 'LocalSystem';
  const canonical = config.packageProfileCanonicalJson;
  if (typeof canonical !== 'string') return 'LocalSystem';
  try {
    const parsed = JSON.parse(canonical) as { installer?: { installScope?: unknown } };
    return String(parsed.installer?.installScope || '').toLowerCase() === 'user'
      ? 'User'
      : 'LocalSystem';
  } catch {
    return 'LocalSystem';
  }
}

function deployMode(config: Json): 'Auto' | 'Silent' | 'NonInteractive' {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return 'Silent';
  const canonical = config.packageProfileCanonicalJson;
  if (typeof canonical !== 'string') return 'Silent';
  try {
    const parsed = JSON.parse(canonical) as { psadtConfig?: { deployMode?: unknown } };
    const value = parsed.psadtConfig?.deployMode;
    return value === 'Auto' || value === 'NonInteractive' ? value : 'Silent';
  } catch {
    return 'Silent';
  }
}

function expectedUiConfiguration(config: Json): QaLiveUiConfiguration | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const canonical = config.packageProfileCanonicalJson;
  if (typeof canonical !== 'string') return null;
  try {
    const parsed = JSON.parse(canonical) as { psadtConfig?: Record<string, unknown> };
    const psadt = parsed.psadtConfig;
    if (!psadt || typeof psadt !== 'object' || Array.isArray(psadt)) return null;
    const mode = psadt.deployMode === 'Auto' || psadt.deployMode === 'NonInteractive'
      ? psadt.deployMode
      : 'Silent';
    const restartBehavior = psadt.restartBehavior === 'Force' || psadt.restartBehavior === 'Prompt'
      ? psadt.restartBehavior
      : 'Suppress';
    const enabledCount = (value: unknown) => Array.isArray(value)
      ? Math.min(100, value.filter((item) => item && typeof item === 'object' && !Array.isArray(item) && (item as Record<string, unknown>).enabled === true).length)
      : 0;
    const processCloseCount = Math.min(100, Array.isArray(psadt.processesToClose) ? psadt.processesToClose.length : 0);
    const progressDialog = Boolean(
      psadt.progressDialog && typeof psadt.progressDialog === 'object' && !Array.isArray(psadt.progressDialog) &&
      (psadt.progressDialog as Record<string, unknown>).enabled === true
    );
    const restartPrompt = Boolean(
      psadt.restartPrompt && typeof psadt.restartPrompt === 'object' && !Array.isArray(psadt.restartPrompt) &&
      (psadt.restartPrompt as Record<string, unknown>).enabled === true
    );
    const promptConfiguration = {
      closePrompt: psadt.showClosePrompt === true,
      deferral: psadt.allowDefer === true,
      progressDialog,
      customPromptCount: enabledCount(psadt.customPrompts),
      restartPrompt,
      balloonTipCount: enabledCount(psadt.balloonTips),
    };
    const configuredUi = Object.entries(promptConfiguration).some(([, value]) => value === true || (typeof value === 'number' && value > 0));
    return {
      deployMode: mode,
      restartBehavior,
      promptConfiguration,
      processCloseCount,
      uiEvidenceExpected: mode !== 'Silent' && configuredUi,
    };
  } catch {
    return null;
  }
}

function elapsedSeconds(start: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(start).getTime()) / 1000));
}

function schedulerIssue(
  poll: PollRow | null,
  staleRunning: boolean
): QaLiveResponse['scheduler']['issue'] {
  if (!poll || poll.status === 'succeeded') return null;
  if (staleRunning) return 'stalled';
  const errors = Array.isArray(poll.errors) ? poll.errors : [];
  const combined = errors.filter((error): error is string => typeof error === 'string').join(' ');
  if (
    /github|winget change feed/i.test(combined) &&
    /rate limit|paused until/i.test(combined)
  ) {
    return 'github_rate_limit';
  }
  // A partial scan means one or more individual packages could not be
  // evaluated. The scheduler itself still completed and can keep processing
  // the rest of the catalog, so this is operator diagnostic data rather than
  // a customer-facing service incident. Only system-level partial failures
  // degrade the public health projection.
  if (poll.status === 'partial') {
    return errors.some((error) => typeof error === 'string' && /^system:/i.test(error))
      ? 'upstream_error'
      : null;
  }
  return 'upstream_error';
}

export function buildQaLiveResponse(input: QaLiveSnapshotInput): QaLiveResponse {
  const appById = new Map(input.apps.map((app) => [app.winget_id, app]));
  const currentStartedAt = input.current
    ? input.current.started_at || input.current.dispatched_at || input.current.enqueued_at
    : null;
  const phaseIsCurrentAttempt = Boolean(
    input.current?.phase_updated_at &&
    currentStartedAt &&
    new Date(input.current.phase_updated_at).getTime() >= new Date(currentStartedAt).getTime()
  );
  const heartbeatAt = input.current
    ? (phaseIsCurrentAttempt ? input.current.phase_updated_at : null) || currentStartedAt
    : null;
  const runnerStalled = Boolean(
    heartbeatAt && input.now.getTime() - new Date(heartbeatAt).getTime() > RUNNER_STALE_MS
  );

  let schedulerState: QaLiveResponse['scheduler']['state'] = 'unknown';
  let stalePoll = false;
  let pollIssue: QaLiveResponse['scheduler']['issue'] = null;
  if (input.poll) {
    stalePoll =
      input.poll.status === 'running' &&
      input.now.getTime() - new Date(input.poll.started_at).getTime() > POLL_STALE_MS;
    pollIssue = schedulerIssue(input.poll, stalePoll);
    schedulerState = pollIssue ? 'degraded' : 'healthy';
  }
  // Pipeline maintenance is private operator state. Keep the public projection
  // neutral and never expose maintenance notes, commit hashes, or timestamps.
  if (input.control?.paused) schedulerState = 'healthy';

  const currentApp = input.current ? appById.get(input.current.winget_id) : null;
  const frameIsCurrent = Boolean(
    input.current &&
    input.frame?.candidate_id === input.current.id &&
    input.now.getTime() - new Date(input.frame.updated_at).getTime() <= QA_LIVE_FRAME_MAX_AGE_MS
  );
  const currentExpectedUi = input.current ? expectedUiConfiguration(input.current.test_config) : null;
  const currentActivity = input.current
    ? liveActivity(input.current.live_activity, input.current.activity_updated_at, currentStartedAt)
    : null;
  const currentLog = input.current
    ? liveLog(input.current.live_log, input.current.log_updated_at, currentStartedAt)
    : null;

  return {
    serverTime: input.now.toISOString(),
    active: Boolean(input.current),
    runner: {
      state: input.current ? (runnerStalled ? 'stalled' : 'testing') : 'idle',
      heartbeatAt,
    },
    scheduler: {
      state: schedulerState,
      lastPollAt: input.poll?.finished_at || input.poll?.started_at || null,
      lastOutcome: input.poll?.status || null,
      issue: input.control?.paused ? null : pollIssue,
      consecutiveFailures: input.control?.paused ? 0 : input.consecutivePollFailures,
    },
    current: input.current && currentStartedAt
      ? {
          wingetId: input.current.winget_id,
          displayName: currentApp?.name || input.current.winget_id,
          publisher: currentApp?.publisher || null,
          version: input.current.version,
          catalogVersion: currentApp?.latest_version || input.current.version,
          architecture: architecture(input.current.architecture),
          executionContext: executionContext(input.current.test_config),
          deployMode: deployMode(input.current.test_config),
          dialogExpected: currentExpectedUi?.uiEvidenceExpected ?? deployMode(input.current.test_config) === 'Auto',
          expectedUi: currentExpectedUi,
          phase: phase(phaseIsCurrentAttempt ? input.current.phase : null),
          phaseStartedAt: phaseIsCurrentAttempt ? input.current.phase_started_at : null,
          startedAt: currentStartedAt,
          elapsedSeconds: elapsedSeconds(currentStartedAt, input.now),
        }
      : null,
    viewer: {
      candidateId: frameIsCurrent ? input.current?.id || null : null,
      available: frameIsCurrent,
      capturedAt: frameIsCurrent ? input.frame?.updated_at || null : null,
      sequence: frameIsCurrent ? input.frame?.sequence ?? null : null,
      width: frameIsCurrent ? input.frame?.width ?? null : null,
      height: frameIsCurrent ? input.frame?.height ?? null : null,
    },
    activity: currentActivity,
    log: currentLog,
    queue: {
      count: input.queuedCount,
      next: input.queued.map((candidate) => ({
        wingetId: candidate.winget_id,
        displayName: appById.get(candidate.winget_id)?.name || candidate.winget_id,
        version: candidate.version,
        architecture: architecture(candidate.architecture),
        enqueuedAt: candidate.enqueued_at,
      })),
    },
    recent: input.recent.map((result) => ({
      wingetId: result.winget_id,
      displayName: result.display_name || appById.get(result.winget_id)?.name || result.winget_id,
      testedVersion: result.tested_version,
      catalogVersion: appById.get(result.winget_id)?.latest_version || result.tested_version,
      architecture: architecture(result.architecture),
      outcome: result.outcome === 'Passed' ? 'Passed' : ('Failed' as QaOutcome),
      testedAtUtc: result.tested_at_utc,
      durationSeconds: result.overall_duration_seconds ?? null,
    })),
  };
}

export function countConsecutiveFailedPolls(
  polls: Array<{ status: string }>
): number {
  let failures = 0;
  for (const poll of polls) {
    if (poll.status !== 'failed') break;
    failures += 1;
  }
  return failures;
}

export async function getQaLiveSnapshot(): Promise<QaLiveResponse> {
  const supabase = createServerClient();
  const candidateColumns =
    'id, winget_id, version, architecture, status, priority, enqueued_at, dispatched_at, started_at, phase, phase_started_at, phase_updated_at, live_activity, activity_updated_at, live_log, log_updated_at, test_config';

  const [activeResult, queueResult, countResult, pollResult, recentResult, control] = await Promise.all([
    supabase
      .from('qa_candidates')
      .select(candidateColumns)
      .eq('test_level', 'psadt-package')
      .in('status', ['dispatched', 'running'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('qa_candidates')
      .select(candidateColumns)
      .eq('test_level', 'psadt-package')
      .eq('status', 'queued')
      .order('priority', { ascending: false })
      .order('enqueued_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(10),
    supabase
      .from('qa_candidates')
      .select('id', { count: 'exact', head: true })
      .eq('test_level', 'psadt-package')
      .eq('status', 'queued'),
    supabase
      .from('qa_poll_runs')
      .select('status, started_at, finished_at, errors')
      .order('started_at', { ascending: false })
      .limit(10),
    supabase
      .from('qa_package_results')
      .select(QA_LIVE_RECENT_RESULT_COLUMNS)
      .order('tested_at_utc', { ascending: false })
      .limit(10),
    getQaPipelineControl(supabase),
  ]);

  for (const result of [activeResult, queueResult, countResult, pollResult, recentResult]) {
    if (result.error) throw new Error(`Could not load live QA data: ${result.error.message}`);
  }

  const current = (activeResult.data as CandidateRow | null) || null;
  const queued = (queueResult.data || []) as CandidateRow[];
  const recent = (recentResult.data || []) as ResultRow[];
  const polls = (pollResult.data || []) as PollRow[];
  const consecutivePollFailures = countConsecutiveFailedPolls(polls);
  const ids = [
    ...(current ? [current.winget_id] : []),
    ...queued.map((row) => row.winget_id),
    ...recent.map((row) => row.winget_id),
  ];
  const uniqueIds = [...new Set(ids)];
  let apps: AppRow[] = [];
  let frame: FrameRow | null = null;
  if (current) {
    const frameResult = await supabase
      .from('qa_live_frames')
      .select('candidate_id, sequence, captured_at, updated_at, width, height')
      .eq('candidate_id', current.id)
      .maybeSingle();
    if (frameResult.error) throw new Error(`Could not load QA live frame metadata: ${frameResult.error.message}`);
    frame = (frameResult.data as FrameRow | null) || null;
  }
  if (uniqueIds.length) {
    const appResult = await supabase
      .from('curated_apps')
      .select('winget_id, name, publisher, latest_version')
      .in('winget_id', uniqueIds);
    if (appResult.error) throw new Error(`Could not load QA app metadata: ${appResult.error.message}`);
    apps = (appResult.data || []) as AppRow[];
  }

  return buildQaLiveResponse({
    now: new Date(),
    current,
    queuedCount: countResult.count || 0,
    queued,
    poll: polls[0] || null,
    consecutivePollFailures,
    recent,
    apps,
    frame,
    control,
  });
}
