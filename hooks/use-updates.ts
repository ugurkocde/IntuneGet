'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { AppUpdateInfo } from '@/types/inventory';
import type {
  AvailableUpdate,
  AutoUpdateHistoryWithPolicy,
  AppUpdatePolicyInput,
  TriggerUpdateRequest,
  TriggerUpdateResponse,
} from '@/types/update-policies';

interface UpdatesResponse {
  updates: AppUpdateInfo[];
  updateCount: number;
  totalApps: number;
}

export function useAppUpdates() {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();

  return useQuery<UpdatesResponse>({
    queryKey: ['inventory', 'updates', isMspUser ? selectedTenantId || 'primary' : 'self'],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        // Return empty response instead of throwing to avoid console errors
        return { updates: [], updateCount: 0, totalApps: 0 };
      }

      const response = await fetch('/api/intune/apps/updates', {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(isMspUser && selectedTenantId ? { 'X-MSP-Tenant-Id': selectedTenantId } : {}),
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

// ============================================
// New hooks for auto-update management
// ============================================

export interface AvailableUpdatesResponse {
  updates: AvailableUpdate[];
  count: number;
  criticalCount: number;
}

export interface AutoUpdateHistoryResponse {
  history: AutoUpdateHistoryWithPolicy[];
  count: number;
  hasMore: boolean;
}

export interface UseAvailableUpdatesOptions {
  tenantId?: string;
  criticalOnly?: boolean;
  includeDismissed?: boolean;
}

export function buildAvailableUpdatesQueryParams(options: UseAvailableUpdatesOptions = {}): URLSearchParams {
  const queryParams = new URLSearchParams();

  if (options.tenantId) queryParams.set('tenant_id', options.tenantId);
  if (options.criticalOnly) queryParams.set('critical_only', 'true');
  if (options.includeDismissed) queryParams.set('include_dismissed', 'true');

  return queryParams;
}

/**
 * Hook to fetch available updates from the update management system
 */
export function useAvailableUpdates(options: UseAvailableUpdatesOptions = {}) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const queryParams = buildAvailableUpdatesQueryParams(options);
  const queryString = queryParams.toString();

  return useQuery<AvailableUpdatesResponse>({
    queryKey: [
      'availableUpdates',
      options.tenantId || null,
      options.criticalOnly === true,
      options.includeDismissed === true,
    ],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        return { updates: [], count: 0, criticalCount: 0 };
      }

      const url = queryString
        ? `/api/updates/available?${queryString}`
        : '/api/updates/available';
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch updates');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute
    refetchOnWindowFocus: false,
  });
}

export interface UseAutoUpdateHistoryOptions {
  tenantId?: string;
  wingetId?: string;
  status?: string;
  limit?: number;
}

export function buildAutoUpdateHistoryQueryParams(
  options: UseAutoUpdateHistoryOptions = {},
  limit = 20,
  offset = 0
): URLSearchParams {
  const queryParams = new URLSearchParams();

  if (options.tenantId) queryParams.set('tenant_id', options.tenantId);
  if (options.wingetId) queryParams.set('winget_id', options.wingetId);
  if (options.status) queryParams.set('status', options.status);
  queryParams.set('limit', limit.toString());
  queryParams.set('offset', offset.toString());

  return queryParams;
}

export function flattenAutoUpdateHistoryPages(
  pages: AutoUpdateHistoryResponse[] | undefined
): AutoUpdateHistoryWithPolicy[] {
  return (pages || []).flatMap((page) => page.history);
}

/**
 * Hook to fetch auto-update history with pagination
 */
export function useAutoUpdateHistory(options: UseAutoUpdateHistoryOptions = {}) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const limit = options.limit || 20;

  const query = useInfiniteQuery<AutoUpdateHistoryResponse, Error>({
    queryKey: [
      'autoUpdateHistory',
      options.tenantId || null,
      options.wingetId || null,
      options.status || null,
      limit,
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const token = await getAccessToken();
      if (!token) {
        return { history: [], count: 0, hasMore: false };
      }

      const queryParams = buildAutoUpdateHistoryQueryParams(
        options,
        limit,
        Number(pageParam)
      );

      const url = `/api/updates/history?${queryParams.toString()}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch history');
      }

      return response.json();
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) {
        return undefined;
      }
      return allPages.length * limit;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60, // 1 minute
  });

  const pages = query.data?.pages;
  const mergedHistory = flattenAutoUpdateHistoryPages(pages);
  const hasMore = query.hasNextPage ?? false;
  const fetchMore = () => {
    void query.fetchNextPage();
  };

  return {
    ...query,
    data: {
      history: mergedHistory,
      count: mergedHistory.length,
      hasMore,
    },
    fetchMore,
    hasMore,
    isLoadingMore: query.isFetchingNextPage,
  };
}

/**
 * Hook to trigger an update
 */
export function useTriggerUpdate() {
  const { getAccessToken } = useMicrosoftAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation<TriggerUpdateResponse, Error, TriggerUpdateRequest>({
    mutationFn: async (request) => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/updates/trigger', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to trigger update');
      }

      return response.json();
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['availableUpdates'] });
      queryClient.invalidateQueries({ queryKey: ['autoUpdateHistory'] });
    },
  });

  return {
    triggerUpdate: mutation.mutateAsync,
    isTriggering: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Hook to update a policy
 */
export function useUpdatePolicy() {
  const { getAccessToken } = useMicrosoftAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { policy: unknown; created: boolean },
    Error,
    AppUpdatePolicyInput
  >({
    mutationFn: async (input) => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/update-policies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update policy');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availableUpdates'] });
      queryClient.invalidateQueries({ queryKey: ['updatePolicies'] });
    },
  });

  return {
    updatePolicy: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Hook to dismiss updates
 */
export function useDismissUpdates() {
  const { getAccessToken } = useMicrosoftAuth();
  const queryClient = useQueryClient();

  const mutation = useMutation<
    { success: boolean; updated: number },
    Error,
    { updateIds: string[]; action: 'dismiss' | 'restore' }
  >({
    mutationFn: async ({ updateIds, action }) => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch('/api/updates/available', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          update_ids: updateIds,
          action,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update dismiss status');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availableUpdates'] });
    },
  });

  return {
    dismissUpdates: mutation.mutateAsync,
    isDismissing: mutation.isPending,
    error: mutation.error,
  };
}

/**
 * Hook to fetch all policies
 */
export function useUpdatePolicies(tenantId?: string) {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();

  return useQuery({
    queryKey: ['updatePolicies', tenantId],
    queryFn: async () => {
      const token = await getAccessToken();
      if (!token) {
        return { policies: [], count: 0 };
      }

      const queryParams = new URLSearchParams();
      if (tenantId) queryParams.set('tenant_id', tenantId);

      const url = `/api/update-policies?${queryParams.toString()}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch policies');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
