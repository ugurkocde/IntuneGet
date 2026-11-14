export const ACTIVE_DEPLOYMENT_STATUSES: readonly string[] = [
  'blocked_upstream', 'awaiting_qa', 'queued', 'packaging', 'uploading',
];

export const SUCCEEDED_DEPLOYMENT_STATUSES: readonly string[] = [
  'completed', 'deployed', 'duplicate_skipped',
];

export const FAILED_DEPLOYMENT_STATUSES: readonly string[] = ['failed', 'qa_failed'];

export const TERMINAL_DEPLOYMENT_STATUSES: readonly string[] = [
  ...SUCCEEDED_DEPLOYMENT_STATUSES, ...FAILED_DEPLOYMENT_STATUSES, 'cancelled',
];
