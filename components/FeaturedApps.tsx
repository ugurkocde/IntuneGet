'use client';

import { memo, useCallback } from 'react';
import { Loader2, Plus, Check, Star, ExternalLink, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { CategoryBadge } from '@/components/CategoryFilter';
import type { NormalizedPackage } from '@/types/winget';
import { cleanPackageName } from '@/lib/locale-utils';
import { useCartStore } from '@/stores/cart-store';
import { useQuickAdd } from '@/hooks/useQuickAdd';
import { TenantDeploymentBadge } from '@/components/TenantDeploymentBadge';

interface FeaturedAppsProps {
  packages: NormalizedPackage[];
  onSelect?: (pkg: NormalizedPackage) => void;
  isLoading?: boolean;
  deployedSet?: Set<string>;
  tenantDeployments?: Map<string, string | null>;
}

export function FeaturedApps({ packages, onSelect, isLoading, deployedSet, tenantDeployments }: FeaturedAppsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-[minmax(140px,auto)]">
        <div className="md:col-span-2 md:row-span-2 rounded-2xl border border-overlay/10 bg-bg-elevated animate-shimmer" />
        <div className="rounded-xl border border-overlay/10 bg-bg-elevated animate-shimmer" />
        <div className="rounded-xl border border-overlay/10 bg-bg-elevated animate-shimmer" />
        <div className="rounded-xl border border-overlay/10 bg-bg-elevated animate-shimmer hidden md:block" />
        <div className="rounded-xl border border-overlay/10 bg-bg-elevated animate-shimmer hidden md:block" />
      </div>
    );
  }

  if (packages.length === 0) return null;

  const [mainFeature, ...otherFeatures] = packages;
  const secondaryFeatures = otherFeatures.slice(0, 4);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-[minmax(140px,auto)]">
      {/* Main featured card - spans 2 columns and 2 rows */}
      {mainFeature && (
        <div className="md:col-span-2 md:row-span-2">
          <FeaturedMainCard package={mainFeature} onSelect={onSelect} isDeployed={deployedSet?.has(mainFeature.id)} tenantDeployedBy={tenantDeployments?.get(mainFeature.id)} />
        </div>
      )}

      {/* Secondary featured cards */}
      {secondaryFeatures.map((pkg) => (
        <FeaturedSecondaryCard
          key={pkg.id}
          package={pkg}
          onSelect={onSelect}
          isDeployed={deployedSet?.has(pkg.id)}
          tenantDeployedBy={tenantDeployments?.get(pkg.id)}
        />
      ))}
    </div>
  );
}

interface FeaturedCardProps {
  package: NormalizedPackage;
  onSelect?: (pkg: NormalizedPackage) => void;
  isDeployed?: boolean;
  tenantDeployedBy?: string | null;
}

function FeaturedMainCardComponent({ package: pkg, onSelect, isDeployed = false, tenantDeployedBy }: FeaturedCardProps) {
  const { quickAdd, isLoading } = useQuickAdd(pkg);

  const inCart = useCartStore(
    useCallback(
      (state) => state.items.some(
        (item) => item.wingetId === pkg.id && item.version === pkg.version
      ),
      [pkg.id, pkg.version]
    )
  );

  const handleEditConfig = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    onSelect?.(pkg);
  };

  const handleQuickAdd = async (e: React.MouseEvent | React.KeyboardEvent) => {
    if (isDeployed || inCart) return;
    await quickAdd(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(pkg);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(pkg)}
      onKeyDown={handleKeyDown}
      aria-label={`Featured: ${pkg.name} by ${pkg.publisher}, version ${pkg.version}${isDeployed ? ', deployed' : inCart ? ', selected' : ''}`}
      className="group relative rounded-2xl border border-overlay/10 bg-bg-elevated overflow-hidden cursor-pointer transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover hover:border-accent-cyan/25 h-full min-h-[280px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
    >
      <div className="absolute inset-0 bg-gradient-radial-cyan opacity-45" />
      <div className="absolute inset-0 bg-gradient-to-br from-accent-cyan/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="absolute top-4 left-4 z-10">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-accent-cyan/10 border border-accent-cyan/20 text-accent-cyan">
          <Star className="w-3 h-3" />
          Featured
        </span>
      </div>

      <div className="relative p-6 md:p-8 h-full flex flex-col">
        <div className="flex flex-col md:flex-row items-start gap-6 flex-1">
          <div className="relative mt-6 md:mt-4">
            <AppIcon
              packageId={pkg.id}
              packageName={pkg.name}
              iconPath={pkg.iconPath}
              size="2xl"
              className="group-hover:scale-[1.03] transition-transform duration-200"
            />
            <div className="absolute -inset-2 bg-gradient-to-br from-accent-cyan/20 to-transparent rounded-2xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl md:text-3xl font-bold text-text-primary group-hover:text-accent-cyan transition-colors">
                  {cleanPackageName(pkg.name)}
                </h2>
                <p className="text-text-secondary mt-1">{pkg.publisher}</p>
              </div>
              <span className="text-sm text-text-secondary bg-bg-surface px-3 py-1.5 rounded-lg border border-overlay/10 flex-shrink-0">
                v{pkg.version}
              </span>
            </div>

            {pkg.description && (
              <p className="text-text-secondary mt-4 text-base leading-relaxed line-clamp-3">
                {pkg.description}
              </p>
            )}

            <div className="flex items-center gap-3 mt-6">
              {pkg.category && <CategoryBadge category={pkg.category} />}
              <span className="text-text-muted text-sm font-mono">{pkg.id}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-overlay/10">
          <TenantDeploymentBadge deployedBy={tenantDeployedBy} />
          {isDeployed ? (
            <Button
              size="lg"
              onClick={handleEditConfig}
              className="bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 border border-accent-cyan/25"
            >
              <Settings className="w-5 h-5 mr-2" />
              Edit Config
            </Button>
          ) : (
            <Button
              size="lg"
              onClick={handleQuickAdd}
              disabled={isLoading || inCart}
              aria-label={inCart ? `${pkg.name} already selected` : `Quick add ${pkg.name}`}
              className={
                inCart
                  ? 'bg-status-success/10 text-status-success hover:bg-status-success/10 cursor-default border border-status-success/20'
                  : 'bg-accent-cyan hover:bg-accent-cyan-dim text-white border-0'
              }
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : inCart ? (
                <>
                  <Check className="w-5 h-5 mr-2" />
                  Selected
                </>
              ) : (
                <>
                  <Plus className="w-5 h-5 mr-2" />
                  Select
                </>
              )}
            </Button>
          )}
          {pkg.homepage && (
            <a
              href={pkg.homepage}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-text-muted hover:text-accent-cyan transition-colors p-2"
              aria-label={`Open ${pkg.name} homepage`}
            >
              <ExternalLink className="w-5 h-5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const FeaturedMainCard = memo(FeaturedMainCardComponent, (prev, next) =>
  prev.package.id === next.package.id &&
  prev.package.version === next.package.version &&
  prev.isDeployed === next.isDeployed &&
  prev.tenantDeployedBy === next.tenantDeployedBy
);

function FeaturedSecondaryCardComponent({ package: pkg, onSelect, isDeployed = false, tenantDeployedBy }: FeaturedCardProps) {
  const { quickAdd, isLoading } = useQuickAdd(pkg);

  const inCart = useCartStore(
    useCallback(
      (state) => state.items.some(
        (item) => item.wingetId === pkg.id && item.version === pkg.version
      ),
      [pkg.id, pkg.version]
    )
  );

  const handleEditConfig = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    onSelect?.(pkg);
  };

  const handleQuickAdd = async (e: React.MouseEvent | React.KeyboardEvent) => {
    if (isDeployed || inCart) return;
    await quickAdd(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(pkg);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(pkg)}
      onKeyDown={handleKeyDown}
      aria-label={`${pkg.name} by ${pkg.publisher}, version ${pkg.version}${isDeployed ? ', deployed' : inCart ? ', selected' : ''}`}
      className="group rounded-xl border border-overlay/10 bg-bg-elevated p-4 cursor-pointer transition-all duration-200 hover:shadow-card hover:border-accent-cyan/25 hover:-translate-y-0.5 h-full flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base"
    >
      <div className="flex items-start gap-3 flex-1">
        <AppIcon
          packageId={pkg.id}
          packageName={pkg.name}
          iconPath={pkg.iconPath}
          size="lg"
          className="group-hover:scale-[1.03] transition-transform flex-shrink-0"
        />

        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent-cyan transition-colors">
            {cleanPackageName(pkg.name)}
          </h3>
          <p className="text-xs text-text-muted truncate">{pkg.publisher}</p>
          {pkg.description && (
            <p className="text-xs text-text-secondary mt-1.5 line-clamp-2 leading-relaxed">
              {pkg.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-overlay/10">
        <span className="text-xs text-text-muted">v{pkg.version}</span>
        <TenantDeploymentBadge deployedBy={tenantDeployedBy} />
        {isDeployed ? (
          <Button
            size="sm"
            onClick={handleEditConfig}
            aria-label={`Edit ${pkg.name} config`}
            className="h-7 px-2 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 border border-accent-cyan/25"
          >
            <Settings className="w-3.5 h-3.5" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleQuickAdd}
            disabled={isLoading || inCart}
            aria-label={inCart ? `${pkg.name} already selected` : `Quick add ${pkg.name}`}
            className={`h-7 px-2 ${
              inCart
                ? 'bg-status-success/10 text-status-success hover:bg-status-success/10 cursor-default border border-status-success/20'
                : 'bg-accent-cyan hover:bg-accent-cyan-dim text-white border-0'
            }`}
          >
            {isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : inCart ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

const FeaturedSecondaryCard = memo(FeaturedSecondaryCardComponent, (prev, next) =>
  prev.package.id === next.package.id &&
  prev.package.version === next.package.version &&
  prev.isDeployed === next.isDeployed &&
  prev.tenantDeployedBy === next.tenantDeployedBy
);
