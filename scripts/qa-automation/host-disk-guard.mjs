// The QA VM's differencing disk grows during every lifecycle. When the host's
// system drive runs low, stop new dispatch before it fills up (the 2026-10-05
// outage paused QA only after the disk was exhausted) and resume on our own
// once space is back. The guard only ever lifts a pause it set itself.
export const diskGuardActor = 'qa-host-disk-guard';
export const diskPauseBelowGb = 50;
export const diskResumeAtGb = 75;

/**
 * @param {{ freeGb: number | null, control: { paused: boolean, updated_by?: string | null } }} input
 * @returns {'none' | 'pause' | 'hold' | 'resume'}
 */
export function decideDiskAction({ freeGb, control }) {
  if (typeof freeGb !== 'number' || !Number.isFinite(freeGb)) return 'none';
  const ownPause = control.paused && control.updated_by === diskGuardActor;
  if (ownPause) return freeGb >= diskResumeAtGb ? 'resume' : 'hold';
  if (!control.paused && freeGb < diskPauseBelowGb) return 'pause';
  return 'none';
}

export function lowDiskReason(freeGb) {
  return `QA host low disk space: ${freeGb} GB free, below ${diskPauseBelowGb} GB. ` +
    `Dispatch resumes automatically at ${diskResumeAtGb} GB.`;
}

export function parseHostFreeGb(argv) {
  const index = argv.indexOf('--host-free-gb');
  if (index < 0) return null;
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
