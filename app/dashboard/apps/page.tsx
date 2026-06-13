'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { T, Var } from "gt-next";
import { useSearchParams } from 'next/navigation';
import {
  Package,
  Loader2,
  Search,
  Sparkles,
  LayoutGrid,
  ArrowUpDown,
  ArrowDownAZ,
  Clock,
  List,
  LayoutGrid as GridIcon,
  Tags,
  SlidersHorizontal,
  ChevronDown,
  ChevronRight,
  X,
  ListChecks,
  Check,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppSearch } from '@/components/AppSearch';
import { AppCard } from '@/components/AppCard';
import { AppListItem } from '@/components/AppListItem';
import { PackageConfig } from '@/components/PackageConfig';
import { CustomAppModal } from '@/components/CustomAppModal';
import { UploadCart } from '@/components/UploadCart';
import { FeaturedApps } from '@/components/FeaturedApps';
import { AppCollection } from '@/components/AppCollection';
import {
  usePopularPackages,
  useSearchPackages,
  usePackageManifest,
  useStoreManifest,
  useCategories,
  useInfinitePackages,
} from '@/hooks/use-packages';
import { useDeployedPackages } from '@/hooks/use-deployed-packages';
import { useDeployedConfig } from '@/hooks/use-deployed-config';
import { useBulkAdd } from '@/hooks/use-bulk-add';
import { useCartStore } from '@/stores/cart-store';
import type { NormalizedPackage } from '@/types/winget';
import { getCategoryLabel } from '@/lib/category-utils';
import { useUserSettings } from '@/components/providers/UserSettingsProvider';

const PREFERRED_COLLECTION_CATEGORIES = [
  'developer-tools',
  'development',
  'utilities',
  'productivity',
  'communication',
  'browsers',
  'browser',
  'security',
  'media',
  'graphics',
  'cloud-storage',
  'system',
  'gaming',
  'runtime',
  'virtualization',
];

const SORT_OPTIONS = [
  { key: 'popular', label: 'Popular', icon: ArrowUpDown },
  { key: 'name', label: 'A-Z', icon: ArrowDownAZ },
  { key: 'newest', label: 'Newest', icon: Clock },
] as const;

export default function AppCatalogPage() {
  const searchParams = useSearchParams();

  // Initialize state from URL params
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [selectedPackage, setSelectedPackage] = useState<NormalizedPackage | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(searchParams.get('category') || null);
  const validSorts = ['popular', 'name', 'newest'] as const;
  const sortParam = searchParams.get('sort');
  const [sortBy, setSortBy] = useState<'popular' | 'name' | 'newest'>(
    validSorts.includes(sortParam as typeof validSorts[number]) ? (sortParam as 'popular' | 'name' | 'newest') : 'popular'
  );
  const { settings: userSettings, setViewMode: persistViewMode } = useUserSettings();
  const [viewMode, setViewModeLocal] = useState<'grid' | 'list'>(userSettings.viewMode);
  const [mounted, setMounted] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [isSortSectionOpen, setIsSortSectionOpen] = useState(true);
  const [isCategoriesSectionOpen, setIsCategoriesSectionOpen] = useState(true);

  // Custom app modal state
  const [isCustomAppModalOpen, setIsCustomAppModalOpen] = useState(false);

  // Bulk selection state
  const [isBulkSelectMode, setIsBulkSelectMode] = useState(false);
  const [selectedPackageIds, setSelectedPackageIds] = useState<Set<string>>(new Set());
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null);
  const { bulkAdd } = useBulkAdd();

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const resultsSectionRef = useRef<HTMLElement>(null);
  const resultsContentRef = useRef<HTMLDivElement>(null);
  const mobileFilterRef = useRef<HTMLDivElement>(null);
  const mobileFilterTriggerRef = useRef<HTMLButtonElement>(null);
  const previousBrowseControlsRef = useRef({
    sortBy: 'popular' as 'popular' | 'name' | 'newest',
    selectedCategory: null as string | null,
    hasSearched: false,
  });

  const setViewMode = useCallback((mode: 'grid' | 'list') => {
    setViewModeLocal(mode);
    void persistViewMode(mode);
  }, [persistViewMode]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // URL persistence: sync state changes to URL params
  useEffect(() => {
    if (!mounted) return;
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (selectedCategory) params.set('category', selectedCategory);
    if (sortBy !== 'popular') params.set('sort', sortBy);
    const paramString = params.toString();
    const newUrl = paramString ? `?${paramString}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
  }, [mounted, searchQuery, selectedCategory, sortBy]);

  // Mobile filter: focus trap + escape handler
  useEffect(() => {
    if (!isMobileFiltersOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMobileFiltersOpen(false);
        mobileFilterTriggerRef.current?.focus();
      }
    };

    const handleFocusTrap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const panel = mobileFilterRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleEscape);
    document.addEventListener('keydown', handleFocusTrap);

    // Focus the first focusable element in the panel
    requestAnimationFrame(() => {
      const panel = mobileFilterRef.current;
      if (panel) {
        const first = panel.querySelector<HTMLElement>('button, [href], input');
        first?.focus();
      }
    });

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('keydown', handleFocusTrap);
    };
  }, [isMobileFiltersOpen]);

  // Bulk selection handlers
  const toggleBulkSelectMode = useCallback(() => {
    setIsBulkSelectMode((prev) => {
      if (prev) setSelectedPackageIds(new Set());
      return !prev;
    });
  }, []);

  const handleBulkToggle = useCallback((pkg: NormalizedPackage) => {
    setSelectedPackageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pkg.id)) {
        next.delete(pkg.id);
      } else {
        next.add(pkg.id);
      }
      return next;
    });
  }, []);

  const { data: categoriesData } = useCategories();
  const { data: featuredData, isLoading: isLoadingFeatured } = usePopularPackages(5, null);
  const { data: searchData, isLoading: isSearching, isFetching } = useSearchPackages(searchQuery, 50, selectedCategory, sortBy);

  const {
    data: infiniteData,
    isLoading: isLoadingInfinite,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfinitePackages(20, selectedCategory, sortBy);
  const { deployedSet } = useDeployedPackages();

  const isSelectedDeployed = selectedPackage ? deployedSet.has(selectedPackage.id) : false;
  const { deployedConfig, intuneAppId, isLoading: isLoadingDeployedConfig } = useDeployedConfig(
    isSelectedDeployed ? selectedPackage?.id ?? null : null
  );

  const isSelectedStoreApp = selectedPackage?.appSource === 'store';
  const { data: manifestData, isLoading: isLoadingInstallers } = usePackageManifest(
    selectedPackage?.id || '',
    selectedPackage?.version,
    undefined,
    isSelectedStoreApp // skip manifest fetch for store apps
  );
  const { data: storeManifestData, isLoading: isLoadingStoreManifest } = useStoreManifest(
    isSelectedStoreApp ? (selectedPackage?.packageIdentifier || selectedPackage?.id) : undefined,
    !isSelectedStoreApp
  );

  const hasSearched = searchQuery.length >= 2;
  const isBrowseMode = !hasSearched && selectedCategory === null;
  const featuredPackages = featuredData?.packages || [];
  const searchPackages = searchData?.packages || [];
  const allPackages = useMemo(() => {
    const pages = infiniteData?.pages || [];
    const seen = new Set<string>();
    const uniquePackages: NormalizedPackage[] = [];

    for (const page of pages) {
      for (const pkg of page.packages) {
        if (seen.has(pkg.id)) {
          continue;
        }

        seen.add(pkg.id);
        uniquePackages.push(pkg);
      }
    }

    return uniquePackages;
  }, [infiniteData?.pages]);
  const selectedInstallers = manifestData?.installers || [];
  const selectedVersions = manifestData?.versions || [];

  const showSearchResults = hasSearched;
  const showCategoryResults = !hasSearched && selectedCategory !== null;
  const activeSortLabel = SORT_OPTIONS.find((option) => option.key === sortBy)?.label || 'Popular';

  const showInitialLoading = hasSearched && isSearching && searchPackages.length === 0;
  const showEmptyState = hasSearched && !isSearching && !isFetching && searchPackages.length === 0;

  const loadedCount = showSearchResults ? searchPackages.length : allPackages.length;
  const activeCategoryLabel = selectedCategory ? getCategoryLabel(selectedCategory) : null;
  const collectionCategories = useMemo(() => {
    const available = categoriesData?.categories || [];
    if (available.length === 0) {
      return PREFERRED_COLLECTION_CATEGORIES.slice(0, 6);
    }

    const availableSet = new Set(available.map((cat) => cat.category));
    const preferredAvailable = PREFERRED_COLLECTION_CATEGORIES.filter((category) =>
      availableSet.has(category)
    );
    const byCount = [...available]
      .sort((a, b) => b.count - a.count)
      .map((cat) => cat.category);

    const merged = new Set<string>([...preferredAvailable, ...byCount]);
    return Array.from(merged).slice(0, 8);
  }, [categoriesData?.categories]);
  const totalAvailableCount = useMemo(() => {
    if (showSearchResults) {
      return searchData?.count ?? searchPackages.length;
    }

    const infiniteTotal = infiniteData?.pages?.[0]?.total;
    if (typeof infiniteTotal === 'number') {
      return infiniteTotal;
    }

    if (selectedCategory) {
      const categoryTotal = categoriesData?.categories.find((c) => c.category === selectedCategory)?.count;
      if (typeof categoryTotal === 'number') {
        return categoryTotal;
      }
    }

    return categoriesData?.totalApps ?? allPackages.length;
  }, [
    showSearchResults,
    searchData?.count,
    searchPackages.length,
    infiniteData?.pages,
    selectedCategory,
    categoriesData?.categories,
    categoriesData?.totalApps,
    allPackages.length,
  ]);

  // Bulk selection callbacks (depend on derived data above)
  const handleSelectAllVisible = useCallback(() => {
    const visiblePackages = showSearchResults ? searchPackages : allPackages;
    setSelectedPackageIds(new Set(visiblePackages.map((p) => p.id)));
  }, [showSearchResults, searchPackages, allPackages]);

  const handleClearBulkSelection = useCallback(() => {
    setSelectedPackageIds(new Set());
  }, []);

  const handleBulkQuickAdd = useCallback(async () => {
    const visiblePackages = showSearchResults ? searchPackages : allPackages;
    const cartItems = useCartStore.getState().items;
    const cartIds = new Set(cartItems.map((item) => `${item.wingetId}@${item.version}`));
    const selected = visiblePackages
      .filter((p) => selectedPackageIds.has(p.id))
      .filter((p) => !cartIds.has(`${p.id}@${p.version}`));
    if (selected.length === 0) {
      toast.info('All selected apps are already in the cart');
      return;
    }

    setIsBulkAdding(true);
    setBulkProgress({ completed: 0, total: selected.length });

    const result = await bulkAdd(selected, (progress) => {
      setBulkProgress({ completed: progress.completed, total: progress.total });
    });

    setIsBulkAdding(false);
    setBulkProgress(null);

    if (result.failed.length === 0) {
      toast.success(`Added ${result.succeeded.length} app${result.succeeded.length !== 1 ? 's' : ''} to selection`);
    } else {
      toast.warning(
        `Added ${result.succeeded.length} of ${selected.length} apps`,
        { description: `${result.failed.length} failed: ${result.failed.map((f) => f.name).join(', ')}` }
      );
    }

    setIsBulkSelectMode(false);
    setSelectedPackageIds(new Set());
  }, [showSearchResults, searchPackages, allPackages, selectedPackageIds, bulkAdd]);

  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    const [target] = entries;
    if (target.isIntersecting && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(handleObserver, {
      root: null,
      rootMargin: '120px',
      threshold: 0.1,
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [handleObserver]);

  useEffect(() => {
    const previousState = previousBrowseControlsRef.current;
    const controlsChanged =
      previousState.sortBy !== sortBy ||
      previousState.selectedCategory !== selectedCategory ||
      previousState.hasSearched !== hasSearched;

    previousBrowseControlsRef.current = { sortBy, selectedCategory, hasSearched };

    if (!mounted || !controlsChanged || selectedPackage) {
      return;
    }

    const target = resultsContentRef.current || resultsSectionRef.current;
    if (!target) {
      return;
    }

    const stickyOffset = 176;
    const targetTop = target.getBoundingClientRect().top + window.scrollY - stickyOffset;
    window.scrollTo({ top: Math.max(targetTop, 0), behavior: 'smooth' });
  }, [hasSearched, mounted, selectedCategory, selectedPackage, sortBy]);

  const handleSelectPackage = (pkg: NormalizedPackage) => {
    setSelectedPackage(pkg);
  };

  const handleCloseConfig = () => {
    setSelectedPackage(null);
  };

  const handleSeeAll = (category: string) => {
    setSelectedCategory(category);
  };

  const handleCategoryChange = (category: string | null) => {
    setSelectedCategory(category);
    setIsMobileFiltersOpen(false);
  };

  const handleSortChange = (sort: 'popular' | 'name' | 'newest') => {
    setSortBy(sort);
    setIsMobileFiltersOpen(false);
  };

  const resetFilters = () => {
    setSelectedCategory(null);
    setSortBy('popular');
  };

  const renderLoadingSkeletons = () => (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="rounded-xl border border-overlay/10 bg-bg-elevated p-5">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-lg bg-bg-surface animate-shimmer" />
            <div className="flex-1">
              <div className="h-5 bg-bg-surface rounded w-32 mb-2 animate-shimmer" />
              <div className="h-4 bg-bg-surface rounded w-24 mb-3 animate-shimmer" />
              <div className="h-4 bg-bg-surface rounded w-full animate-shimmer" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  const renderFilterPanel = () => (
    <div className="rounded-2xl border border-overlay/10 bg-bg-elevated p-4 shadow-soft space-y-4">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-accent-cyan" />
          <h3 className="text-sm font-semibold tracking-wide text-text-primary uppercase"><T>Filters</T></h3>
        </div>
        {(selectedCategory !== null || sortBy !== 'popular') && (
          <button
            onClick={resetFilters}
            className="text-xs font-medium text-text-secondary hover:text-text-primary transition-colors"
          >
            <T>Reset</T>
          </button>
        )}
      </div>

      <div className="border-t border-overlay/10 pt-3 space-y-2">
        <button
          onClick={() => setIsSortSectionOpen((prev) => !prev)}
          className="w-full flex items-center justify-between text-sm font-medium text-text-primary"
        >
          <span><T>Sort</T></span>
          {isSortSectionOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {isSortSectionOpen && (
          <div className="space-y-1">
            {SORT_OPTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => handleSortChange(key)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  sortBy === key
                    ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/25'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface border border-transparent'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <Icon className="w-4 h-4" />
                  {label}
                </span>
                {sortBy === key && <span className="text-[11px] font-semibold uppercase tracking-wide"><T>Active</T></span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-overlay/10 pt-3 space-y-2">
        <button
          onClick={() => setIsCategoriesSectionOpen((prev) => !prev)}
          className="w-full flex items-center justify-between text-sm font-medium text-text-primary"
        >
          <span><T>Categories</T></span>
          {isCategoriesSectionOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        {isCategoriesSectionOpen && (
          <div className="max-h-[380px] overflow-y-auto pr-1 space-y-1">
            <button
              onClick={() => handleCategoryChange(null)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                selectedCategory === null
                  ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/25'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface border border-transparent'
              }`}
            >
              <span><T>All</T></span>
              <span className="text-xs">{categoriesData?.totalApps ?? 0}</span>
            </button>

            {(categoriesData?.categories || []).map((cat) => (
              <button
                key={cat.category}
                onClick={() => handleCategoryChange(cat.category)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedCategory === cat.category
                    ? 'bg-accent-cyan/10 text-accent-cyan border border-accent-cyan/25'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface border border-transparent'
                }`}
              >
                <span>{getCategoryLabel(cat.category)}</span>
                <span className="text-xs">{cat.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderPackages = (packages: NormalizedPackage[], keyPrefix: string) => {
    if (viewMode === 'grid') {
      return (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {packages.map((pkg, index) => (
            <div
              key={`${keyPrefix}-${pkg.id}-${index}`}
              className={mounted ? 'animate-fade-up' : 'opacity-0'}
              style={{ animationDelay: `${Math.min(index * 30, 220)}ms` }}
            >
              <AppCard
                package={pkg}
                onSelect={handleSelectPackage}
                isDeployed={deployedSet.has(pkg.id)}
                isBulkSelectMode={isBulkSelectMode}
                isBulkSelected={selectedPackageIds.has(pkg.id)}
                onBulkToggle={handleBulkToggle}
              />
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {packages.map((pkg, index) => (
          <div
            key={`${keyPrefix}-${pkg.id}-${index}`}
            className={mounted ? 'animate-fade-up' : 'opacity-0'}
            style={{ animationDelay: `${Math.min(index * 24, 180)}ms` }}
          >
            <AppListItem
              package={pkg}
              onSelect={handleSelectPackage}
              isDeployed={deployedSet.has(pkg.id)}
              isBulkSelectMode={isBulkSelectMode}
              isBulkSelected={selectedPackageIds.has(pkg.id)}
              onBulkToggle={handleBulkToggle}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-4">
      <div className={mounted ? 'animate-fade-up stagger-1' : 'opacity-0'}>
        <section className="relative overflow-hidden rounded-2xl border border-overlay/10 bg-bg-elevated/95 shadow-soft-md p-6 md:p-8">
          <div className="absolute inset-0 pointer-events-none bg-gradient-radial-cyan opacity-60" />
          <div className="absolute right-0 top-0 h-28 w-28 md:h-40 md:w-40 bg-gradient-to-bl from-accent-violet/10 via-accent-cyan/5 to-transparent blur-2xl" />

          <div className="relative">
            <h1 className="text-display-sm text-text-primary"><T>App Catalog</T></h1>
            <p className="text-text-secondary mt-2 max-w-2xl">
              <T>Curated Winget packages optimized for quick Intune deployment and predictable packaging workflows.</T>
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-overlay/10 bg-bg-surface px-3 py-1.5 text-sm text-text-secondary">
                <Package className="w-4 h-4 text-accent-cyan" />
                <span className="font-medium text-text-primary">{categoriesData?.totalApps?.toLocaleString() || '...'}</span>
                <T>packages</T>
              </span>
              {activeCategoryLabel && !hasSearched && (
                <span className="inline-flex items-center gap-2 rounded-full border border-overlay/10 bg-bg-surface px-3 py-1.5 text-sm text-text-secondary">
                  <Tags className="w-4 h-4 text-accent-violet" />
                  {activeCategoryLabel}
                </span>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className={mounted ? 'animate-fade-up stagger-2' : 'opacity-0'}>
        <section className="sticky top-[4.5rem] z-20 -mx-1 px-1">
          <div className="rounded-2xl border border-overlay/10 bg-bg-elevated/95 backdrop-blur-md shadow-soft-lg p-3 md:p-4 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex-1 min-w-0">
                <AppSearch value={searchQuery} onChange={setSearchQuery} isLoading={isFetching} />
              </div>

              <div className="flex items-center gap-2 self-end lg:self-auto">
                <button
                  ref={mobileFilterTriggerRef}
                  onClick={() => setIsMobileFiltersOpen(true)}
                  className="lg:hidden inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-overlay/10 bg-bg-surface text-sm text-text-secondary hover:text-text-primary hover:bg-overlay/5 transition-colors"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                  <T>Filters</T>
                </button>

                {/* Bulk select toggle */}
                <button
                  onClick={toggleBulkSelectMode}
                  aria-pressed={isBulkSelectMode}
                  aria-label={isBulkSelectMode ? 'Exit selection mode' : 'Enter selection mode'}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                    isBulkSelectMode
                      ? 'border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan'
                      : 'border-overlay/10 bg-bg-surface text-text-secondary hover:text-text-primary hover:bg-overlay/5'
                  }`}
                >
                  <ListChecks className="w-4 h-4" />
                  <span className="hidden sm:inline">{isBulkSelectMode ? <T>Cancel</T> : <T>Select</T>}</span>
                </button>

                {/* Custom app via installer URL */}
                <button
                  onClick={() => setIsCustomAppModalOpen(true)}
                  aria-label="Add custom app"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-overlay/10 bg-bg-surface text-sm text-text-secondary hover:text-text-primary hover:bg-overlay/5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline"><T>Custom app</T></span>
                </button>

                <div className="inline-flex items-center rounded-lg border border-overlay/10 bg-bg-surface p-0.5" role="group" aria-label="View mode">
                  <button
                    onClick={() => setViewMode('grid')}
                    aria-pressed={viewMode === 'grid'}
                    aria-label="Grid view"
                    className={`p-1.5 rounded-md transition-colors ${
                      viewMode === 'grid'
                        ? 'bg-bg-elevated text-text-primary shadow-soft'
                        : 'text-text-secondary hover:text-text-primary hover:bg-overlay/5'
                    }`}
                  >
                    <GridIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    aria-pressed={viewMode === 'list'}
                    aria-label="List view"
                    className={`p-1.5 rounded-md transition-colors ${
                      viewMode === 'list'
                        ? 'bg-bg-elevated text-text-primary shadow-soft'
                        : 'text-text-secondary hover:text-text-primary hover:bg-overlay/5'
                    }`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-lg border border-overlay/10 bg-bg-surface px-3 py-1.5 text-sm text-text-secondary">
                {showSearchResults ? (
                  <Search className="w-4 h-4 text-accent-cyan" />
                ) : showCategoryResults ? (
                  <Tags className="w-4 h-4 text-accent-violet" />
                ) : (
                  <LayoutGrid className="w-4 h-4 text-accent-cyan" />
                )}
                {showSearchResults ? (
                  <>
                    <span className="font-medium text-text-primary">{searchPackages.length}</span>
                    <T>result{searchPackages.length !== 1 ? 's' : ''} for</T> &ldquo;{searchQuery}&rdquo;
                  </>
                ) : showCategoryResults ? (
                  <>
                    <T>Category:</T>
                    <span className="font-medium text-text-primary">{activeCategoryLabel}</span>
                  </>
                ) : (
                  <>
                    <T>Sorting</T> <span className="font-medium text-text-primary">{activeSortLabel}</span>
                    <T>across all packages</T>
                  </>
                )}
              </span>

              {!showSearchResults && (
                <span className="hidden lg:inline-flex items-center gap-2 rounded-lg border border-overlay/10 bg-bg-surface px-3 py-1.5 text-sm text-text-secondary">
                  <ArrowUpDown className="w-4 h-4 text-accent-cyan" />
                  <T>Sort</T> <span className="font-medium text-text-primary">{activeSortLabel}</span>
                </span>
              )}

              {!showSearchResults && (
                <span className="inline-flex items-center gap-2 rounded-lg border border-overlay/10 bg-bg-surface px-3 py-1.5 text-sm text-text-secondary">
                  <Package className="w-4 h-4 text-accent-cyan" />
                  <T>Showing</T> <span className="font-medium text-text-primary">{loadedCount}</span> <T>of</T>{' '}
                  <span className="font-medium text-text-primary">{totalAvailableCount}</span>
                </span>
              )}
            </div>
          </div>
        </section>
      </div>

      {showInitialLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Loader2 className="w-10 h-10 text-accent-cyan animate-spin mx-auto mb-4" />
            <p className="text-text-secondary"><T>Searching packages...</T></p>
          </div>
        </div>
      ) : showEmptyState ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-sm">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-bg-surface flex items-center justify-center border border-overlay/10">
              <Search className="w-10 h-10 text-text-muted" />
            </div>
            <h3 className="text-text-primary font-semibold text-lg mb-2">
              <T>No packages matching</T> &ldquo;{searchQuery}&rdquo;
            </h3>
            <p className="text-text-secondary text-sm mb-6">
              <T>Check your spelling or try a broader term. You can also browse categories to discover apps.</T>
            </p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => setSearchQuery('')}
                className="px-4 py-2 text-sm font-medium text-text-primary bg-bg-elevated hover:bg-overlay/5 rounded-lg border border-overlay/10 transition-colors"
              >
                <T>Clear Search</T>
              </button>
              <button
                onClick={() => { setSearchQuery(''); setSelectedCategory(null); }}
                className="px-4 py-2 text-sm font-medium text-white bg-accent-cyan hover:bg-accent-cyan-dim rounded-lg border-0 transition-colors"
              >
                <T>Browse All</T>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="hidden lg:block lg:sticky lg:top-[5.25rem] self-start">
              {renderFilterPanel()}
            </aside>

            <div className="space-y-10">
              <section ref={resultsSectionRef} className="space-y-4">
                {/* Category breadcrumb */}
                {showCategoryResults && (
                  <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
                    <button
                      onClick={() => setSelectedCategory(null)}
                      className="text-text-secondary hover:text-accent-cyan transition-colors"
                    >
                      <T>App Catalog</T>
                    </button>
                    <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-text-primary font-medium">{activeCategoryLabel}</span>
                  </nav>
                )}

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {showSearchResults ? (
                      <Search className="w-5 h-5 text-accent-cyan" />
                    ) : showCategoryResults ? (
                      <Tags className="w-5 h-5 text-accent-violet" />
                    ) : (
                      <LayoutGrid className="w-5 h-5 text-accent-violet" />
                    )}

                    <h2 className="text-xl font-bold tracking-tight text-text-primary">
                      {showSearchResults
                        ? <T>Search Results</T>
                        : showCategoryResults
                        ? activeCategoryLabel
                        : <T>All Apps</T>}
                    </h2>
                  </div>
                  {!showSearchResults && (
                    <p className="text-sm text-text-secondary">
                      <T>Sorted by</T> <span className="font-medium text-text-primary">{activeSortLabel}</span>
                    </p>
                  )}
                </div>

                {showSearchResults ? (
                  <div ref={resultsContentRef} className="scroll-mt-44">
                    {renderPackages(searchPackages, 'search')}
                  </div>
                ) : isLoadingInfinite && allPackages.length === 0 ? (
                  <div ref={resultsContentRef} className="scroll-mt-44">
                    {renderLoadingSkeletons()}
                  </div>
                ) : (
                  <>
                    <div ref={resultsContentRef} className="scroll-mt-44">
                      {renderPackages(allPackages, showCategoryResults ? 'category' : 'browse')}
                    </div>
                    <div ref={loadMoreRef} className="h-20 flex items-center justify-center mt-4" role="status" aria-live="polite">
                      {isFetchingNextPage && (
                        <div className="flex items-center gap-3 text-text-secondary">
                          <Loader2 className="w-5 h-5 animate-spin text-accent-cyan" />
                          <span className="text-sm"><T>Loading more apps...</T></span>
                        </div>
                      )}
                      {!hasNextPage && allPackages.length > 0 && (
                        <p className="text-text-muted text-sm"><T>You&apos;ve seen all the apps</T></p>
                      )}
                    </div>
                  </>
                )}
              </section>

              {isBrowseMode && (
                <section className={mounted ? 'animate-fade-up stagger-4 space-y-8' : 'space-y-8 opacity-0'}>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-accent-cyan" />
                    <h2 className="text-xl font-bold tracking-tight text-text-primary"><T>Discover</T></h2>
                  </div>

                  <div className="space-y-8">
                    <div className="space-y-4">
                      <h3 className="text-sm font-medium uppercase tracking-wide text-text-muted"><T>Featured</T></h3>
                      <FeaturedApps
                        packages={featuredPackages}
                        onSelect={handleSelectPackage}
                        isLoading={isLoadingFeatured}
                        deployedSet={deployedSet}
                      />
                    </div>

                    <div className="space-y-8">
                      {collectionCategories.map((category) => (
                        <AppCollection
                          key={category}
                          category={category}
                          onSelect={handleSelectPackage}
                          onSeeAll={handleSeeAll}
                          deployedSet={deployedSet}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </div>
          </div>

          {isMobileFiltersOpen && (
            <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-labelledby="mobile-filters-title">
              <button
                aria-label="Close filters"
                className="absolute inset-0 bg-black/45 backdrop-blur-sm"
                onClick={() => {
                  setIsMobileFiltersOpen(false);
                  mobileFilterTriggerRef.current?.focus();
                }}
              />
              <div ref={mobileFilterRef} className="absolute left-0 top-0 bottom-0 w-[86%] max-w-sm bg-bg-base border-r border-overlay/10 shadow-2xl flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-overlay/10">
                  <h3 id="mobile-filters-title" className="text-sm font-semibold uppercase tracking-wide text-text-primary"><T>Filters</T></h3>
                  <button
                    onClick={() => {
                      setIsMobileFiltersOpen(false);
                      mobileFilterTriggerRef.current?.focus();
                    }}
                    aria-label="Close filters"
                    className="p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-overlay/5"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="p-4 overflow-y-auto">
                  {renderFilterPanel()}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {isCustomAppModalOpen && (
        <CustomAppModal onClose={() => setIsCustomAppModalOpen(false)} />
      )}

      {selectedPackage && ((isSelectedStoreApp && !isLoadingStoreManifest) || (!isSelectedStoreApp && !isLoadingInstallers && selectedInstallers.length > 0)) && !(isSelectedDeployed && isLoadingDeployedConfig) && (
        <PackageConfig
          package={selectedPackage}
          installers={selectedInstallers}
          versions={selectedVersions}
          onClose={handleCloseConfig}
          isDeployed={isSelectedDeployed}
          deployedConfig={deployedConfig}
          intuneAppId={intuneAppId}
          storeManifest={storeManifestData}
        />
      )}

      {selectedPackage && ((isSelectedStoreApp && isLoadingStoreManifest) || (!isSelectedStoreApp && isLoadingInstallers) || (isSelectedDeployed && isLoadingDeployedConfig)) && (
        <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-label="Loading package details">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleCloseConfig} aria-hidden="true" />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-bg-surface border-l border-overlay/5 shadow-2xl flex items-center justify-center animate-slide-in-right">
            <div className="text-center">
              <div className="relative">
                <Loader2 className="w-10 h-10 text-accent-cyan animate-spin mx-auto mb-4" />
                <div className="absolute inset-0 w-10 h-10 mx-auto blur-xl bg-accent-cyan/30 animate-pulse-glow" />
              </div>
              <p className="text-text-secondary"><T>Loading package details...</T></p>
            </div>
          </div>
        </div>
      )}

      {selectedPackage && !isSelectedStoreApp && !isLoadingInstallers && selectedInstallers.length === 0 && (
        <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true" aria-label="No installers found">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleCloseConfig} aria-hidden="true" />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-bg-surface border-l border-overlay/5 shadow-2xl flex items-center justify-center animate-slide-in-right">
            <div className="text-center px-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-status-error/10 flex items-center justify-center">
                <Package className="w-8 h-8 text-status-error" />
              </div>
              <h3 className="text-text-primary font-medium mb-2"><T>No installers found</T></h3>
              <p className="text-text-secondary text-sm mb-4">
                <T>Unable to find installer information for this package version.</T>
              </p>
              <button
                onClick={handleCloseConfig}
                className="px-4 py-2 bg-bg-elevated hover:bg-overlay/10 text-text-primary rounded-lg transition-colors"
              >
                <T>Close</T>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating bulk action bar */}
      {isBulkSelectMode && selectedPackageIds.size > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 rounded-2xl bg-bg-elevated/95 backdrop-blur-md border border-overlay/10 shadow-2xl">
          <span className="text-sm font-medium text-text-primary whitespace-nowrap">
            {selectedPackageIds.size} <T>selected</T>
          </span>
          <div className="w-px h-5 bg-overlay/10" />
          <button
            onClick={handleSelectAllVisible}
            className="text-sm text-text-secondary hover:text-accent-cyan transition-colors whitespace-nowrap"
          >
            <T>Select All</T>
          </button>
          <button
            onClick={handleClearBulkSelection}
            className="text-sm text-text-secondary hover:text-text-primary transition-colors whitespace-nowrap"
          >
            <T>Clear</T>
          </button>
          <div className="w-px h-5 bg-overlay/10" />
          <button
            onClick={handleBulkQuickAdd}
            disabled={isBulkAdding}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-accent-cyan hover:bg-accent-cyan-dim text-white text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {isBulkAdding && bulkProgress ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <T>Adding <Var>{bulkProgress.completed}</Var>/<Var>{bulkProgress.total}</Var>...</T>
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <T>Quick Add All</T>
              </>
            )}
          </button>
        </div>
      )}

      <UploadCart />
    </div>
  );
}
