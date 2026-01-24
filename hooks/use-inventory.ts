'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import type { IntuneWin32App, IntuneAppWithAssignments } from '@/types/inventory';

interface InventoryResponse {
  apps: IntuneWin32App[];
  count: number;
}

interface AppDetailsResponse {
  app: IntuneAppWithAssignments;
}

export function useInventoryApps() {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  return useQuery<InventoryResponse>({
    queryKey: ['inventory', 'apps'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/intune/apps', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch inventory');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useAppDetails(appId: string | null) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  return useQuery<AppDetailsResponse>({
    queryKey: ['inventory', 'app', appId],
    queryFn: async () => {
      if (!appId) {
        throw new Error('No app ID provided');
      }

      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`/api/intune/apps/${appId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch app details');
      }

      return response.json();
    },
    enabled: isAuthenticated && !!appId,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}
