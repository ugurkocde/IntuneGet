'use client';
import { useLayoutEffect } from 'react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import { useCartStore } from '@/stores/cart-store';

/** Bind the cart only after identity and the initial tenant selection settle. */
export function useCartScopeSync() {
  const { isAuthenticated, isInitializing, account } = useMicrosoftAuth();
  const { isLoadingOrganization, isMspUser, isLoadingTenants, selectedTenantId } = useMspOptional();
  const syncScope = useCartStore(state => state.syncScope);
  const boundScope = useCartStore(state => state.scope);
  const activeScope = useCartStore(state => state.activeScope);
  const ready = isAuthenticated && !isInitializing && account?.homeAccountId && account.tenantId
    && !isLoadingOrganization && !(isMspUser && isLoadingTenants && !selectedTenantId);
  const scope = ready ? account.homeAccountId + '|' + (isMspUser && selectedTenantId ? selectedTenantId : account.tenantId) : null;
  useLayoutEffect(() => { syncScope(scope); }, [scope, boundScope, activeScope, syncScope]);
}
