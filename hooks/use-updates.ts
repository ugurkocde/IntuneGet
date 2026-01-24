'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import type { AppUpdateInfo } from '@/types/inventory';

interface UpdatesResponse {
  updates: AppUpdateInfo[];
  updateCount: number;
  totalApps: number;
}

export function useAppUpdates() {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  return useQuery<UpdatesResponse>({
    queryKey: ['inventory', 'updates'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        // Return empty response instead of throwing to avoid console errors
        return { updates: [], updateCount: 0, totalApps: 0 };
      }

      const response = await fetch('/api/intune/apps/updates', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        // Return empty response for non-OK status to avoid noisy errors
        // This handles cases like missing admin consent, invalid permissions, etc.
        console.warn('Updates API returned non-OK status:', response.status);
        return { updates: [], updateCount: 0, totalApps: 0 };
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 10 * 60 * 1000, // 10 minutes - updates check is expensive
    refetchOnWindowFocus: false,
    retry: false, // Don't retry on failure - updates check is optional
  });
}
