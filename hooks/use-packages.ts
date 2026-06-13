'use client';

import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import type { NormalizedPackage, NormalizedInstaller, LocaleVariant, StoreManifestResponse } from '@/types/winget';
import type { ChangelogData } from '@/components/InstallationChangelog';

interface PopularPackagesResponse {
  packages: NormalizedPackage[];
  count: number;
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
}

interface SearchPackagesResponse {
  packages: NormalizedPackage[];
  count?: number;
}

interface ManifestResponse {
  installers: NormalizedInstaller[];
  recommendedInstaller?: NormalizedInstaller;
  versions?: string[];
}

interface Category {
  category: string;
  count: number;
}

interface CategoriesResponse {
  count: number;
  totalApps: number;
  categories: Category[];
}

interface ChangelogSummary {
  filesAdded: number;
  shortcutsCreated: number;
  servicesCreated: number;
  registryEntriesAdded: number;
  installedSizeMB: number | null;
}

interface ChangelogResponse {
  changelog: ChangelogData;
  summary: ChangelogSummary;
}

export function usePopularPackages(limit: number = 12, category?: string | null) {
  return useQuery<PopularPackagesResponse>({
    queryKey: ['packages', 'popular', limit, category],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: limit.toString() });
      if (category) params.append('category', category);
      const response = await fetch(`/api/winget/popular?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch popular packages');
      }
      return response.json();
    },
  });
}

interface InfinitePackagesResponse {
  packages: NormalizedPackage[];
  count: number;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export function useInfinitePackages(pageSize: number = 20, category?: string | null, sort?: string) {
  return useInfiniteQuery<InfinitePackagesResponse>({
    queryKey: ['packages', 'infinite', pageSize, category, sort],
    queryFn: async ({ pageParam = 0 }) => {
      const params = new URLSearchParams({
        limit: pageSize.toString(),
        offset: (pageParam as number).toString(),
      });
      if (category) params.append('category', category);
      if (sort) params.append('sort', sort);
      const response = await fetch(`/api/winget/popular?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch packages');
      }
      return response.json();
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasMore) {
        return undefined;
      }

      return lastPage.offset + lastPage.count;
    },
  });
}

export function usePackagesByCategory(category: string, limit: number = 10) {
  return useQuery<PopularPackagesResponse>({
    queryKey: ['packages', 'byCategory', category, limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
        category,
      });
      const response = await fetch(`/api/winget/popular?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch packages by category');
      }
      return response.json();
    },
    enabled: !!category,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSearchPackages(query: string, limit: number = 50, category?: string | null, sort?: string) {
  return useQuery<SearchPackagesResponse>({
    queryKey: ['packages', 'search', query, limit, category, sort],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: query,
        limit: limit.toString(),
      });
      if (category) params.append('category', category);
      if (sort) params.append('sort', sort);
      const response = await fetch(`/api/winget/search?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Search failed');
      }
      return response.json();
    },
    enabled: query.length >= 2,
  });
}

export function usePackageManifest(id: string, version?: string, arch?: string, skip?: boolean) {
  return useQuery<ManifestResponse>({
    queryKey: ['packages', 'manifest', id, version, arch],
    queryFn: async () => {
      const params = new URLSearchParams({ id });
      if (version) params.append('version', version);
      if (arch) params.append('arch', arch);

      const response = await fetch(`/api/winget/manifest?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch manifest');
      }
      return response.json();
    },
    enabled: !!id && !skip,
  });
}

export function useCategories() {
  return useQuery<CategoriesResponse>({
    queryKey: ['categories'],
    queryFn: async () => {
      const response = await fetch('/api/winget/categories');
      if (!response.ok) {
        throw new Error('Failed to fetch categories');
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

export function useInstallationChangelog(id: string, version?: string) {
  return useQuery<ChangelogResponse>({
    queryKey: ['changelog', id, version],
    queryFn: async () => {
      const params = new URLSearchParams({ id });
      if (version) params.append('version', version);
      const response = await fetch(`/api/winget/changelog?${params.toString()}`);
      if (!response.ok) {
        if (response.status === 404) {
          // Return null data for 404 (no changelog available)
          return { changelog: null, summary: null } as unknown as ChangelogResponse;
        }
        throw new Error('Failed to fetch changelog');
      }
      return response.json();
    },
    enabled: !!id,
    staleTime: 10 * 60 * 1000, // Cache for 10 minutes
  });
}

interface LocaleVariantsResponse {
  parentId: string;
  count: number;
  variants: LocaleVariant[];
}

export function useLocaleVariants(parentWingetId: string | null) {
  return useQuery<LocaleVariantsResponse>({
    queryKey: ['packages', 'variants', parentWingetId],
    queryFn: async () => {
      const response = await fetch(`/api/winget/variants?id=${encodeURIComponent(parentWingetId!)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch locale variants');
      }
      return response.json();
    },
    enabled: !!parentWingetId,
    staleTime: 5 * 60 * 1000,
  });
}

class FetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function useStoreManifest(packageIdentifier: string | undefined, skip?: boolean) {
  return useQuery<StoreManifestResponse>({
    queryKey: ['store', 'manifest', packageIdentifier],
    queryFn: async () => {
      const response = await fetch(`/api/store/manifest?id=${encodeURIComponent(packageIdentifier!)}`);
      if (!response.ok) {
        throw new FetchError('Failed to fetch store manifest', response.status);
      }
      return response.json();
    },
    enabled: !!packageIdentifier && !skip,
    staleTime: 30 * 60 * 1000,
    retry: (failureCount, error) => {
      if (error instanceof FetchError && error.status >= 400 && error.status < 500) return false;
      return failureCount < 2;
    },
  });
}
