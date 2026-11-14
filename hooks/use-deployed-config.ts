'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { CartItem } from '@/types/upload';

interface DeployedConfigResponse {
  config: CartItem | null;
  deployedAt: string | null;
  intuneAppId: string | null;
}

export function useDeployedConfig(wingetId: string | null) {
  const { getAccessToken, isAuthenticated, isInitializing } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const tenantKey = isMspUser ? selectedTenantId || 'primary' : 'self';

  const query = useQuery<DeployedConfigResponse>({
    queryKey: ['catalog', 'deployed-config', wingetId, tenantKey],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `/api/intune/apps/deployed/config?wingetId=${encodeURIComponent(wingetId!)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(isMspUser && selectedTenantId
              ? { 'X-MSP-Tenant-Id': selectedTenantId }
              : {}),
          },
        }
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || 'Failed to fetch deployed config');
      }

      return response.json();
    },
    enabled: isAuthenticated && !isInitializing && !!wingetId,
    staleTime: 2 * 60 * 1000,
  });

  return {
    deployedConfig: query.data?.config ?? null,
    deployedAt: query.data?.deployedAt ?? null,
    intuneAppId: query.data?.intuneAppId ?? null,
    isLoading: query.isLoading,
    isPending: query.isPending,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch,
    error: query.error,
  };
}
