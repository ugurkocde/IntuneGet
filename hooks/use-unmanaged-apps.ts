'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMspOptional } from '@/hooks/useMspOptional';
import { useUserSettings } from '@/components/providers/UserSettingsProvider';
import { useCartStore } from '@/stores/cart-store';
import { generateDetectionRules, generateInstallCommand, generateUninstallCommand } from '@/lib/detection-rules';
import { DEFAULT_PSADT_CONFIG, getDefaultProcessesToClose } from '@/types/psadt';
import { toast } from '@/hooks/use-toast';
import type {
  UnmanagedApp,
  UnmanagedAppsResponse,
  UnmanagedAppsStats,
  UnmanagedAppsFilters,
  MatchStatus,
} from '@/types/unmanaged';
import type { ClaimAllModalState, ClaimAllItemStatus } from '@/components/unmanaged';

type ViewMode = 'grid' | 'list';

const defaultFilters: UnmanagedAppsFilters = {
  search: '',
  matchStatus: 'all',
  sortBy: 'deviceCount',
  sortOrder: 'desc',
  showClaimed: true,
};

export interface UseUnmanagedAppsReturn {
  // Data
  apps: UnmanagedApp[];
  filteredApps: UnmanagedApp[];
  statusCounts: { all: number; matched: number; partial: number; unmatched: number };
  computedStats: UnmanagedAppsStats;
  claimableCount: number;
  lastSynced: string | null;
  fromCache: boolean;

  // UI state
  isLoading: boolean;
  isRefreshing: boolean;
  filters: UnmanagedAppsFilters;
  permissionError: string | null;
  viewMode: ViewMode;
  claimingAppId: string | null;

  // Modal state
  claimModalApp: UnmanagedApp | null;
  linkModalApp: UnmanagedApp | null;
  claimAllModal: ClaimAllModalState | null;

  // Actions
  setFilters: (filters: UnmanagedAppsFilters) => void;
  setViewMode: (mode: ViewMode) => void;
  setClaimModalApp: (app: UnmanagedApp | null) => void;
  setLinkModalApp: (app: UnmanagedApp | null) => void;
  setClaimAllModal: (state: ClaimAllModalState | null) => void;
  setPermissionError: (error: string | null) => void;
  handleRefresh: () => Promise<void>;
  handleClaimApp: (app: UnmanagedApp) => Promise<void>;
  handleClaimAll: () => Promise<void>;
  handleLinkPackage: (app: UnmanagedApp, wingetPackageId: string) => Promise<void>;
  processClaimAll: (apps: UnmanagedApp[]) => Promise<void>;
  cancelClaimAll: () => void;
  retryFailedClaims: () => Promise<void>;
  clearFilters: () => void;
}

function isMicrosoftApp(app: UnmanagedApp): boolean {
  const publisherLower = (app.publisher || '').toLowerCase();
  const packageIdLower = (app.matchedPackageId || '').toLowerCase();
  const displayNameLower = app.displayName.toLowerCase();

  return (
    publisherLower.includes('microsoft') ||
    packageIdLower.startsWith('microsoft.') ||
    displayNameLower.startsWith('microsoft ')
  );
}

export function useUnmanagedApps(): UseUnmanagedAppsReturn {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { isMspUser, selectedTenantId } = useMspOptional();
  const addItem = useCartStore((state) => state.addItem);
  const addItemSilent = useCartStore((state) => state.addItemSilent);
  const cartItems = useCartStore((state) => state.items);
  const tokenRef = useRef<string | null>(null);
  const mspHeaders = useMemo<Record<string, string>>(() => {
    const headers: Record<string, string> = {};

    if (isMspUser && selectedTenantId) {
      headers['X-MSP-Tenant-Id'] = selectedTenantId;
    }

    return headers;
  }, [isMspUser, selectedTenantId]);

  // Data state
  const [apps, setApps] = useState<UnmanagedApp[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filters, setFilters] = useState<UnmanagedAppsFilters>(defaultFilters);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const { settings: userSettings, setViewMode: persistViewMode } = useUserSettings();
  const [viewMode, setViewModeLocal] = useState<ViewMode>(userSettings.viewMode);
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeLocal(mode);
    void persistViewMode(mode);
  }, [persistViewMode]);

  // Modal state
  const [claimModalApp, setClaimModalApp] = useState<UnmanagedApp | null>(null);
  const [linkModalApp, setLinkModalApp] = useState<UnmanagedApp | null>(null);
  const [claimingAppId, setClaimingAppId] = useState<string | null>(null);
  const [claimAllModal, setClaimAllModal] = useState<ClaimAllModalState | null>(null);

  // Get current access token
  const getToken = useCallback(async (): Promise<string | null> => {
    const token = await getAccessToken();
    tokenRef.current = token;
    return token;
  }, [getAccessToken]);

  // Fetch unmanaged apps
  const fetchApps = useCallback(async (forceRefresh = false) => {
    const accessToken = await getToken();
    if (!accessToken) return;

    try {
      const url = `/api/intune/unmanaged-apps${forceRefresh ? '?refresh=true' : ''}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...mspHeaders,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 403 && errorData.permissionRequired) {
          setPermissionError(errorData.permissionRequired);
          return;
        }

        throw new Error(errorData.error || 'Failed to fetch unmanaged apps');
      }

      setPermissionError(null);
      const data: UnmanagedAppsResponse = await response.json();
      setApps(data.apps);
      setLastSynced(data.lastSynced);
      setFromCache(data.fromCache);
    } catch (error) {
      console.error('Error fetching unmanaged apps:', error);
      const message = error instanceof Error ? error.message : 'Failed to fetch unmanaged apps from Intune';
      toast({
        title: 'Failed to load apps',
        description: message.includes('fetch') ? 'Network error. Check your connection and try again.' : message,
        variant: 'destructive',
      });
    }
  }, [getToken, mspHeaders]);

  // Initial load
  useEffect(() => {
    if (!isAuthenticated) return;

    const load = async () => {
      setIsLoading(true);
      await fetchApps();
      setIsLoading(false);
    };
    load();
  }, [fetchApps, isAuthenticated]);

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchApps(true);
    setIsRefreshing(false);
    toast({
      title: 'Refreshed',
      description: 'Unmanaged apps list has been updated',
    });
  }, [fetchApps]);

  // Cart winget IDs for quick lookup
  const cartWingetIds = useMemo(() => {
    return new Set(cartItems.map(item => item.wingetId));
  }, [cartItems]);

  // Non-Microsoft apps (base filtering + dedup by discoveredAppId)
  const nonMicrosoftApps = useMemo(() => {
    const seen = new Set<string>();
    return apps.filter(app => {
      if (seen.has(app.discoveredAppId)) return false;
      seen.add(app.discoveredAppId);
      return !isMicrosoftApp(app);
    });
  }, [apps]);

  // Filter and sort apps
  const filteredApps = useMemo(() => {
    let result = nonMicrosoftApps.map((app) => ({
      ...app,
      isClaimed: app.matchedPackageId ? cartWingetIds.has(app.matchedPackageId) : false,
    }));

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter(
        (app) =>
          app.displayName.toLowerCase().includes(searchLower) ||
          app.publisher?.toLowerCase().includes(searchLower) ||
          app.matchedPackageId?.toLowerCase().includes(searchLower)
      );
    }

    if (filters.matchStatus !== 'all') {
      result = result.filter((app) => app.matchStatus === filters.matchStatus);
    }

    if (!filters.showClaimed) {
      result = result.filter((app) => !app.isClaimed);
    }

    result.sort((a, b) => {
      let comparison = 0;
      switch (filters.sortBy) {
        case 'name':
          comparison = a.displayName.localeCompare(b.displayName);
          break;
        case 'deviceCount':
          comparison = a.deviceCount - b.deviceCount;
          break;
        case 'publisher':
          comparison = (a.publisher || '').localeCompare(b.publisher || '');
          break;
        case 'matchStatus': {
          const statusOrder = { matched: 0, partial: 1, unmatched: 2, pending: 3 };
          comparison = statusOrder[a.matchStatus] - statusOrder[b.matchStatus];
          break;
        }
      }
      return filters.sortOrder === 'desc' ? -comparison : comparison;
    });

    return result;
  }, [nonMicrosoftApps, filters, cartWingetIds]);

  // Status counts
  const statusCounts = useMemo(() => {
    return {
      all: nonMicrosoftApps.length,
      matched: nonMicrosoftApps.filter(a => a.matchStatus === 'matched').length,
      partial: nonMicrosoftApps.filter(a => a.matchStatus === 'partial').length,
      unmatched: nonMicrosoftApps.filter(a => a.matchStatus === 'unmatched').length,
    };
  }, [nonMicrosoftApps]);

  // Computed stats
  const computedStats = useMemo((): UnmanagedAppsStats => {
    const appsWithClaimSync = nonMicrosoftApps.map(app => ({
      ...app,
      isClaimed: app.matchedPackageId ? cartWingetIds.has(app.matchedPackageId) : false,
    }));

    return {
      total: appsWithClaimSync.length,
      matched: appsWithClaimSync.filter(a => a.matchStatus === 'matched').length,
      partial: appsWithClaimSync.filter(a => a.matchStatus === 'partial').length,
      unmatched: appsWithClaimSync.filter(a => a.matchStatus === 'unmatched').length,
      claimed: appsWithClaimSync.filter(a => a.isClaimed).length,
      totalDevices: appsWithClaimSync.reduce((sum, a) => sum + (a.deviceCount || 0), 0),
    };
  }, [nonMicrosoftApps, cartWingetIds]);

  // Claimable count (matched, not claimed, has packageId)
  const claimableCount = useMemo(() => {
    return filteredApps.filter(
      (app) => app.matchStatus === 'matched' && !app.isClaimed && app.matchedPackageId
    ).length;
  }, [filteredApps]);

  // Claim app handler
  const handleClaimApp = useCallback(async (app: UnmanagedApp) => {
    const accessToken = await getToken();
    if (!accessToken || !app.matchedPackageId) return;

    setClaimingAppId(app.discoveredAppId);

    try {
      const manifestResponse = await fetch(
        `/api/winget/manifest?id=${encodeURIComponent(app.matchedPackageId)}&arch=x64`
      );

      if (!manifestResponse.ok) {
        if (manifestResponse.status === 403) {
          throw new Error('Permission denied. Check your access permissions.');
        } else if (manifestResponse.status >= 500) {
          throw new Error('Server error. Please try again later.');
        }
        throw new Error('Failed to fetch package manifest');
      }

      const { recommendedInstaller, manifest } = await manifestResponse.json();

      if (!recommendedInstaller) {
        throw new Error('No compatible installer found for this package');
      }

      const detectionRules = generateDetectionRules(
        recommendedInstaller,
        manifest?.name || app.displayName,
        app.matchedPackageId,
        manifest?.version || app.version || ''
      );

      const processesToClose = getDefaultProcessesToClose(
        manifest?.name || app.displayName,
        recommendedInstaller.type
      );

      addItem({
        wingetId: app.matchedPackageId,
        displayName: manifest?.name || app.displayName,
        publisher: manifest?.publisher || app.publisher || '',
        version: manifest?.version || app.version || '',
        architecture: recommendedInstaller.architecture,
        installScope: recommendedInstaller.scope || 'machine',
        installerType: recommendedInstaller.type,
        installerUrl: recommendedInstaller.url,
        installerSha256: recommendedInstaller.sha256,
        installCommand: generateInstallCommand(
          recommendedInstaller,
          recommendedInstaller.scope || 'machine'
        ),
        uninstallCommand: generateUninstallCommand(
          recommendedInstaller,
          manifest?.name || app.displayName
        ),
        detectionRules,
        psadtConfig: {
          ...DEFAULT_PSADT_CONFIG,
          processesToClose,
          detectionRules,
        },
      });

      const claimResponse = await fetch('/api/intune/claim', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...mspHeaders,
        },
        body: JSON.stringify({
          discoveredAppId: app.discoveredAppId,
          discoveredAppName: app.displayName,
          wingetPackageId: app.matchedPackageId,
          deviceCount: app.deviceCount,
        }),
      });

      if (!claimResponse.ok) {
        const errorData = await claimResponse.json().catch(() => ({}));
        if (claimResponse.status === 403) {
          throw new Error('Permission denied. You may not have access to claim apps.');
        } else if (claimResponse.status >= 500) {
          throw new Error('Server error while recording claim. The app was added to your cart.');
        }
        throw new Error(errorData.error || 'Failed to record claim');
      }

      setApps((prev) =>
        prev.map((a) =>
          a.discoveredAppId === app.discoveredAppId
            ? { ...a, isClaimed: true, claimStatus: 'pending' }
            : a
        )
      );

      // Only close modal on success
      setClaimModalApp(null);
    } catch (error) {
      console.error('Error claiming app:', error);
      // Re-throw so the modal can display the error inline
      throw error;
    } finally {
      setClaimingAppId(null);
    }
  }, [getToken, addItem, mspHeaders]);

  // Claim single app (used by handleClaimAll)
  const claimSingleApp = useCallback(async (
    app: UnmanagedApp,
    accessToken: string
  ): Promise<{ app: UnmanagedApp; success: boolean }> => {
    try {
      const manifestResponse = await fetch(
        `/api/winget/manifest?id=${encodeURIComponent(app.matchedPackageId!)}&arch=x64`
      );

      if (!manifestResponse.ok) {
        return { app, success: false };
      }

      const { recommendedInstaller, manifest } = await manifestResponse.json();

      if (!recommendedInstaller) {
        return { app, success: false };
      }

      const detectionRules = generateDetectionRules(
        recommendedInstaller,
        manifest?.name || app.displayName,
        app.matchedPackageId!,
        manifest?.version || app.version || ''
      );

      const processesToClose = getDefaultProcessesToClose(
        manifest?.name || app.displayName,
        recommendedInstaller.type
      );

      addItemSilent({
        wingetId: app.matchedPackageId!,
        displayName: manifest?.name || app.displayName,
        publisher: manifest?.publisher || app.publisher || '',
        version: manifest?.version || app.version || '',
        architecture: recommendedInstaller.architecture,
        installScope: recommendedInstaller.scope || 'machine',
        installerType: recommendedInstaller.type,
        installerUrl: recommendedInstaller.url,
        installerSha256: recommendedInstaller.sha256,
        installCommand: generateInstallCommand(
          recommendedInstaller,
          recommendedInstaller.scope || 'machine'
        ),
        uninstallCommand: generateUninstallCommand(
          recommendedInstaller,
          manifest?.name || app.displayName
        ),
        detectionRules,
        psadtConfig: {
          ...DEFAULT_PSADT_CONFIG,
          processesToClose,
          detectionRules,
        },
      });

      const claimResponse = await fetch('/api/intune/claim', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...mspHeaders,
        },
        body: JSON.stringify({
          discoveredAppId: app.discoveredAppId,
          discoveredAppName: app.displayName,
          wingetPackageId: app.matchedPackageId,
          deviceCount: app.deviceCount,
        }),
      });

      if (!claimResponse.ok) {
        return { app, success: false };
      }

      return { app, success: true };
    } catch (error) {
      console.error(`Error claiming app ${app.displayName}:`, error);
      return { app, success: false };
    }
  }, [addItemSilent, mspHeaders]);

  // Claim All cancellation ref
  const claimAllCancelledRef = useRef(false);

  // Process claim all (called after confirmation)
  const processClaimAll = useCallback(async (appsToProcess: UnmanagedApp[]) => {
    const accessToken = await getToken();
    if (!accessToken) return;

    claimAllCancelledRef.current = false;

    // Merge new pending items with any existing results (preserves previous successes on retry)
    setClaimAllModal((prev) => {
      if (!prev) return null;
      const mergedResults = new Map(prev.results);
      appsToProcess.forEach((a) => mergedResults.set(a.discoveredAppId, 'pending'));
      return { ...prev, phase: 'processing', results: mergedResults };
    });

    const BATCH_SIZE = 5;
    const successfulAppIds: string[] = [];

    for (let i = 0; i < appsToProcess.length; i += BATCH_SIZE) {
      if (claimAllCancelledRef.current) {
        // Mark remaining unprocessed apps as 'failed' so they appear in "Retry Failed"
        setClaimAllModal((prev) => {
          if (!prev) return null;
          const updatedResults = new Map(prev.results);
          for (let j = i; j < appsToProcess.length; j++) {
            const appId = appsToProcess[j].discoveredAppId;
            if (updatedResults.get(appId) === 'pending') {
              updatedResults.set(appId, 'failed');
            }
          }
          return { ...prev, results: updatedResults, isComplete: true };
        });

        // Still update apps that succeeded before cancellation
        if (successfulAppIds.length > 0) {
          setApps((prev) =>
            prev.map((a) =>
              successfulAppIds.includes(a.discoveredAppId)
                ? { ...a, isClaimed: true, claimStatus: 'pending' }
                : a
            )
          );
        }
        return;
      }

      const batch = appsToProcess.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map((app) => claimSingleApp(app, accessToken))
      );

      setClaimAllModal((prev) => {
        if (!prev) return null;
        const updatedResults = new Map(prev.results);
        results.forEach((result, idx) => {
          const appId = batch[idx].discoveredAppId;
          if (result.status === 'fulfilled' && result.value.success) {
            updatedResults.set(appId, 'success');
            successfulAppIds.push(appId);
          } else {
            updatedResults.set(appId, 'failed');
          }
        });
        return { ...prev, results: updatedResults };
      });
    }

    setApps((prev) =>
      prev.map((a) =>
        successfulAppIds.includes(a.discoveredAppId)
          ? { ...a, isClaimed: true, claimStatus: 'pending' }
          : a
      )
    );

    setClaimAllModal((prev) => (prev ? { ...prev, isComplete: true } : null));
  }, [getToken, claimSingleApp]);

  // Cancel claim all - sets the ref so processClaimAll stops on next batch
  const cancelClaimAll = useCallback(() => {
    claimAllCancelledRef.current = true;
    // processClaimAll checks this ref at the top of each batch loop iteration
    // and will mark remaining pending items as 'failed' + set isComplete: true
  }, []);

  // Ref to hold latest claimAllModal for retryFailedClaims (avoids stale closure)
  const claimAllModalRef = useRef(claimAllModal);
  claimAllModalRef.current = claimAllModal;

  // Retry failed claims
  const retryFailedClaims = useCallback(async () => {
    const currentModal = claimAllModalRef.current;
    if (!currentModal) return;

    const failedApps = currentModal.apps.filter(
      (app) => currentModal.results.get(app.discoveredAppId) === 'failed'
    );

    if (failedApps.length === 0) return;

    setClaimAllModal((prev) =>
      prev ? { ...prev, isComplete: false } : null
    );

    await processClaimAll(failedApps);
  }, [processClaimAll]);

  // Claim all matched apps handler - opens confirmation first
  const handleClaimAll = useCallback(async () => {
    const claimableApps = filteredApps.filter(
      (app) => app.matchStatus === 'matched' && !app.isClaimed && app.matchedPackageId
    );

    if (claimableApps.length === 0) {
      toast({
        title: 'No apps to claim',
        description: 'All matched apps have already been claimed',
      });
      return;
    }

    // Open modal in confirmation phase
    setClaimAllModal({
      isOpen: true,
      phase: 'confirm',
      apps: claimableApps,
      results: new Map(),
      isComplete: false,
    });
  }, [filteredApps]);

  // Link package handler
  const handleLinkPackage = useCallback(async (app: UnmanagedApp, wingetPackageId: string) => {
    const accessToken = await getToken();
    if (!accessToken) return;

    try {
      const response = await fetch('/api/mappings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...mspHeaders,
        },
        body: JSON.stringify({
          discoveredAppName: app.displayName,
          discoveredPublisher: app.publisher,
          wingetPackageId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create mapping');
      }

      const responseData = await response.json();
      if (responseData.cacheWarning) {
        console.warn('Cache update warning:', responseData.cacheWarning);
      }

      setApps((prev) =>
        prev.map((a) =>
          a.discoveredAppId === app.discoveredAppId
            ? {
                ...a,
                matchStatus: 'matched' as MatchStatus,
                matchedPackageId: wingetPackageId,
                matchConfidence: 1.0,
              }
            : a
        )
      );

      toast({
        title: 'Package linked',
        description: `${app.displayName} has been linked to ${wingetPackageId}`,
      });
    } catch (error) {
      console.error('Error linking package:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to link package',
        variant: 'destructive',
      });
      throw error;
    }
  }, [getToken, mspHeaders]);

  const clearFilters = useCallback(() => {
    setFilters(defaultFilters);
  }, []);

  return {
    apps,
    filteredApps,
    statusCounts,
    computedStats,
    claimableCount,
    lastSynced,
    fromCache,
    isLoading,
    isRefreshing,
    filters,
    permissionError,
    viewMode,
    claimingAppId,
    claimModalApp,
    linkModalApp,
    claimAllModal,
    setFilters,
    setViewMode,
    setClaimModalApp,
    setLinkModalApp,
    setClaimAllModal,
    setPermissionError,
    handleRefresh,
    handleClaimApp,
    handleClaimAll,
    handleLinkPackage,
    processClaimAll,
    cancelClaimAll,
    retryFailedClaims,
    clearFilters,
  };
}
