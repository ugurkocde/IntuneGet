export const INTUNE_APPROVAL_CHECKPOINT_STATUSES = ['failed', 'cancelled'] as const;

export const INTUNE_APPROVAL_PENDING_MESSAGE =
  'An earlier deployment requires Intune administrator approval. A new deployment could create another app. Resolve the retained app and pending request in Intune before deploying again; approving the request alone does not resume this upload.';

export function isIntuneApprovalFailure(job: {
  error_category?: string | null;
  error_code?: string | null;
}): boolean {
  return job.error_category === 'approval' || job.error_code === 'INTUNE_APPROVAL_REQUIRED';
}
