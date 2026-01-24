'use client';

import { useState, memo, useCallback } from 'react';
import { Loader2, Plus, Check, Star, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { CategoryBadge } from '@/components/CategoryFilter';
import type { NormalizedPackage, NormalizedInstaller } from '@/types/winget';
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
      <div className="space-y-4">
        {/* Large featured card skeleton */}
        <div className="glass-dark rounded-2xl p-6 h-48 animate-shimmer" />
        {/* Two smaller cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="glass-dark rounded-xl p-5 h-32 animate-shimmer" />
          <div className="glass-dark rounded-xl p-5 h-32 animate-shimmer" />
        </div>
      </div>
    );
  }

  if (packages.length === 0) return null;

  const [mainFeature, ...otherFeatures] = packages;
  const secondaryFeatures = otherFeatures.slice(0, 2);

  return (
    <div className="space-y-4">
      {/* Main featured app - large card */}
      {mainFeature && (
        <FeaturedMainCard package={mainFeature} onSelect={onSelect} />
      )}

      {/* Secondary featured apps */}
      {secondaryFeatures.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {secondaryFeatures.map((pkg) => (
            <FeaturedSecondaryCard key={pkg.id} package={pkg} onSelect={onSelect} />
          ))}
        </div>
      )}
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
            detectionRules: detectionRules as any,
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
      className="group relative glass-dark rounded-2xl overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-2xl hover:shadow-accent-cyan/10"
    >
      {/* Gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-accent-cyan/10 via-transparent to-accent-violet/10 opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Featured badge */}
      <div className="absolute top-4 left-4 z-10">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-accent-cyan to-accent-violet text-white shadow-lg">
          <Star className="w-3 h-3" />
          Featured
        </span>
      </div>

      <div className="relative p-6 md:p-8">
        <div className="flex flex-col md:flex-row items-start gap-6">
          {/* Large app icon */}
          <div className="relative">
            <AppIcon
              packageId={pkg.id}
              packageName={pkg.name}
              iconPath={pkg.iconPath}
              size="xl"
              className="group-hover:scale-105 transition-transform duration-300"
            />
            <div className="absolute -inset-2 bg-gradient-to-br from-accent-cyan/20 to-accent-violet/20 rounded-2xl blur-xl opacity-0 group-hover:opacity-100 transition-opacity -z-10" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl md:text-3xl font-bold text-white group-hover:text-accent-cyan-bright transition-colors">
                  {pkg.name}
                </h2>
                <p className="text-zinc-400 mt-1">{pkg.publisher}</p>
              </div>
              <span className="text-sm text-zinc-400 bg-bg-elevated px-3 py-1.5 rounded-lg border border-white/5 flex-shrink-0">
                v{pkg.version}
              </span>
            </div>

            {pkg.description && (
              <p className="text-zinc-300 mt-4 text-base leading-relaxed line-clamp-2">
                {pkg.description}
              </p>
            )}

            <div className="flex items-center gap-3 mt-6">
              {pkg.category && <CategoryBadge category={pkg.category} />}
              <span className="text-zinc-600 text-sm font-mono">{pkg.id}</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 md:flex-col md:items-end">
            <Button
              size="lg"
              onClick={handleQuickAdd}
              disabled={isLoading || inCart}
              className={
                inCart
                  ? 'bg-status-success/10 text-status-success hover:bg-status-success/10 cursor-default border-0'
                  : 'bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-white border-0 shadow-glow-cyan'
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
                className="text-zinc-500 hover:text-accent-cyan transition-colors p-2"
              >
                <ExternalLink className="w-5 h-5" />
              </a>
            )}
          </div>
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
            detectionRules: detectionRules as any,
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
      className="group glass-dark rounded-xl p-5 cursor-pointer transition-all duration-300 hover:shadow-xl hover:shadow-accent-violet/5 hover:border-white/10"
    >
      <div className="flex items-start gap-4">
        <AppIcon
          packageId={pkg.id}
          packageName={pkg.name}
          iconPath={pkg.iconPath}
          size="lg"
          className="group-hover:scale-105 transition-transform"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-white truncate group-hover:text-accent-violet transition-colors">
                {pkg.name}
              </h3>
              <p className="text-zinc-500 text-sm">{pkg.publisher}</p>
            </div>
            <Button
              size="sm"
              onClick={handleQuickAdd}
              disabled={isLoading || inCart}
              className={
                inCart
                  ? 'bg-status-success/10 text-status-success hover:bg-status-success/10 cursor-default border-0'
                  : 'bg-bg-elevated hover:bg-white/10 text-white border border-white/10'
              }
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : inCart ? (
                <Check className="w-4 h-4" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
            </Button>
          </div>

          {pkg.description && (
            <p className="text-zinc-400 text-sm mt-2 line-clamp-2">
              {pkg.description}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const FeaturedSecondaryCard = memo(FeaturedSecondaryCardComponent, (prev, next) =>
  prev.package.id === next.package.id && prev.package.version === next.package.version
);
