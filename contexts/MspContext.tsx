'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useUserSettings } from '@/components/providers/UserSettingsProvider';
import type {
  MspOrganization,
  MspOrganizationStats,
  MspManagedTenantWithStats,
  MspContextValue,
  MspAccessMode,
  CreateOrganizationRequest,
  AddTenantRequest,
  AddTenantResponse,
  GetOrganizationResponse,
  GetTenantsResponse,
} from '@/types/msp';

const MspContext = createContext<MspContextValue | null>(null);

export function MspProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, getAccessToken } = useMicrosoftAuth();
  const { settings, setSelectedTenantId: setStoredSelectedTenantId } = useUserSettings();

  // Organization state
  const [organization, setOrganization] = useState<MspOrganization | null>(null);
  const [stats, setStats] = useState<MspOrganizationStats | null>(null);
  const [isMspUser, setIsMspUser] = useState(false);
  const [accessMode, setAccessMode] = useState<MspAccessMode>('full');
  const [isLoadingOrganization, setIsLoadingOrganization] = useState(true);

  // Tenants state
  const [managedTenants, setManagedTenants] = useState<MspManagedTenantWithStats[]>([]);
  const [isLoadingTenants, setIsLoadingTenants] = useState(false);

  // Selected tenant state
  const [selectedTenantId, setSelectedTenantIdState] = useState<string | null>(null);

  // Compute selected tenant from managed tenants
  const selectedTenant = useMemo(() => {
    if (!selectedTenantId) return null;
    return managedTenants.find(t => t.tenant_id === selectedTenantId) || null;
  }, [selectedTenantId, managedTenants]);

  useEffect(() => {
    setSelectedTenantIdState(settings.selectedTenantId);
  }, [settings.selectedTenantId]);

  // Refresh organization data
  const refreshOrganization = useCallback(async () => {
    if (!isAuthenticated) {
      setIsLoadingOrganization(false);
      return;
    }

    setIsLoadingOrganization(true);

    try {
      const token = await getAccessToken();
      if (!token) {
        setIsLoadingOrganization(false);
        return;
      }

      const response = await fetch('/api/msp/organization', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch organization');
      }

      const data: GetOrganizationResponse = await response.json();

      setOrganization(data.organization);
      setStats(data.stats);
      setIsMspUser(data.isMspUser);
      setAccessMode(data.current_user?.access_mode || 'full');
    } catch (error) {
      console.error('Error fetching MSP organization:', error);
      setOrganization(null);
      setStats(null);
      setIsMspUser(false);
      setAccessMode('full');
    } finally {
      setIsLoadingOrganization(false);
    }
  }, [isAuthenticated, getAccessToken]);

  // Create organization
  const createOrganization = useCallback(async (data: CreateOrganizationRequest): Promise<MspOrganization> => {
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch('/api/msp/organization', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to create organization');
    }

    const result = await response.json();

    // Refresh to get updated data
    await refreshOrganization();

    return result.organization;
  }, [getAccessToken, refreshOrganization]);

  // Refresh tenants
  const refreshTenants = useCallback(async () => {
    if (!isMspUser || !organization) {
      return;
    }

    setIsLoadingTenants(true);

    try {
      const token = await getAccessToken();
      if (!token) {
        return;
      }

      const response = await fetch('/api/msp/tenants', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch tenants');
      }

      const data: GetTenantsResponse = await response.json();
      setManagedTenants(data.tenants);

      // If selected tenant is no longer in the list, clear selection
      if (selectedTenantId && !data.tenants.some(t => t.tenant_id === selectedTenantId)) {
        setSelectedTenantIdState(null);
        void setStoredSelectedTenantId(null);
      }

      // Auto-select first active tenant if none selected
      if (!selectedTenantId && data.tenants.length > 0) {
        const firstActive = data.tenants.find(t => t.consent_status === 'granted' && t.tenant_id);
        if (firstActive?.tenant_id) {
          setSelectedTenantIdState(firstActive.tenant_id);
          void setStoredSelectedTenantId(firstActive.tenant_id);
        }
      }
    } catch (error) {
      console.error('Error fetching MSP tenants:', error);
    } finally {
      setIsLoadingTenants(false);
    }
  }, [isMspUser, organization, getAccessToken, selectedTenantId, setStoredSelectedTenantId]);

  // Add tenant
  const addTenant = useCallback(async (data: AddTenantRequest): Promise<AddTenantResponse> => {
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch('/api/msp/tenants', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorData = await response.json();
      // Prefer the detailed message field over the generic error field
      throw new Error(errorData.message || errorData.error || 'Failed to add tenant');
    }

    const result: AddTenantResponse = await response.json();

    if (!result.consentUrl) {
      // Refresh tenants so the created record appears in the list
      await refreshTenants();
      throw new Error('The tenant was created but the consent URL could not be generated. Use "Get Consent URL" from the tenant menu to retrieve it.');
    }

    // Refresh tenants list
    await refreshTenants();

    return result;
  }, [getAccessToken, refreshTenants]);

  // Remove tenant
  const removeTenant = useCallback(async (tenantRecordId: string): Promise<void> => {
    const token = await getAccessToken();
    if (!token) {
      throw new Error('Authentication required');
    }

    const response = await fetch(`/api/msp/tenants?id=${tenantRecordId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to remove tenant');
    }

    // Refresh tenants list
    await refreshTenants();
  }, [getAccessToken, refreshTenants]);

  // Select tenant
  const selectTenant = useCallback((tenantId: string | null) => {
    setSelectedTenantIdState(tenantId);
    void setStoredSelectedTenantId(tenantId);
  }, [setStoredSelectedTenantId]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedTenantIdState(null);
    void setStoredSelectedTenantId(null);
  }, [setStoredSelectedTenantId]);

  // Initial load
  useEffect(() => {
    refreshOrganization();
  }, [refreshOrganization]);

  // Load tenants when organization changes
  useEffect(() => {
    if (isMspUser && organization) {
      refreshTenants();
    }
  }, [isMspUser, organization, refreshTenants]);

  const contextValue: MspContextValue = {
    // State
    organization,
    stats,
    isMspUser,
    accessMode,
    isLoadingOrganization,
    managedTenants,
    isLoadingTenants,
    selectedTenantId,
    selectedTenant,

    // Actions
    refreshOrganization,
    createOrganization,
    refreshTenants,
    addTenant,
    removeTenant,
    selectTenant,
    clearSelection,
  };

  return (
    <MspContext.Provider value={contextValue}>
      {children}
    </MspContext.Provider>
  );
}

export function useMsp(): MspContextValue {
  const context = useContext(MspContext);
  if (!context) {
    throw new Error('useMsp must be used within an MspProvider');
  }
  return context;
}

export function useMspOptional(): MspContextValue | null {
  return useContext(MspContext);
}
