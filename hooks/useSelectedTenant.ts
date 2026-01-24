'use client';

import { useMemo, useCallback } from 'react';
import { useMsp, useMspOptional } from '@/contexts/MspContext';
import type { MspManagedTenantWithStats } from '@/types/msp';

/**
 * Hook for managing the currently selected tenant
 * Provides tenant selection state and actions
 */
export function useSelectedTenant() {
  const {
    selectedTenantId,
    selectedTenant,
    managedTenants,
    selectTenant,
    clearSelection,
    isMspUser,
  } = useMsp();

  // Get active tenants that can be selected
  const selectableTenants = useMemo(() => {
    return managedTenants.filter(
      t => t.is_active && t.consent_status === 'granted' && t.tenant_id
    );
  }, [managedTenants]);

  // Check if a specific tenant is selected
  const isSelected = useCallback((tenantId: string) => {
    return selectedTenantId === tenantId;
  }, [selectedTenantId]);

  return {
    selectedTenantId,
    selectedTenant,
    selectableTenants,
    isMspUser,
    select: selectTenant,
    clear: clearSelection,
    isSelected,
  };
}

/**
 * Hook to get the effective tenant ID for operations
 * Falls back to user's own tenant if not an MSP user or no selection
 */
export function useEffectiveTenantId(userTenantId: string | undefined): string | null {
  const context = useMspOptional();

  return useMemo(() => {
    // If not in MSP context or not an MSP user, use the user's tenant
    if (!context || !context.isMspUser) {
      return userTenantId || null;
    }

    // If MSP user has a selected tenant, use that
    if (context.selectedTenantId) {
      return context.selectedTenantId;
    }

    // Fall back to user's own tenant
    return userTenantId || null;
  }, [context, userTenantId]);
}

/**
 * Hook to check if the user can perform operations on a specific tenant
 */
export function useCanAccessTenant(tenantId: string | null): boolean {
  const context = useMspOptional();

  return useMemo(() => {
    if (!tenantId) return false;

    // If not in MSP context, assume they can access their own tenant
    if (!context) return true;

    // If not an MSP user, they can only access their own tenant
    if (!context.isMspUser) return true;

    // Check if the tenant is in the managed tenants list
    return context.managedTenants.some(
      t => t.tenant_id === tenantId &&
           t.is_active &&
           t.consent_status === 'granted'
    );
  }, [context, tenantId]);
}

/**
 * Hook to get tenant display name
 */
export function useTenantDisplayName(tenantId: string | null): string {
  const context = useMspOptional();

  return useMemo(() => {
    if (!tenantId) return 'Unknown';

    if (!context || !context.isMspUser) {
      return 'My Organization';
    }

    const tenant = context.managedTenants.find(t => t.tenant_id === tenantId);
    return tenant?.display_name || tenant?.tenant_name || 'Unknown Tenant';
  }, [context, tenantId]);
}
