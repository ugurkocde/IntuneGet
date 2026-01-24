'use client';

import { useMsp } from '@/contexts/MspContext';
import type { MspOrganization, MspOrganizationStats, CreateOrganizationRequest } from '@/types/msp';

/**
 * Hook for MSP organization management
 * Provides organization state and creation functionality
 */
export function useMspOrganization() {
  const {
    organization,
    stats,
    isMspUser,
    isLoadingOrganization,
    refreshOrganization,
    createOrganization,
  } = useMsp();

  return {
    organization,
    stats,
    isMspUser,
    isLoading: isLoadingOrganization,
    refresh: refreshOrganization,
    create: createOrganization,
  };
}

/**
 * Hook to check if user needs MSP setup
 */
export function useNeedsMspSetup(): boolean {
  const { isMspUser, isLoadingOrganization } = useMsp();

  // Don't show setup prompt while loading
  if (isLoadingOrganization) {
    return false;
  }

  return !isMspUser;
}

/**
 * Hook to get organization stats summary
 */
export function useMspStats(): {
  stats: MspOrganizationStats | null;
  isLoading: boolean;
  hasActiveTenants: boolean;
  hasPendingTenants: boolean;
  successRate: number;
} {
  const { stats, isLoadingOrganization } = useMsp();

  const hasActiveTenants = (stats?.active_tenants ?? 0) > 0;
  const hasPendingTenants = (stats?.pending_tenants ?? 0) > 0;

  // Calculate success rate
  const totalJobs = stats?.total_jobs ?? 0;
  const completedJobs = stats?.completed_jobs ?? 0;
  const successRate = totalJobs > 0 ? (completedJobs / totalJobs) * 100 : 0;

  return {
    stats,
    isLoading: isLoadingOrganization,
    hasActiveTenants,
    hasPendingTenants,
    successRate,
  };
}
