'use client';

import { useQuery } from '@tanstack/react-query';
import type { QaDetailsResponse, QaLiveResponse, QaStatus } from '@/types/qa';

interface QaStatusesResponse {
  statuses: Record<string, QaStatus | null>;
}

export function useQaStatuses(ids: string[]) {
  const stableIds = [...new Set(ids)].sort();
  return useQuery<QaStatusesResponse>({
    queryKey: ['qa', 'statuses', stableIds],
    queryFn: async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < stableIds.length; i += 100) chunks.push(stableIds.slice(i, i + 100));
      const responses = await Promise.all(
        chunks.map(async (chunk) => {
          const params = new URLSearchParams({ ids: chunk.join(',') });
          const response = await fetch(`/api/qa/status?${params.toString()}`);
          if (!response.ok) throw new Error('Failed to load QA statuses');
          return (await response.json()) as QaStatusesResponse;
        })
      );
      return {
        statuses: Object.assign({}, ...responses.map((response) => response.statuses)),
      };
    },
    enabled: stableIds.length > 0,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
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
    queryFn: async () => {
      const params = new URLSearchParams();
      if (packageProfileSha256) params.set('profile', packageProfileSha256);
      const suffix = params.size ? `?${params.toString()}` : '';
      const response = await fetch(`/api/apps/${encodeURIComponent(wingetId)}/qa${suffix}`);
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
    queryFn: async () => {
      const response = await fetch('/api/qa/live', { cache: 'no-store' });
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
