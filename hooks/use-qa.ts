'use client';

import { useQuery } from '@tanstack/react-query';
import type { QaDetailsResponse, QaStatus } from '@/types/qa';

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

export function useQaDetails(wingetId: string, enabled: boolean) {
  return useQuery<QaDetailsResponse>({
    queryKey: ['qa', 'details', wingetId],
    queryFn: async () => {
      const response = await fetch(`/api/apps/${encodeURIComponent(wingetId)}/qa`);
      if (!response.ok) throw new Error('Failed to load QA details');
      return response.json();
    },
    enabled: Boolean(wingetId) && enabled,
    staleTime: 5 * 60 * 1000,
  });
}
