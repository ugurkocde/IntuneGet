'use client';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';

interface TenantDeploymentsResponse {
  tenantDeployments: { wingetId: string; deployedBy: string | null }[];
}

export function useTenantDeployments() {
  const { getAccessToken, isAuthenticated, user } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const tenantKey = isMspUser ? selectedTenantId || 'primary' : 'self';
  const query = useQuery<TenantDeploymentsResponse>({
    queryKey: ['catalog', 'deployed', 'tenant', user?.tenantId ?? 'unknown', tenantKey],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const response = await fetch('/api/intune/apps/deployed?scope=tenant', {
        headers: {
          Authorization: 'Bearer ' + token,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
        },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to fetch tenant deployments');
      }
      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
  const tenantDeployments = useMemo(() => new Map(
    (query.data?.tenantDeployments ?? []).map(item => [item.wingetId, item.deployedBy])
  ), [query.data]);
  return { tenantDeployments, isLoading: query.isLoading, error: query.error };
}
