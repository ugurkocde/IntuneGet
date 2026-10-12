'use client';

import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import { isWin32CartItem, type CartItem } from '@/types/upload';
import type { CuratedSettingsResponse } from '@/types/curated-verification';

export function useCuratedSettings(items: CartItem[], enabled: boolean) {
  const { isAuthenticated, getAccessToken, user } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const curatedItems = items.filter(item => isWin32CartItem(item) && item.sourceType === 'curated');
  const input = JSON.stringify(curatedItems);
  const tenantId = isMspUser ? selectedTenantId : null;
  const query = useQuery<CuratedSettingsResponse>({
    queryKey: ['curated-settings', user?.id, user?.tenantId, tenantId, input],
    enabled: enabled && isAuthenticated && curatedItems.length > 0,
    queryFn: async ({ signal }) => {
      const token = await getAccessToken();
      if (!token) throw new Error('Sign in again to check deployment settings.');
      const response = await fetch('/api/curated-catalog/settings-verification', {
        method: 'POST', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
          ...(tenantId ? { 'X-MSP-Tenant-Id': tenantId } : {}) },
        body: JSON.stringify({ items: JSON.parse(input) }),
      });
      if (!response.ok) throw new Error('Could not check deployment settings.');
      const result = await response.json() as CuratedSettingsResponse;
      if (!Array.isArray(result.items)) throw new Error('Could not check deployment settings.');
      return result;
    },
    staleTime: 0,
    retry: false,
    refetchInterval: query => query.state.error || !query.state.data || query.state.data.items.some(item => item.status !== 'ready') ? 30_000 : false,
  });
  const ready = curatedItems.length === 0 || Boolean(!query.isError && query.data &&
    curatedItems.every(item => query.data.items.some(status => status.itemId === item.id && status.status === 'ready')));
  return { ...query, curatedItems, ready };
}
