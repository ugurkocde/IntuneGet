'use client';

import { useRef, useState, useEffect, memo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ChevronRight as ArrowRight, Loader2, Plus, Check } from 'lucide-react';
import { AppIcon } from '@/components/AppIcon';
import { Button } from '@/components/ui/button';
import type { NormalizedPackage } from '@/types/winget';
import { usePackagesByCategory } from '@/hooks/use-packages';
import { useCartStore } from '@/stores/cart-store';
import { generateDetectionRules, generateInstallCommand, generateUninstallCommand } from '@/lib/detection-rules';
import { DEFAULT_PSADT_CONFIG, getDefaultProcessesToClose } from '@/types/psadt';
import { cn } from '@/lib/utils';
import { getCategoryLabel } from '@/lib/category-utils';

// Category icons/colors
const categoryStyles: Record<string, { gradient: string; icon: string }> = {
  browser: { gradient: 'from-blue-500 to-cyan-500', icon: 'globe' },
  development: { gradient: 'from-violet-500 to-purple-500', icon: 'code' },
  productivity: { gradient: 'from-green-500 to-emerald-500', icon: 'briefcase' },
  utilities: { gradient: 'from-orange-500 to-amber-500', icon: 'wrench' },
  communication: { gradient: 'from-pink-500 to-rose-500', icon: 'message' },
  media: { gradient: 'from-red-500 to-orange-500', icon: 'play' },
  gaming: { gradient: 'from-indigo-500 to-blue-500', icon: 'gamepad' },
  security: { gradient: 'from-slate-500 to-zinc-500', icon: 'shield' },
  runtime: { gradient: 'from-cyan-500 to-teal-500', icon: 'cpu' },
  other: { gradient: 'from-gray-500 to-zinc-500', icon: 'package' },
};

interface AppCollectionProps {
  category: string;
  onSelect?: (pkg: NormalizedPackage) => void;
  onSeeAll?: (category: string) => void;
}

export function AppCollection({ category, onSelect, onSeeAll }: AppCollectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const { data, isLoading } = usePackagesByCategory(category, 12);
  const packages = data?.packages || [];

  const displayName = getCategoryLabel(category);
  const style = categoryStyles[category] || categoryStyles.other;

  const checkScroll = useCallback(() => {
    const container = scrollRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth - 1
      );
    }
  }, []);

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, [packages, checkScroll]);

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollRef.current;
    if (container) {
      const cardWidth = 256; // Approximate card width + gap
      const scrollAmount = cardWidth * 2;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
      setTimeout(checkScroll, 300);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="h-6 w-32 bg-bg-elevated rounded animate-shimmer" />
          <div className="h-4 w-16 bg-bg-elevated rounded animate-shimmer" />
        </div>
        <div className="flex gap-4 overflow-hidden">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex-shrink-0 w-60 h-28 rounded-xl border border-black/10 bg-bg-elevated animate-shimmer" />
          ))}
        </div>
      </div>
    );
  }

  if (packages.length === 0) return null;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold tracking-tight text-text-primary flex items-center gap-2">
          <span className={cn('w-1.5 h-5 rounded-full bg-gradient-to-b', style.gradient)} />
          {displayName}
        </h3>
        {onSeeAll && (
          <button
            onClick={() => onSeeAll(category)}
            className="flex items-center gap-1 text-sm text-accent-cyan hover:text-accent-cyan-dim transition-colors group"
          >
            See All
            <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* Scrollable container */}
      <div className="relative group/collection">
        {/* Left scroll button */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center bg-bg-elevated border border-black/10 rounded-full shadow-soft hover:bg-bg-surface transition-all opacity-0 group-hover/collection:opacity-100 -translate-x-1/2"
          >
            <ChevronLeft className="w-5 h-5 text-text-secondary" />
          </button>
        )}

        {/* Cards container with snap scrolling */}
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 snap-x snap-mandatory"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {packages.map((pkg) => (
            <CollectionCard
              key={pkg.id}
              package={pkg}
              onSelect={onSelect}
            />
          ))}

          {/* Peekaboo card - hints at more content */}
          {packages.length >= 10 && onSeeAll && (
            <button
              onClick={() => onSeeAll(category)}
              className="flex-shrink-0 w-60 snap-start rounded-xl border border-dashed border-black/15 bg-bg-elevated p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:bg-bg-surface transition-colors"
            >
              <div className="w-12 h-12 rounded-xl border border-black/10 bg-bg-surface flex items-center justify-center">
                <ArrowRight className="w-6 h-6 text-text-secondary" />
              </div>
              <span className="text-sm text-text-secondary">See all {displayName}</span>
            </button>
          )}
        </div>

        {/* Right scroll button */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 flex items-center justify-center bg-bg-elevated border border-black/10 rounded-full shadow-soft hover:bg-bg-surface transition-all opacity-0 group-hover/collection:opacity-100 translate-x-1/2"
          >
            <ChevronRight className="w-5 h-5 text-text-secondary" />
          </button>
        )}

        {/* Fade edges */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-bg-deepest to-transparent opacity-0 group-hover/collection:opacity-100 transition-opacity" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-bg-deepest to-transparent opacity-0 group-hover/collection:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

interface CollectionCardProps {
  package: NormalizedPackage;
  onSelect?: (pkg: NormalizedPackage) => void;
}

function CollectionCardComponent({ package: pkg, onSelect }: CollectionCardProps) {
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
          description: pkg.description,
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
      className="flex-shrink-0 w-60 snap-start group rounded-xl border border-black/10 bg-bg-elevated p-4 cursor-pointer transition-all duration-200 hover:shadow-card hover:border-accent-cyan/25 hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-3">
        <AppIcon
          packageId={pkg.id}
          packageName={pkg.name}
          iconPath={pkg.iconPath}
          size="md"
          className="group-hover:scale-[1.03] transition-transform"
        />

        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-text-primary truncate group-hover:text-accent-cyan transition-colors">
            {pkg.name}
          </h4>
          <p className="text-xs text-text-muted truncate">{pkg.publisher}</p>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-black/10">
        <span className="text-xs text-text-muted">v{pkg.version}</span>
        <Button
          size="sm"
          onClick={handleQuickAdd}
          disabled={isLoading || inCart}
          className={cn(
            'h-7 px-2',
            inCart
              ? 'bg-status-success/10 text-status-success hover:bg-status-success/10 cursor-default border border-status-success/20'
              : 'bg-accent-cyan hover:bg-accent-cyan-dim text-white border-0'
          )}
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

const CollectionCard = memo(CollectionCardComponent, (prev, next) =>
  prev.package.id === next.package.id && prev.package.version === next.package.version
);
