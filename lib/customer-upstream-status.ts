import type { CustomerQaStatus } from '@/types/customer-qa';

export type CustomerUpstreamReason = 'UPSTREAM_SOURCE_BACKOFF' | 'UPSTREAM_METADATA_MISMATCH';

/** Public copy is fixed. Producer messages and installer identities stay private. */
export function customerUpstreamStatus(code: string | null): CustomerQaStatus {
  const reasonCode = code === 'UPSTREAM_SOURCE_BACKOFF' || code === 'UPSTREAM_METADATA_MISMATCH' ? code : undefined;
  return {
    category: 'blocked_upstream',
    ...(reasonCode ? { reasonCode } : {}),
    message: reasonCode === 'UPSTREAM_SOURCE_BACKOFF'
      ? 'Installer source checks are deferred. Next event: a scheduled source check.'
      : 'Validation status is temporarily unavailable. Next event: updated validation information.',
    nextEventAt: null,
  };
}
