'use client';

import { useState, memo, useCallback } from 'react';
import { Loader2, Plus, Check, Star, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { CategoryBadge } from '@/components/CategoryFilter';
import type { NormalizedPackage } from '@/types/winget';
import { useCartStore } from '@/stores/cart-store';
import { generateDetectionRules, generateInstallCommand, generateUninstallCommand } from '@/lib/detection-rules';
import { DEFAULT_PSADT_CONFIG, getDefaultProcessesToClose } from '@/types/psadt';

interface FeaturedAppsProps {
  packages: NormalizedPackage[];
  onSelect?: (pkg: NormalizedPackage) => void;
  isLoading?: boolean;
}

export function FeaturedApps({ packages, onSelect, isLoading }: FeaturedAppsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-[minmax(140px,auto)]">
        <div className="md:col-span-2 md:row-span-2 glass-light rounded-2xl animate-shimmer" />
        <div className="glass-light rounded-xl animate-shimmer" />
        <div className="glass-light rounded-xl animate-shimmer" />
        <div className="glass-light rounded-xl animate-shimmer hidden md:block" />
        <div className="glass-light rounded-xl animate-shimmer hidden md:block" />
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
          <FeaturedMainCard package={mainFeature} onSelect={onSelect} />
        </div>
      )}

      {/* Secondary featured cards */}
      {secondaryFeatures.map((pkg) => (
        <FeaturedSecondaryCard key={pkg.id} package={pkg} onSelect={onSelect} />
      ))}
    </div>
  );
}

interface FeaturedCardProps {
  package: NormalizedPackage;
  onSelect?: (pkg: NormalizedPackage) => void;
}

function FeaturedMainCardComponent({ package: pkg, onSelect }: FeaturedCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const addItem = useCartStore((state) => state.addItem);

  const inCart = useCartStore(
    useCallback(
      (state) => state.items.some(
        (item) => item.wingetId === pkg.id && item.version === pkg.version
      ),
      [pkg.id, pkg.version]
    )
  );

  const handleQuickAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inCart) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/winget/manifest?id=${encodeURIComponent(pkg.id)}&arch=x64`
      );
      if (!response.ok) throw new Error('Failed to fetch installers');

      const data = await response.json();
      const installer = data.recommendedInstaller;

      if (installer) {
        const detectionRules = generateDetectionRules(installer, pkg.name, pkg.id, pkg.version);
        const processesToClose = getDefaultProcessesToClose(pkg.name, installer.type);

        addItem({
          wingetId: pkg.id,
          displayName: pkg.name,
          publisher: pkg.publisher,
          version: pkg.version,
          architecture: installer.architecture,
          installScope: installer.scope || 'machine',
          installerType: installer.type,
          installerUrl: installer.url,
          installerSha256: installer.sha256,
          installCommand: generateInstallCommand(installer, installer.scope || 'machine'),
          uninstallCommand: generateUninstallCommand(installer, pkg.name),
          detectionRules,
          psadtConfig: {
            ...DEFAULT_PSADT_CONFIG,
            processesToClose,
            detectionRules,
          },
        });
      }
    } catch (error) {
      console.error('Error adding to cart:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      onClick={() => onSelect?.(pkg)}
      className="group relative glass-light rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-2xl hover:shadow-accent-cyan/10 h-full min-h-[280px]"
    >
      {/* Radial gradient background */}
      <div className="absolute inset-0 bg-gradient-radial-cyan opacity-30" />
      <div className="absolute inset-0 bg-gradient-to-br from-accent-cyan/10 via-transparent to-accent-violet/10 opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Featured badge */}
      <div className="absolute top-4 left-4 z-10">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-accent-cyan to-accent-violet text-text-primary shadow-lg">
          <Star className="w-3 h-3" />
          Featured
        </span>
      </div>

      <div className="relative p-6 md:p-8 h-full flex flex-col">
        <div className="flex flex-col md:flex-row items-start gap-6 flex-1">
          {/* Large app icon */}
          <div className="relative mt-6 md:mt-4">
            <AppIcon
              packageId={pkg.id}
              packageName={pkg.name}
              iconPath={pkg.iconPath}
              size="2xl"
              className="group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute -inset-2 bg-gradient-to-br from-accent-cyan/20 to-accent-violet/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl md:text-3xl font-bold text-text-primary group-hover:text-accent-cyan-bright transition-colors">
                  {pkg.name}
                </h2>
                <p className="text-text-secondary mt-1">{pkg.publisher}</p>
              </div>
              <span className="text-sm text-text-secondary bg-bg-elevated px-3 py-1.5 rounded-lg border border-black/5 flex-shrink-0">
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

        {/* Actions pinned to bottom */}
        <div className="flex items-center gap-3 mt-6 pt-4 border-t border-black/5">
          <Button
            size="lg"
            onClick={handleQuickAdd}
            disabled={isLoading || inCart}
            className={
              inCart
                ? 'bg-status-success/10 text-status-success hover:bg-status-success/10 cursor-default border-0'
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
          {pkg.homepage && (
            <a
              href={pkg.homepage}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-text-muted hover:text-accent-cyan transition-colors p-2"
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
  prev.package.id === next.package.id && prev.package.version === next.package.version
);

function FeaturedSecondaryCardComponent({ package: pkg, onSelect }: FeaturedCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const addItem = useCartStore((state) => state.addItem);

  const inCart = useCartStore(
    useCallback(
      (state) => state.items.some(
        (item) => item.wingetId === pkg.id && item.version === pkg.version
      ),
      [pkg.id, pkg.version]
    )
  );

  const handleQuickAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inCart) return;

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/winget/manifest?id=${encodeURIComponent(pkg.id)}&arch=x64`
      );
      if (!response.ok) throw new Error('Failed to fetch installers');

      const data = await response.json();
      const installer = data.recommendedInstaller;

      if (installer) {
        const detectionRules = generateDetectionRules(installer, pkg.name, pkg.id, pkg.version);
        const processesToClose = getDefaultProcessesToClose(pkg.name, installer.type);

        addItem({
          wingetId: pkg.id,
          displayName: pkg.name,
          publisher: pkg.publisher,
          version: pkg.version,
          architecture: installer.architecture,
          installScope: installer.scope || 'machine',
          installerType: installer.type,
          installerUrl: installer.url,
          installerSha256: installer.sha256,
          installCommand: generateInstallCommand(installer, installer.scope || 'machine'),
          uninstallCommand: generateUninstallCommand(installer, pkg.name),
          detectionRules,
          psadtConfig: {
            ...DEFAULT_PSADT_CONFIG,
            processesToClose,
            detectionRules,
          },
        });
      }
    } catch (error) {
      console.error('Error adding to cart:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      onClick={() => onSelect?.(pkg)}
      className="group glass-light rounded-xl p-4 cursor-pointer transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5 h-full flex flex-col"
    >
      <div className="flex items-start gap-3 flex-1">
        <AppIcon
          packageId={pkg.id}
          packageName={pkg.name}
          iconPath={pkg.iconPath}
          size="lg"
          className="group-hover:scale-105 transition-transform flex-shrink-0"
        />

        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent-cyan transition-colors">
            {pkg.name}
          </h3>
          <p className="text-xs text-text-muted truncate">{pkg.publisher}</p>
          {pkg.description && (
            <p className="text-xs text-text-secondary mt-1.5 line-clamp-2 leading-relaxed">
              {pkg.description}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-black/5">
        <span className="text-xs text-text-muted">v{pkg.version}</span>
        <Button
          size="sm"
          onClick={handleQuickAdd}
          disabled={isLoading || inCart}
          className={`h-7 px-2 ${
            inCart
              ? 'bg-status-success/10 text-status-success hover:bg-status-success/10 cursor-default border-0'
              : 'bg-accent-cyan/10 text-accent-cyan hover:bg-accent-cyan/20 border-0'
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
      </div>
    </div>
  );
}

const FeaturedSecondaryCard = memo(FeaturedSecondaryCardComponent, (prev, next) =>
  prev.package.id === next.package.id && prev.package.version === next.package.version
);
