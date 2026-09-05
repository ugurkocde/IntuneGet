'use client';

import { memo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Package, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInventoryIcon } from '@/hooks/use-inventory';
import type { InventoryListApp } from '@/types/inventory';

interface InventoryListRowProps {
  app: InventoryListApp;
  onClick: () => void;
  isSelected?: boolean;
}

export const InventoryListRow = memo(function InventoryListRow({
  app,
  onClick,
  isSelected,
}: InventoryListRowProps) {
  const prefersReducedMotion = useReducedMotion();
  const { data: iconData } = useInventoryIcon(app.id, app.hasIcon);
  const largeIcon = iconData?.icon;
  const [iconError, setIconError] = useState(false);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return '--';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
    return `${mb.toFixed(1)} MB`;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <motion.div
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`View details for ${app.displayName}`}
      whileHover={prefersReducedMotion ? {} : { scale: 1.005, y: -1 }}
      whileTap={prefersReducedMotion ? {} : { scale: 0.995 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'bg-bg-elevated rounded-lg border px-4 py-3 flex items-center gap-4 cursor-pointer transition-all group',
        isSelected
          ? 'border-accent-cyan/40 shadow-glow-cyan bg-accent-cyan/[0.02]'
          : 'border-overlay/5 hover:bg-bg-surface/50 hover:border-overlay/10'
      )}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-lg bg-bg-surface border border-overlay/5 flex items-center justify-center flex-shrink-0">
        {largeIcon?.value && !iconError ? (
          <img
            src={`data:${largeIcon.type || 'image/png'};base64,${largeIcon.value}`}
            alt={app.displayName}
            className="w-7 h-7 rounded"
            onError={() => setIconError(true)}
          />
        ) : (
          <Package className="w-4 h-4 text-text-muted" />
        )}
      </div>

      {/* Name + Publisher */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-text-primary truncate">{app.displayName}</p>
        {app.publisher && (
          <p className="text-xs text-text-muted truncate">{app.publisher}</p>
        )}
      </div>

      {/* Version */}
      {app.displayVersion ? (
        <span className="text-xs bg-overlay/5 text-text-muted px-1.5 py-0.5 rounded flex-shrink-0">
          v{app.displayVersion}
        </span>
      ) : (
        <span className="text-xs text-text-muted flex-shrink-0">--</span>
      )}

      {/* Size */}
      <span className="text-xs text-text-muted w-16 text-right flex-shrink-0 hidden sm:block">
        {formatSize(app.size)}
      </span>

      {/* Date */}
      <span className="text-xs text-text-muted w-24 text-right flex-shrink-0 hidden md:block">
        {formatDate(app.lastModifiedDateTime)}
      </span>

      {/* Chevron */}
      <ChevronRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
    </motion.div>
  );
});
