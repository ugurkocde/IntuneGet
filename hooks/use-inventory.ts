'use client';

import { useEffect, useMemo } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { InventoryListApp, IntuneAppWithAssignments } from '@/types/inventory';

interface InventoryResponse {
  apps: InventoryListApp[];
  nextPageToken: string | null;
  count: number;
}

interface AppDetailsResponse {
  app: IntuneAppWithAssignments;
}

export function useInventoryApps() {
  const { getAccessToken, isAuthenticated, user } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const query = useInfiniteQuery({
    queryKey: ['inventory', 'apps', user?.id, user?.tenantId, isMspUser ? selectedTenantId || 'primary' : 'self'],
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }): Promise<InventoryResponse> => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const params = new URLSearchParams({ view: 'list' });
      if (pageParam) params.set('cursor', pageParam);
      const response = await fetch(`/api/intune/apps?${params}`, {
        signal,
        headers: { Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}) },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch inventory');
      }
      const page = await response.json() as InventoryResponse;
      if (page.nextPageToken && page.nextPageToken === pageParam) {
        throw new Error('Inventory pagination did not advance. Please retry.');
      }
      return page;
    },
    getNextPageParam: lastPage => lastPage.nextPageToken || undefined,
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetching && !isError) void fetchNextPage();
  }, [hasNextPage, isFetching, isError, fetchNextPage]);
  const data = useMemo(() => query.data ? {
    apps: [...new Map(query.data.pages.flatMap(page => page.apps).map(app => [app.id, app])).values()],
  } : undefined, [query.data]);
  return { ...query, data, isComplete: !hasNextPage && !isFetching && !isError };
}

export function useInventoryIcon(appId: string, enabled: boolean) {
  const { getAccessToken, isAuthenticated, user } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  return useQuery<{ icon: { type: string; value: string } | null }>({
    queryKey: ['inventory', 'icon', user?.id, user?.tenantId, isMspUser ? selectedTenantId || 'primary' : 'self', appId],
    queryFn: async ({ signal }) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Not authenticated');
      const response = await fetch(`/api/intune/apps/${encodeURIComponent(appId)}?view=icon`, {
        signal, headers: { Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}) },
      });
      if (!response.ok) throw new Error('Failed to load app icon');
      return response.json();
    },
    enabled: isAuthenticated && enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useAppDetails(appId: string | null) {
  const { getAccessToken, isAuthenticated, user } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<AppDetailsResponse>({
    queryKey: ['inventory', 'app', appId, user?.id, user?.tenantId, isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async ({ signal }) => {
      if (!appId) {
        throw new Error('No app ID provided');
      }

      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(`/api/intune/apps/${appId}`, {
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
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
