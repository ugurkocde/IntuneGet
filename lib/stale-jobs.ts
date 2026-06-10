/**
 * Shared constants for stale packaging job cleanup.
 * Used by the cleanup cron (app/api/cron/cleanup-stale-jobs) and the
 * read-side self-healing in the package status route (app/api/package).
 */

export const STALE_JOB_TIMEOUT_MINUTES = 30;

export const INTERMEDIATE_STATES = ['queued', 'packaging', 'uploading'];

export const STALE_JOB_ERROR_MESSAGE = `Job timed out after ${STALE_JOB_TIMEOUT_MINUTES} minutes without progress. This may indicate a callback delivery failure or workflow crash.`;
