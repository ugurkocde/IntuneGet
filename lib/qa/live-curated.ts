import { CURATED_APPS } from '@/lib/curated-catalog/definitions';
import type { QaCuratedLiveCurrent, QaCuratedLivePhase, QaLiveResponse } from '@/types/qa';

export const CURATED_HEARTBEAT_STALE_MS = 120_000;
export const CURATED_SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const FRAME_MAX_AGE_MS = 15_000;
// Database and runner clocks may run slightly ahead of this server.
const CLOCK_SKEW_MS = 5_000;
export const CURATED_LIVE_PHASES: readonly QaCuratedLivePhase[] = [
  'restoring_vm', 'inspecting_installer', 'preparing_package', 'testing_lifecycle',
  'installing', 'detecting_install', 'uninstalling', 'verifying_removal', 'installing_previous', 'detecting_previous', 'upgrading', 'detecting_upgrade', 'final_uninstall', 'verifying_final_removal', 'cleaning_up',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface QaCuratedLiveBinding {
  id: string;
  app_id: string;
  version: string;
  kind: string;
  status: string;
  inputs: unknown;
  dispatched_at: string | null;
  github_run_id: string | null;
}

export interface QaCuratedLiveSessionRow {
  id: string;
  queue_id: string;
  app_id: string;
  version: string;
  architecture: string;
  verification: string;
  public_frames: boolean;
  upgrade_planned: boolean;
  github_run_id: number;
  state: string;
  phase: string | null;
  phase_started_at: string | null;
  started_at: string;
  heartbeat_at: string;
}

export interface QaCuratedLiveFrameRow {
  session_id: string;
  sequence: number;
  captured_at: string;
  updated_at: string;
  width: number;
  height: number;
}

export function curatedLivePhase(value: unknown): QaCuratedLivePhase | null {
  return typeof value === 'string' && CURATED_LIVE_PHASES.includes(value as QaCuratedLivePhase)
    ? value as QaCuratedLivePhase : null;
}

/** These fields are catalogue data, never runner supplied display text. */
export function resolveCuratedAppForLive(appId: string) {
  const app = CURATED_APPS.find(candidate => candidate.id === appId);
  return app ? { packageId: app.packageId, name: app.name, publisher: app.publisher, architecture: app.architecture } : null;
}

export function curatedBindingAllowsPublicFrames(binding: QaCuratedLiveBinding): boolean {
  if (binding.kind !== 'release' || !binding.inputs || typeof binding.inputs !== 'object' || Array.isArray(binding.inputs)) return false;
  // Unknown configuration-shaped input removes publicity, never grants it.
  return !Object.keys(binding.inputs).some(key => /psadt|config/i.test(key));
}

export function projectQaLiveCurated(input: {
  now: Date;
  session: QaCuratedLiveSessionRow | null;
  binding: QaCuratedLiveBinding | null;
  frame: QaCuratedLiveFrameRow | null;
}): { current: QaCuratedLiveCurrent; viewer: QaLiveResponse['viewer']; runner: QaLiveResponse['runner'] } | null {
  const { session, binding, frame } = input;
  if (!session || !binding || !UUID.test(session.id) || session.state !== 'active' || binding.status !== 'dispatched' ||
      session.queue_id !== binding.id || session.app_id !== binding.app_id || session.version !== binding.version ||
      (binding.github_run_id != null && binding.github_run_id !== String(session.github_run_id))) return null;
  const app = resolveCuratedAppForLive(session.app_id);
  if (!app || session.architecture !== app.architecture || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(session.version)) return null;
  const now = input.now.getTime();
  const started = Date.parse(session.started_at);
  const heartbeat = Date.parse(session.heartbeat_at);
  const dispatched = binding.dispatched_at == null ? null : Date.parse(binding.dispatched_at);
  // A session that began before the current dispatch belongs to an earlier run of this row.
  if (![now, started, heartbeat].every(Number.isFinite) || started > now + CLOCK_SKEW_MS || heartbeat < started ||
      heartbeat > now + CLOCK_SKEW_MS || now - started > CURATED_SESSION_MAX_AGE_MS ||
      (dispatched !== null && !(Number.isFinite(dispatched) && started >= dispatched))) return null;
  const stale = now - heartbeat > CURATED_HEARTBEAT_STALE_MS;
  const publicFrames = session.public_frames === true && session.verification === 'release' && curatedBindingAllowsPublicFrames(binding);
  const captured = frame ? Date.parse(frame.captured_at) : NaN;
  const updated = frame ? Date.parse(frame.updated_at) : NaN;
  const available = Boolean(publicFrames && !stale && frame && frame.session_id === session.id &&
    Number.isSafeInteger(frame.sequence) && frame.sequence >= 0 &&
    Number.isInteger(frame.width) && frame.width >= 64 && frame.width <= 1920 &&
    Number.isInteger(frame.height) && frame.height >= 64 && frame.height <= 1200 &&
    // Freshness uses the database write time. Capture time comes from the runner clock.
    Number.isFinite(captured) && Number.isFinite(updated) && captured >= started && updated >= started &&
    captured <= updated + CLOCK_SKEW_MS && captured <= now + CLOCK_SKEW_MS &&
    updated <= now + CLOCK_SKEW_MS && now - updated <= FRAME_MAX_AGE_MS && now - captured <= FRAME_MAX_AGE_MS);
  const phaseStarted = session.phase_started_at ? Date.parse(session.phase_started_at) : NaN;
  return {
    current: {
      runKind: 'curated', verification: publicFrames ? 'release' : 'custom-settings',
      wingetId: app.packageId, displayName: app.name, publisher: app.publisher,
      version: session.version, catalogVersion: session.version, architecture: app.architecture,
      executionContext: 'LocalSystem', phase: curatedLivePhase(session.phase),
      phaseStartedAt: Number.isFinite(phaseStarted) && phaseStarted >= started && phaseStarted <= now + CLOCK_SKEW_MS ? session.phase_started_at : null,
      startedAt: session.started_at, elapsedSeconds: Math.max(0, Math.floor((now - started) / 1000)),
      upgradePlanned: session.upgrade_planned === true,
    },
    runner: { state: stale ? 'stalled' : 'testing', heartbeatAt: session.heartbeat_at },
    viewer: { candidateId: null, sessionId: session.id, available,
      capturedAt: available ? frame!.updated_at : null, sequence: available ? frame!.sequence : null,
      width: available ? frame!.width : null, height: available ? frame!.height : null },
  };
}
