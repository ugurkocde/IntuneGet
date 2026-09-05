'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchQaStatuses, QA_STATUS_FRESH_MS } from '@/lib/qa/client-status-cache';
import type { QaDetailsResponse, QaLiveResponse, QaStatus } from '@/types/qa';

interface QaStatusesResponse {
  statuses: Record<string, QaStatus | null>;
}

export function useQaStatuses(ids: string[], enabled = true) {
  const client = useQueryClient();
  const stableIds = [...new Set(ids)].sort();
  return useQuery<QaStatusesResponse>({
    queryKey: ['qa', 'statuses', stableIds],
    queryFn: ({ signal }) => fetchQaStatuses(client, stableIds, signal),
    enabled: enabled && stableIds.length > 0,
    staleTime: QA_STATUS_FRESH_MS,
    refetchInterval: QA_STATUS_FRESH_MS,
    refetchIntervalInBackground: false,
  });
}

export class QaDetailsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSeconds: number | null
  ) {
    super(message);
    this.name = 'QaDetailsRequestError';
  }
}

function parseRetryAfter(response: Response): number | null {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function shouldRetryQaDetails(failureCount: number, error: Error): boolean {
  if (!(error instanceof QaDetailsRequestError)) return failureCount < 1;
  if (error.status === 404) return failureCount < 1;
  if (error.status >= 500) return failureCount < 2;
  return false;
}

export function useQaDetails(
  wingetId: string,
  packageProfileSha256: string | undefined,
  enabled: boolean
) {
  return useQuery<QaDetailsResponse>({
    queryKey: ['qa', 'details', wingetId, packageProfileSha256 || 'latest'],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (packageProfileSha256) params.set('profile', packageProfileSha256);
      const suffix = params.size ? `?${params.toString()}` : '';
      const response = await fetch(`/api/apps/${encodeURIComponent(wingetId)}/qa${suffix}`, { signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new QaDetailsRequestError(
          payload?.error || 'Failed to load QA details',
          response.status,
          parseRetryAfter(response)
        );
      }
      return response.json();
    },
    enabled: Boolean(wingetId) && enabled,
    staleTime: 5 * 60 * 1000,
    retry: shouldRetryQaDetails,
    retryDelay: (attempt, error) => {
      if (error instanceof QaDetailsRequestError && error.retryAfterSeconds) {
        return error.retryAfterSeconds * 1000;
      }
      return Math.min(500 * 2 ** attempt, 2_000);
    },
    refetchOnWindowFocus: false,
  });
}

export function useQaLive() {
  return useQuery<QaLiveResponse>({
    queryKey: ['qa', 'live'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/qa/live', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('Failed to load live QA status');
      return response.json();
    },
    staleTime: 500,
    refetchInterval: (query) => {
      const phase = query.state.data?.current?.phase;
      if (phase === 'installing' || phase === 'uninstalling') return 1_000;
      return query.state.data?.active ? 2_000 : 10_000;
    },
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
  });
}
