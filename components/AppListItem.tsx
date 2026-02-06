'use client';

import { useState, memo, useCallback } from 'react';
import { Plus, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AppIcon } from '@/components/AppIcon';
import { CategoryBadge } from '@/components/CategoryFilter';
import type { NormalizedPackage } from '@/types/winget';
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

function getInstallerTypeStyle(type: string): string {
  return installerTypeStyles[type.toLowerCase()] || 'text-text-secondary bg-bg-elevated border-black/10';
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
}

function AppListItemComponent({ package: pkg, onSelect }: AppListItemProps) {
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
      className="group glass-light rounded-lg px-4 py-3 cursor-pointer contain-layout transition-all duration-200 hover:bg-black/5 hover:shadow-card"
    >
      <div className="flex items-center gap-4">
        <AppIcon
          packageId={pkg.id}
          packageName={pkg.name}
          iconPath={pkg.iconPath}
          size="md"
          className="flex-shrink-0"
        />

        <div className="flex-1 min-w-0 flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-text-primary truncate group-hover:text-accent-cyan transition-colors">
                {pkg.name}
              </h4>
              <span className="text-xs text-text-muted truncate hidden sm:inline">
                {pkg.publisher}
              </span>
            </div>
          </div>

          <span className="text-xs text-text-secondary bg-bg-elevated px-2 py-0.5 rounded border border-black/5 flex-shrink-0 hidden md:inline">
            v{pkg.version}
          </span>

          {pkg.installerType && (
            <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 hidden md:inline ${getInstallerTypeStyle(pkg.installerType)}`}>
              {getInstallerLabel(pkg.installerType)}
            </span>
          )}

          {pkg.category && (
            <div className="hidden lg:block flex-shrink-0">
              <CategoryBadge category={pkg.category} />
            </div>
          )}

          <Button
            size="sm"
            onClick={handleQuickAdd}
            disabled={isLoading || inCart}
            className={`h-7 px-2 flex-shrink-0 ${
              inCart
                ? 'bg-status-success/10 text-status-success hover:bg-status-success/10 cursor-default border-0'
                : 'bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-text-primary border-0'
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
    </div>
  );
}

export const AppListItem = memo(AppListItemComponent, (prevProps, nextProps) => {
  return prevProps.package.id === nextProps.package.id &&
         prevProps.package.version === nextProps.package.version;
});
