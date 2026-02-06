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
import { toast } from '@/hooks/use-toast';

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
            detectionRules,
          },
        });
      } else {
        toast({
          title: 'No compatible installer found',
          description: `Could not find a suitable installer for ${pkg.name}`,
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('Error adding to cart:', error);
      toast({
        title: 'Failed to add app',
        description: 'Could not fetch package information. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      onClick={() => onSelect?.(pkg)}
      className="group glass-light rounded-xl p-5 cursor-pointer contain-layout transition-all duration-300 hover:shadow-card-hover hover:-translate-y-1 hover:scale-[1.02] hover:border-accent-cyan/20"
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
              <h3 className="text-text-primary font-semibold text-base truncate group-hover:text-accent-cyan-bright transition-colors">
                {pkg.name}
              </h3>
              <p className="text-text-muted text-sm truncate">
                {pkg.publisher}
                {pkg.id && <span className="text-text-muted/60 font-mono text-xs ml-1.5">{pkg.id}</span>}
              </p>
            </div>
            {/* Version badge */}
            <span className="text-xs text-text-secondary bg-bg-elevated px-2.5 py-1 rounded-md flex-shrink-0 border border-black/5 group-hover:border-accent-cyan/20 transition-colors">
              v{pkg.version}
            </span>
          </div>

          {pkg.description && (
            <p className="text-text-secondary text-sm mt-3 line-clamp-2 leading-relaxed">
              {pkg.description}
            </p>
          )}

          {/* Category badge, Popularity badge, and Installer type */}
          <div className="flex items-center flex-wrap gap-1.5 mt-3">
            {pkg.category && (
              <CategoryBadge category={pkg.category} />
            )}
            {pkg.popularityRank != null && pkg.popularityRank <= 100 && (
              <span className="text-xs font-medium text-accent-violet bg-accent-violet/10 px-2 py-0.5 rounded-full">
                Top {pkg.popularityRank}
              </span>
            )}
            {pkg.installerType && (
              <span className={`text-xs px-2 py-0.5 rounded-full border ${installerTypeStyles[pkg.installerType.toLowerCase()] || 'text-text-secondary bg-bg-elevated border-black/10'}`}>
                {getInstallerLabel(pkg.installerType)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Actions - always visible */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-black/5">
        <div className="flex items-center gap-3">
          {pkg.homepage && (
            <a
              href={pkg.homepage}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-text-muted hover:text-accent-cyan transition-colors p-1"
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
      </div>
    </div>
  );
}

// Memoize the component - only re-render when package.id changes
export const AppCard = memo(AppCardComponent, (prevProps, nextProps) => {
  return prevProps.package.id === nextProps.package.id &&
         prevProps.package.version === nextProps.package.version;
});
