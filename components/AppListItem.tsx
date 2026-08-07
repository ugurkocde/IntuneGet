'use client';

import { memo, useCallback } from 'react';
import { Plus, Check, Loader2, Settings } from 'lucide-react';
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

function getInstallerTypeStyle(type: string): string {
  return installerTypeStyles[type.toLowerCase()] || 'text-text-secondary bg-bg-elevated border-overlay/10';
}

function getInstallerLabel(type: string): string {
  const upper = type.toUpperCase();
  if (upper === 'NULLSOFT' || upper === 'INNO' || upper === 'BURN') return 'EXE';
  if (upper === 'WIX') return 'MSI';
  if (upper === 'APPX') return 'MSIX';
  return upper;
}

interface AppListItemProps {
  package: NormalizedPackage;
  onSelect?: (pkg: NormalizedPackage) => void;
  isDeployed?: boolean;
  isBulkSelectMode?: boolean;
  isBulkSelected?: boolean;
  onBulkToggle?: (pkg: NormalizedPackage) => void;
  qaStatus?: QaStatus | null;
}

function AppListItemComponent({ package: pkg, onSelect, isDeployed = false, isBulkSelectMode = false, isBulkSelected = false, onBulkToggle, qaStatus }: AppListItemProps) {
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
      className={`group rounded-xl border px-4 py-3 cursor-pointer contain-layout transition-all duration-200 hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base ${
        isBulkSelected
          ? 'border-accent-cyan/50 bg-accent-cyan/5'
          : 'border-overlay/10 bg-bg-elevated hover:border-accent-cyan/25'
      }`}
    >
      <div className="flex items-center gap-4">
        {/* Bulk select checkbox */}
        {isBulkSelectMode && (
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors flex-shrink-0 ${
              isBulkSelected
                ? 'bg-accent-cyan border-accent-cyan'
                : 'border-overlay/30 bg-bg-surface'
            }`}
          >
            {isBulkSelected && <Check className="w-3 h-3 text-white" />}
          </div>
        )}

        <AppIcon
          packageId={pkg.id}
          packageName={pkg.name}
          iconPath={pkg.iconPath}
          size="md"
          className="flex-shrink-0 group-hover:scale-[1.03] transition-transform duration-200"
        />

        <div className="flex-1 min-w-0 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent-cyan transition-colors">
              {cleanPackageName(pkg.name)}
            </h4>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-text-secondary truncate">
                {pkg.publisher}
              </span>
              {pkg.appSource !== 'store' && (
                <span className="text-xs text-text-muted sm:hidden">v{pkg.version}</span>
              )}
            </div>
          </div>

          {pkg.appSource !== 'store' && (
            <span className="text-xs text-text-secondary bg-bg-surface px-2 py-0.5 rounded border border-overlay/10 flex-shrink-0 hidden sm:inline">
              v{pkg.version}
            </span>
          )}

          {pkg.appSource === 'store' ? (
            <span className="text-xs font-medium text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20 flex-shrink-0 hidden md:inline">
              Store
            </span>
          ) : pkg.installerType ? (
            <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 hidden md:inline ${getInstallerTypeStyle(pkg.installerType)}`}>
              {getInstallerLabel(pkg.installerType)}
            </span>
          ) : null}

          {pkg.appSource !== 'store' && (
            <div className="flex-shrink-0">
              <QaBadge wingetId={pkg.id} catalogVersion={pkg.version} status={qaStatus} />
            </div>
          )}

          {pkg.category && (
            <div className="hidden xl:block flex-shrink-0">
              <CategoryBadge category={pkg.category} />
            </div>
          )}

          {!isBulkSelectMode && (
            isDeployed ? (
              <Button
                size="sm"
                onClick={handleEditConfig}
                aria-label={`Edit ${pkg.name} config`}
                className="h-7 px-2 flex-shrink-0 bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 border border-accent-cyan/25"
              >
                <Settings className="w-3.5 h-3.5" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleQuickAdd}
                disabled={isLoading || inCart}
                aria-label={inCart ? `${pkg.name} already selected` : `Quick add ${pkg.name}`}
                className={`h-7 px-2 flex-shrink-0 ${
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
            )
          )}
        </div>
      </div>
    </div>
  );
}

export const AppListItem = memo(AppListItemComponent, (prevProps, nextProps) => {
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
