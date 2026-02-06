'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
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
import type { ClaimAllModalState, ClaimStatus } from '@/components/unmanaged';

type ViewMode = 'grid' | 'list';

const defaultFilters: UnmanagedAppsFilters = {
  search: '',
  matchStatus: 'all',
  platform: 'all',
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
  const addItem = useCartStore((state) => state.addItem);
  const addItemSilent = useCartStore((state) => state.addItemSilent);
  const cartItems = useCartStore((state) => state.items);
  const tokenRef = useRef<string | null>(null);

  // Data state
  const [apps, setApps] = useState<UnmanagedApp[]>([]);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [filters, setFilters] = useState<UnmanagedAppsFilters>(defaultFilters);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

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
        headers: { Authorization: `Bearer ${accessToken}` },
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
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to fetch unmanaged apps from Intune',
        variant: 'destructive',
      });
    }
  }, [getToken]);

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

  // Non-Microsoft apps (base filtering)
  const nonMicrosoftApps = useMemo(() => {
    return apps.filter(app => !isMicrosoftApp(app));
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
    setClaimModalApp(null);

    try {
      const manifestResponse = await fetch(
        `/api/winget/manifest?id=${encodeURIComponent(app.matchedPackageId)}&arch=x64`
      );

      if (!manifestResponse.ok) {
        throw new Error('Failed to fetch package manifest');
      }

      const { recommendedInstaller, manifest } = await manifestResponse.json();

      if (!recommendedInstaller) {
        throw new Error('No compatible installer found');
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
        throw new Error(errorData.error || 'Failed to record claim');
      }

      setApps((prev) =>
        prev.map((a) =>
          a.discoveredAppId === app.discoveredAppId
            ? { ...a, isClaimed: true, claimStatus: 'pending' }
            : a
        )
      );
    } catch (error) {
      console.error('Error claiming app:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to claim app',
        variant: 'destructive',
      });
    } finally {
      setClaimingAppId(null);
    }
  }, [getToken, addItem]);

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
  }, [addItemSilent]);

  // Claim all matched apps handler
  const handleClaimAll = useCallback(async () => {
    const accessToken = await getToken();
    if (!accessToken) return;

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

    const resultsMap = new Map<string, ClaimStatus>(
      claimableApps.map((a) => [a.discoveredAppId, 'pending'])
    );
    setClaimAllModal({
      isOpen: true,
      apps: claimableApps,
      results: resultsMap,
      isComplete: false,
    });

    const BATCH_SIZE = 5;
    const successfulAppIds: string[] = [];

    for (let i = 0; i < claimableApps.length; i += BATCH_SIZE) {
      const batch = claimableApps.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map((app) => claimSingleApp(app, accessToken))
      );

      results.forEach((result, idx) => {
        const appId = batch[idx].discoveredAppId;
        if (result.status === 'fulfilled' && result.value.success) {
          resultsMap.set(appId, 'success');
          successfulAppIds.push(appId);
        } else {
          resultsMap.set(appId, 'failed');
        }
      });

      setClaimAllModal((prev) =>
        prev ? { ...prev, results: new Map(resultsMap) } : null
      );
    }

    setApps((prev) =>
      prev.map((a) =>
        successfulAppIds.includes(a.discoveredAppId)
          ? { ...a, isClaimed: true, claimStatus: 'pending' }
          : a
      )
    );

    setClaimAllModal((prev) => (prev ? { ...prev, isComplete: true } : null));
  }, [getToken, filteredApps, claimSingleApp]);

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
  }, [getToken]);

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
    clearFilters,
  };
}
