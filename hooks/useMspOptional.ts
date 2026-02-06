'use client';

import { useMspOptional as useMspOptionalContext } from '@/contexts/MspContext';
import type { MspContextValue } from '@/types/msp';

/**
 * Hook to access MSP context with safe defaults when context is not available.
 * Use this in pages that need to check MSP status without requiring the provider.
 */
export function useMspOptional(): MspContextValue {
  const context = useMspOptionalContext();

  // Return safe defaults if context is not available
  if (!context) {
    return {
      organization: null,
      stats: null,
      isMspUser: false,
      isLoadingOrganization: false,
      managedTenants: [],
      isLoadingTenants: false,
      selectedTenantId: null,
      selectedTenant: null,
      refreshOrganization: async () => {},
      createOrganization: async () => {
        throw new Error('MSP context not available');
      },
      refreshTenants: async () => {},
      addTenant: async () => {
        throw new Error('MSP context not available');
      },
      removeTenant: async () => {
        throw new Error('MSP context not available');
      },
      selectTenant: () => {},
      clearSelection: () => {},
    };
  }

  return context;
}
