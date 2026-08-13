'use client';

import { memo, useCallback } from 'react';
import { ExternalLink, Plus, Check, Loader2, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { CategoryBadge } from '@/components/CategoryFilter';
import type { NormalizedPackage } from '@/types/winget';
import { cleanPackageName } from '@/lib/locale-utils';
import { useCartStore } from '@/stores/cart-store';
import { useQuickAdd } from '@/hooks/useQuickAdd';
import { QaBadge } from '@/components/qa/QaBadge';
import type { QaStatus } from '@/types/qa';

const installerTypeStyles: Record<string, string> = {
  msi: 'text-blue-600 bg-blue-500/10 border-blue-500/20',
  wix: 'text-blue-600 bg-blue-500/10 border-blue-500/20',
  msix: 'text-purple-600 bg-purple-500/10 border-purple-500/20',
  appx: 'text-purple-600 bg-purple-500/10 border-purple-500/20',
  exe: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  inno: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  nullsoft: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  burn: 'text-amber-600 bg-amber-500/10 border-amber-500/20',
  zip: 'text-slate-600 bg-slate-500/10 border-slate-500/20',
  portable: 'text-slate-600 bg-slate-500/10 border-slate-500/20',
};

function getInstallerLabel(type: string): string {
  const upper = type.toUpperCase();
  if (upper === 'NULLSOFT' || upper === 'INNO' || upper === 'BURN') return 'EXE';
  if (upper === 'WIX') return 'MSI';
  if (upper === 'APPX') return 'MSIX';
  return upper;
}

interface AppCardProps {
  package: NormalizedPackage;
  onSelect?: (pkg: NormalizedPackage) => void;
  isDeployed?: boolean;
  isBulkSelectMode?: boolean;
  isBulkSelected?: boolean;
  onBulkToggle?: (pkg: NormalizedPackage) => void;
  qaStatus?: QaStatus | null;
}

function AppCardComponent({ package: pkg, onSelect, isDeployed = false, isBulkSelectMode = false, isBulkSelected = false, onBulkToggle, qaStatus }: AppCardProps) {
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

  const handleClick = () => {
    if (isBulkSelectMode) {
      onBulkToggle?.(pkg);
    } else {
      onSelect?.(pkg);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const handleQuickAdd = async (e: React.MouseEvent | React.KeyboardEvent) => {
    if (isDeployed || inCart) return;
    await quickAdd(e);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`${pkg.name} by ${pkg.publisher}, version ${pkg.version}${isDeployed ? ', deployed' : inCart ? ', selected' : ''}`}
      className={`group relative rounded-2xl border bg-bg-elevated p-5 cursor-pointer contain-layout transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base ${
        isBulkSelected
          ? 'border-accent-cyan/50 bg-accent-cyan/5'
          : 'border-overlay/10 hover:border-accent-cyan/30'
      }`}
    >
      {/* Bulk select checkbox */}
      {isBulkSelectMode && (
        <div className="absolute top-3 left-3 z-10">
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              isBulkSelected
                ? 'bg-accent-cyan border-accent-cyan'
                : 'border-overlay/30 bg-bg-surface'
            }`}
          >
            {isBulkSelected && <Check className="w-3 h-3 text-white" />}
          </div>
        </div>
      )}

      <div className="flex items-start gap-4">
        <div className="relative flex-shrink-0">
          <AppIcon
            packageId={pkg.id}
            packageName={pkg.name}
            iconPath={pkg.iconPath}
            size="xl"
            className="group-hover:border-accent-cyan/30 transition-all duration-200 group-hover:scale-[1.03]"
          />
          <div className="absolute -inset-1 bg-gradient-to-br from-accent-cyan/20 to-transparent rounded-xl blur-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 -z-10" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-text-primary font-semibold text-base truncate group-hover:text-accent-cyan transition-colors">
                {cleanPackageName(pkg.name)}
              </h3>
              <p className="text-text-secondary text-sm truncate">{pkg.publisher}</p>
              {pkg.id && (
                <p className="text-[11px] text-text-muted font-mono truncate mt-1">
                  {pkg.id}
                </p>
              )}
            </div>
            {pkg.appSource !== 'store' && (
              <span className="text-xs text-text-secondary bg-bg-surface px-2.5 py-1 rounded-md flex-shrink-0 border border-overlay/10">
                v{pkg.version}
              </span>
            )}
          </div>

          {pkg.description && (
            <p className="text-text-secondary text-sm mt-3 line-clamp-2 leading-relaxed min-h-[2.75rem]">
              {pkg.description}
            </p>
          )}

          <div className="flex items-center flex-wrap gap-1.5 mt-3">
            {pkg.appSource === 'store' && (
              <span className="text-xs font-medium text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full border border-violet-500/20">
                Store
              </span>
            )}
            {pkg.category && (
              <CategoryBadge category={pkg.category} />
            )}
            {pkg.installerType && pkg.appSource !== 'store' && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${installerTypeStyles[pkg.installerType.toLowerCase()] || 'text-text-secondary bg-bg-surface border-overlay/10'}`}>
                {getInstallerLabel(pkg.installerType)}
              </span>
            )}
            {pkg.appSource !== 'store' && (
              <QaBadge wingetId={pkg.id} catalogVersion={pkg.version} status={qaStatus} />
            )}
            {pkg.popularityRank != null && pkg.popularityRank <= 100 && pkg.appSource !== 'store' && (
              <span className="text-xs font-medium text-accent-violet bg-accent-violet/10 px-2 py-0.5 rounded-full border border-accent-violet/20">
                Top {pkg.popularityRank}
              </span>
            )}
          </div>
        </div>
      </div>

      {!isBulkSelectMode && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-overlay/10">
          <div className="flex items-center gap-2">
            {pkg.homepage && (
              <a
                href={pkg.homepage}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-text-muted hover:text-accent-cyan transition-colors p-1"
                aria-label={`Open ${pkg.name} homepage`}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            )}
          </div>

          {isDeployed ? (
            <Button
              size="sm"
              onClick={handleEditConfig}
              className="bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 border border-accent-cyan/25"
            >
              <Settings className="w-4 h-4 mr-1.5" />
              Edit Config
            </Button>
          ) : (
            <Button
              size="sm"
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
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : inCart ? (
                <>
                  <Check className="w-4 h-4 mr-1.5" />
                  Selected
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-1.5" />
                  Select
                </>
              )}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export const AppCard = memo(AppCardComponent, (prevProps, nextProps) => {
  return prevProps.package.id === nextProps.package.id &&
         prevProps.package.version === nextProps.package.version &&
         prevProps.isDeployed === nextProps.isDeployed &&
         prevProps.isBulkSelectMode === nextProps.isBulkSelectMode &&
         prevProps.isBulkSelected === nextProps.isBulkSelected &&
         prevProps.qaStatus?.outcome === nextProps.qaStatus?.outcome &&
         prevProps.qaStatus?.testedVersion === nextProps.qaStatus?.testedVersion &&
         prevProps.qaStatus?.architecture === nextProps.qaStatus?.architecture &&
         prevProps.qaStatus?.testedAtUtc === nextProps.qaStatus?.testedAtUtc;
});
