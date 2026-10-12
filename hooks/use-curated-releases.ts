'use client';

import { useQuery } from '@tanstack/react-query';

interface CuratedReleasesResponse {
  expiresAt: string | null;
  entries: Array<{
    app: { id: string; wingetId?: string };
    status: 'pending' | 'approved' | 'withdrawn';
    release: { id: string } | null;
  }>;
}

export function useCuratedReleases() {
  return useQuery<CuratedReleasesResponse>({
    queryKey: ['curated-release-links'],
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/curated-catalog', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('The curated catalog is temporarily unavailable.');
      return response.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}
