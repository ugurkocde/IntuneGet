import type { QaLivePhase } from '@/types/qa';

const QA_PHASES: Array<{ id: QaLivePhase; label: string }> = [
  { id: 'preparing_package', label: 'Preparing package' },
  { id: 'restoring_vm', label: 'Restoring golden VM' },
  { id: 'installing', label: 'Installing' },
  { id: 'detecting_install', label: 'Testing detection' },
  { id: 'uninstalling', label: 'Uninstalling' },
  { id: 'verifying_removal', label: 'Verifying removal' },
  { id: 'publishing', label: 'Publishing result' },
];

export interface QaPhasePresentation {
  label: string;
  step: number;
  totalSteps: number;
  progressPercent: number;
}

export type QaFrameState = 'waiting' | 'live' | 'paused';

export function getQaPhasePresentation(phase: QaLivePhase): QaPhasePresentation {
  const phaseIndex = QA_PHASES.findIndex((item) => item.id === phase);
  const step = phaseIndex < 0 ? 0 : phaseIndex + 1;

  return {
    label: phase === 'queued' ? 'Queued' : (QA_PHASES[phaseIndex]?.label ?? 'Preparing test'),
    step,
    totalSteps: QA_PHASES.length,
    progressPercent: Math.round((step / QA_PHASES.length) * 100),
  };
}

export function getQaFrameState({
  available,
  capturedAt,
  serverTime,
  staleAfterSeconds = 15,
}: {
  available: boolean;
  capturedAt: string | null;
  serverTime: string;
  staleAfterSeconds?: number;
}): QaFrameState {
  if (!available) return 'waiting';
  if (!capturedAt) return 'paused';

  const capturedAtMs = Date.parse(capturedAt);
  const serverTimeMs = Date.parse(serverTime);
  if (!Number.isFinite(capturedAtMs) || !Number.isFinite(serverTimeMs)) return 'paused';

  const ageSeconds = Math.max(0, (serverTimeMs - capturedAtMs) / 1000);
  return ageSeconds <= staleAfterSeconds ? 'live' : 'paused';
}

export function formatRelativeTime(value: string | null, referenceTime: string): string | null {
  if (!value) return null;

  const valueMs = Date.parse(value);
  const referenceMs = Date.parse(referenceTime);
  if (!Number.isFinite(valueMs) || !Number.isFinite(referenceMs)) return null;

  const seconds = Math.max(0, Math.floor((referenceMs - valueMs) / 1000));
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.floor(hours / 24)}d ago`;
}

export function formatQaDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';

  const roundedSeconds = Math.max(0, Math.round(seconds));
  if (roundedSeconds < 60) return `${roundedSeconds}s`;

  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}
