'use client';

import { useState, memo, useCallback } from 'react';
import { ExternalLink, Plus, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { CategoryBadge } from '@/components/CategoryFilter';
import type { NormalizedPackage, NormalizedInstaller } from '@/types/winget';
import { useCartStore } from '@/stores/cart-store';
import { generateDetectionRules, generateInstallCommand, generateUninstallCommand } from '@/lib/detection-rules';
import { DEFAULT_PSADT_CONFIG, getDefaultProcessesToClose } from '@/types/psadt';

interface AppCardProps {
  package: NormalizedPackage;
  onSelect?: (pkg: NormalizedPackage) => void;
}

function AppCardComponent({ package: pkg, onSelect }: AppCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const addItem = useCartStore((state) => state.addItem);

  // Optimized cart subscription - only re-renders when this specific item's cart status changes
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
      // Fetch installers for the package
      const response = await fetch(
        `/api/winget/manifest?id=${encodeURIComponent(pkg.id)}&arch=x64`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch installers');
      }

      const data = await response.json();
      const installer = data.recommendedInstaller;

      if (installer) {
        // Pass wingetId and version for registry marker detection (most reliable for EXE installers)
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
      className="group glass-dark rounded-xl p-5 cursor-pointer contain-layout transition-all duration-300 hover:shadow-xl hover:shadow-accent-cyan/5 hover:border-white/10 hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-4">
        {/* App icon - larger size with hover effect */}
        <div className="relative">
          <AppIcon
            packageId={pkg.id}
            packageName={pkg.name}
            iconPath={pkg.iconPath}
            size="xl"
            className="group-hover:border-accent-cyan/30 transition-all duration-300 group-hover:scale-105"
          />
          {/* Glow effect on hover */}
          <div className="absolute -inset-1 bg-gradient-to-br from-accent-cyan/20 to-accent-violet/20 rounded-xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-white font-semibold text-base truncate group-hover:text-accent-cyan-bright transition-colors">
                {pkg.name}
              </h3>
              <p className="text-zinc-500 text-sm truncate">{pkg.publisher}</p>
            </div>
            {/* Version badge */}
            <span className="text-xs text-zinc-400 bg-bg-elevated px-2.5 py-1 rounded-md flex-shrink-0 border border-white/5 group-hover:border-accent-cyan/20 transition-colors">
              v{pkg.version}
            </span>
          </div>

          {pkg.description && (
            <p className="text-zinc-400 text-sm mt-3 line-clamp-2 leading-relaxed">
              {pkg.description}
            </p>
          )}

          {/* Category badge and Package ID */}
          <div className="flex items-center gap-2 mt-3">
            {pkg.category && (
              <CategoryBadge category={pkg.category} />
            )}
            <p className="text-zinc-600 text-xs font-mono truncate group-hover:text-zinc-500 transition-colors">
              {pkg.id}
            </p>
          </div>
        </div>
      </div>

      {/* Actions - always visible */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
        <div className="flex items-center gap-3">
          {pkg.homepage && (
            <a
              href={pkg.homepage}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-zinc-500 hover:text-accent-cyan transition-colors p-1"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
        </div>

        <Button
          size="sm"
          onClick={handleQuickAdd}
          disabled={isLoading || inCart}
          className={
            inCart
              ? 'bg-status-success/10 text-status-success hover:bg-status-success/10 cursor-default border-0'
              : 'bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-white border-0 shadow-glow-cyan'
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
      </div>
    </div>
  );
}

// Memoize the component - only re-render when package.id changes
export const AppCard = memo(AppCardComponent, (prevProps, nextProps) => {
  return prevProps.package.id === nextProps.package.id &&
         prevProps.package.version === nextProps.package.version;
});
