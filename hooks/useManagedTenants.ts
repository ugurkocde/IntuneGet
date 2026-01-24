'use client';

import { useMemo } from 'react';
import { useMsp } from '@/contexts/MspContext';
import type { MspManagedTenantWithStats, AddTenantRequest, AddTenantResponse } from '@/types/msp';

/**
 * Hook for managing MSP tenants
 * Provides tenant list, add, and remove functionality
 */
export function useManagedTenants() {
  const {
    managedTenants,
    isLoadingTenants,
    refreshTenants,
    addTenant,
    removeTenant,
  } = useMsp();

  // Filter to only active tenants with granted consent
  const activeTenants = useMemo(() => {
    return managedTenants.filter(
      t => t.is_active && t.consent_status === 'granted' && t.tenant_id
    );
  }, [managedTenants]);

  // Filter to pending tenants
  const pendingTenants = useMemo(() => {
    return managedTenants.filter(
      t => t.is_active && t.consent_status === 'pending'
    );
  }, [managedTenants]);

  return {
    tenants: managedTenants,
    activeTenants,
    pendingTenants,
    isLoading: isLoadingTenants,
    refresh: refreshTenants,
    add: addTenant,
    remove: removeTenant,
  };
}

/**
 * Hook to get a specific tenant by ID
 */
export function useTenantById(tenantId: string | null): MspManagedTenantWithStats | null {
  const { managedTenants } = useMsp();

  return useMemo(() => {
    if (!tenantId) return null;
    return managedTenants.find(t => t.tenant_id === tenantId) || null;
  }, [tenantId, managedTenants]);
}

/**
 * Hook to get tenant statistics summary
 */
export function useTenantStats() {
  const { managedTenants, isLoadingTenants } = useMsp();

  const stats = useMemo(() => {
    const active = managedTenants.filter(
      t => t.is_active && t.consent_status === 'granted' && t.tenant_id
    );
    const pending = managedTenants.filter(
      t => t.is_active && t.consent_status === 'pending'
    );

    const totalJobs = active.reduce((sum, t) => sum + (t.total_jobs || 0), 0);
    const completedJobs = active.reduce((sum, t) => sum + (t.completed_jobs || 0), 0);
    const failedJobs = active.reduce((sum, t) => sum + (t.failed_jobs || 0), 0);

    return {
      totalTenants: managedTenants.length,
      activeTenants: active.length,
      pendingTenants: pending.length,
      totalJobs,
      completedJobs,
      failedJobs,
      successRate: totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0,
    };
  }, [managedTenants]);

  return {
    ...stats,
    isLoading: isLoadingTenants,
  };
}
