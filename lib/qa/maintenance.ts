/** Explicit operator switch, independent of automatic failure pauses and timers. */
export function isQaMaintenanceMode(): boolean {
  return process.env.QA_MAINTENANCE_MODE === 'true';
}
