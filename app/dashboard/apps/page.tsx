'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Package, Loader2, Search, Sparkles, Grid, LayoutGrid } from 'lucide-react';
import { AppSearch } from '@/components/AppSearch';
import { AppCard } from '@/components/AppCard';
import { PackageConfig } from '@/components/PackageConfig';
import { UploadCart } from '@/components/UploadCart';
import { CategoryFilter } from '@/components/CategoryFilter';
import { FeaturedApps } from '@/components/FeaturedApps';
import { AppCollection } from '@/components/AppCollection';
import {
  usePopularPackages,
  useSearchPackages,
  usePackageManifest,
  useCategories,
  useInfinitePackages,
} from '@/hooks/use-packages';
import type { NormalizedPackage } from '@/types/winget';

// Categories to show as horizontal collections
const COLLECTION_CATEGORIES = ['browser', 'development', 'productivity', 'utilities', 'communication'];

export default function AppCatalogPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<NormalizedPackage | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // React Query hooks for data fetching with caching
  const { data: categoriesData, isLoading: isLoadingCategories } = useCategories();
  const { data: featuredData, isLoading: isLoadingFeatured } = usePopularPackages(5, null);
  const { data: searchData, isLoading: isSearching, isFetching } = useSearchPackages(searchQuery, 50, selectedCategory);

  // Infinite scroll for all apps when no search and no specific category filter or when category is selected
  const {
    data: infiniteData,
    isLoading: isLoadingInfinite,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useInfinitePackages(20, selectedCategory);

  // Fetch manifest when a package is selected
  const { data: manifestData, isLoading: isLoadingInstallers } = usePackageManifest(
    selectedPackage?.id || '',
    selectedPackage?.version
  );

  const hasSearched = searchQuery.length >= 2;
  const featuredPackages = featuredData?.packages || [];
  const searchPackages = searchData?.packages || [];
  const allPackages = infiniteData?.pages.flatMap(page => page.packages) || [];
  const selectedInstallers = manifestData?.installers || [];

  // Intersection Observer for infinite scroll
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
      rootMargin: '100px',
      threshold: 0.1,
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, [handleObserver]);

  // Only show full loading state when we have no data to display at all
  const showInitialLoading = hasSearched && isSearching && searchPackages.length === 0;
  const showEmptyState = hasSearched && !isSearching && !isFetching && searchPackages.length === 0;

  const handleSelectPackage = (pkg: NormalizedPackage) => {
    setSelectedPackage(pkg);
  };

  const handleCloseConfig = () => {
    setSelectedPackage(null);
  };

  const handleSeeAll = (category: string) => {
    setSelectedCategory(category);
  };

  // Show different layouts based on state
  const showBrowseMode = !hasSearched && selectedCategory === null;
  const showSearchResults = hasSearched;
  const showCategoryResults = !hasSearched && selectedCategory !== null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={mounted ? 'animate-fade-up stagger-1' : 'opacity-0'}>
        <h1 className="text-display-sm text-white">App Catalog</h1>
        <p className="text-zinc-400 mt-2">
          Browse and deploy from <span className="text-accent-cyan">10,000+</span> Winget packages
        </p>
      </div>

      {/* Search */}
      <div className={mounted ? 'animate-fade-up stagger-2' : 'opacity-0'}>
        <AppSearch value={searchQuery} onChange={setSearchQuery} isLoading={isFetching} />
      </div>

      {/* Category Filter - sticky */}
      <div className={mounted ? 'animate-fade-up stagger-3' : 'opacity-0'}>
        <CategoryFilter
          categories={categoriesData?.categories || []}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          isLoading={isLoadingCategories}
        />
      </div>

      {/* Content */}
      {showInitialLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="relative">
              <Loader2 className="w-10 h-10 text-accent-cyan animate-spin mx-auto mb-4" />
              <div className="absolute inset-0 w-10 h-10 mx-auto blur-xl bg-accent-cyan/30 animate-pulse-glow" />
            </div>
            <p className="text-zinc-400">Searching packages...</p>
          </div>
        </div>
      ) : showEmptyState ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-bg-elevated flex items-center justify-center animate-float-slow">
              <Search className="w-8 h-8 text-zinc-600" />
            </div>
            <h3 className="text-white font-medium mb-1">No packages found</h3>
            <p className="text-zinc-400 text-sm">
              Try a different search term or browse popular packages
            </p>
          </div>
        </div>
      ) : showSearchResults ? (
        // Search results view
        <>
          <div className={`flex items-center gap-2 text-zinc-400 ${mounted ? 'animate-fade-up stagger-4' : 'opacity-0'}`}>
            <Package className="w-4 h-4 text-accent-cyan" />
            <span className="text-sm">
              <span className="text-accent-cyan font-medium">{searchPackages.length}</span> package{searchPackages.length !== 1 ? 's' : ''} found
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {searchPackages.map((pkg, index) => (
              <div
                key={pkg.id}
                className={mounted ? 'animate-fade-up' : 'opacity-0'}
                style={{ animationDelay: `${Math.min(index * 50, 300)}ms` }}
              >
                <AppCard
                  package={pkg}
                  onSelect={handleSelectPackage}
                />
              </div>
            ))}
          </div>
        </>
      ) : showCategoryResults ? (
        // Category filter results with infinite scroll
        <>
          <div className={`flex items-center gap-2 text-zinc-400 ${mounted ? 'animate-fade-up stagger-4' : 'opacity-0'}`}>
            <Grid className="w-4 h-4 text-accent-violet" />
            <span className="text-sm">
              <span className="text-accent-violet font-medium">{allPackages.length}</span> apps in category
            </span>
          </div>

          {isLoadingInfinite ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="glass-dark rounded-xl p-5">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 rounded-lg bg-bg-elevated animate-shimmer" />
                    <div className="flex-1">
                      <div className="h-5 bg-bg-elevated rounded w-32 mb-2 animate-shimmer" />
                      <div className="h-4 bg-bg-elevated rounded w-24 mb-3 animate-shimmer" />
                      <div className="h-4 bg-bg-elevated rounded w-full animate-shimmer" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {allPackages.map((pkg, index) => (
                  <div
                    key={`${pkg.id}-${index}`}
                    className={mounted ? 'animate-fade-up' : 'opacity-0'}
                    style={{ animationDelay: `${Math.min(index * 30, 200)}ms` }}
                  >
                    <AppCard
                      package={pkg}
                      onSelect={handleSelectPackage}
                    />
                  </div>
                ))}
              </div>

              {/* Infinite scroll trigger */}
              <div ref={loadMoreRef} className="h-20 flex items-center justify-center">
                {isFetchingNextPage && (
                  <div className="flex items-center gap-3 text-zinc-400">
                    <Loader2 className="w-5 h-5 animate-spin text-accent-cyan" />
                    <span className="text-sm">Loading more apps...</span>
                  </div>
                )}
                {!hasNextPage && allPackages.length > 0 && (
                  <p className="text-zinc-600 text-sm">You've seen all the apps</p>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        // Browse mode - Featured + Collections + All Apps
        <div className="space-y-10">
          {/* Featured Section */}
          <section className={mounted ? 'animate-fade-up stagger-4' : 'opacity-0'}>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-accent-cyan" />
              <h2 className="text-lg font-semibold text-white">Featured</h2>
            </div>
            <FeaturedApps
              packages={featuredPackages}
              onSelect={handleSelectPackage}
              isLoading={isLoadingFeatured}
            />
          </section>

          {/* Category Collections */}
          <section className={mounted ? 'animate-fade-up stagger-5' : 'opacity-0'}>
            <div className="space-y-8">
              {COLLECTION_CATEGORIES.map((category) => (
                <AppCollection
                  key={category}
                  category={category}
                  onSelect={handleSelectPackage}
                  onSeeAll={handleSeeAll}
                />
              ))}
            </div>
          </section>

          {/* All Apps with Infinite Scroll */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <LayoutGrid className="w-5 h-5 text-accent-violet" />
              <h2 className="text-lg font-semibold text-white">All Apps</h2>
            </div>

            {isLoadingInfinite && allPackages.length === 0 ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="glass-dark rounded-xl p-5">
                    <div className="flex items-start gap-4">
                      <div className="w-16 h-16 rounded-lg bg-bg-elevated animate-shimmer" />
                      <div className="flex-1">
                        <div className="h-5 bg-bg-elevated rounded w-32 mb-2 animate-shimmer" />
                        <div className="h-4 bg-bg-elevated rounded w-24 mb-3 animate-shimmer" />
                        <div className="h-4 bg-bg-elevated rounded w-full animate-shimmer" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {allPackages.map((pkg, index) => (
                    <div
                      key={`${pkg.id}-${index}`}
                      className={mounted ? 'animate-fade-up' : 'opacity-0'}
                      style={{ animationDelay: `${Math.min(index * 30, 200)}ms` }}
                    >
                      <AppCard
                        package={pkg}
                        onSelect={handleSelectPackage}
                      />
                    </div>
                  ))}
                </div>

                {/* Infinite scroll trigger */}
                <div ref={loadMoreRef} className="h-20 flex items-center justify-center mt-4">
                  {isFetchingNextPage && (
                    <div className="flex items-center gap-3 text-zinc-400">
                      <Loader2 className="w-5 h-5 animate-spin text-accent-cyan" />
                      <span className="text-sm">Loading more apps...</span>
                    </div>
                  )}
                  {!hasNextPage && allPackages.length > 0 && (
                    <p className="text-zinc-600 text-sm">You've seen all the apps</p>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      )}

      {/* Package Configuration Modal */}
      {selectedPackage && !isLoadingInstallers && selectedInstallers.length > 0 && (
        <PackageConfig
          package={selectedPackage}
          installers={selectedInstallers}
          onClose={handleCloseConfig}
        />
      )}

      {/* Loading modal while fetching installers */}
      {selectedPackage && isLoadingInstallers && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleCloseConfig} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-bg-surface border-l border-white/5 shadow-2xl flex items-center justify-center animate-slide-in-right">
            <div className="text-center">
              <div className="relative">
                <Loader2 className="w-10 h-10 text-accent-cyan animate-spin mx-auto mb-4" />
                <div className="absolute inset-0 w-10 h-10 mx-auto blur-xl bg-accent-cyan/30 animate-pulse-glow" />
              </div>
              <p className="text-zinc-400">Loading package details...</p>
            </div>
          </div>
        </div>
      )}

      {/* Error state when no installers found */}
      {selectedPackage && !isLoadingInstallers && selectedInstallers.length === 0 && (
        <div className="fixed inset-0 z-50 overflow-hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleCloseConfig} />
          <div className="absolute right-0 top-0 bottom-0 w-full max-w-2xl bg-bg-surface border-l border-white/5 shadow-2xl flex items-center justify-center animate-slide-in-right">
            <div className="text-center px-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-status-error/10 flex items-center justify-center">
                <Package className="w-8 h-8 text-status-error" />
              </div>
              <h3 className="text-white font-medium mb-2">No installers found</h3>
              <p className="text-zinc-400 text-sm mb-4">
                Unable to find installer information for this package version.
              </p>
              <button
                onClick={handleCloseConfig}
                className="px-4 py-2 bg-bg-elevated hover:bg-white/10 text-white rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Cart Sidebar */}
      <UploadCart />
    </div>
  );
}
