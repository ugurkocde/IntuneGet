'use client';

import type { AppRelationship } from '@/types/intune';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useMicrosoftAuth } from './useMicrosoftAuth';
import { useMspOptional } from './useMspOptional';
import type { PackageAssignment, IntuneAppCategorySelection } from '@/types/upload';

interface UpdateAppSettingsRequest {
  intuneAppId: string;
  wingetId: string;
  assignments?: PackageAssignment[];
  categories?: IntuneAppCategorySelection[];
  relationships?: AppRelationship[];
  baselineRelationships?: AppRelationship[];
}

export function useUpdateAppSettings() {
  const { getAccessToken } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const queryClient = useQueryClient();
  const tenantKey = isMspUser ? selectedTenantId || 'primary' : 'self';

  const mutation = useMutation<{ success: boolean }, Error, UpdateAppSettingsRequest>({
    mutationFn: async ({ intuneAppId, wingetId, assignments, categories, relationships, baselineRelationships }) => {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Not authenticated');
      }

      const response = await fetch(
        `/api/intune/apps/${encodeURIComponent(intuneAppId)}/settings`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(isMspUser && selectedTenantId
              ? { 'X-MSP-Tenant-Id': selectedTenantId }
              : {}),
          },
          body: JSON.stringify({ assignments, categories, wingetId, relationships, baselineRelationships }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || 'Failed to update app settings');
      }

      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['catalog', 'deployed-config', variables.wingetId, tenantKey],
      });
    },
  });

  return {
    updateSettings: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}
