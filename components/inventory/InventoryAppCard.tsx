'use client';

import { memo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IntuneWin32App } from '@/types/inventory';

interface InventoryAppCardProps {
  app: IntuneWin32App;
  onClick: () => void;
  isSelected?: boolean;
}

export const InventoryAppCard = memo(function InventoryAppCard({
  app,
  onClick,
  isSelected,
}: InventoryAppCardProps) {
  const prefersReducedMotion = useReducedMotion();
  const [iconError, setIconError] = useState(false);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${Math.round(bytes / 1024)} KB`;
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <motion.div
      onClick={onClick}
      whileHover={prefersReducedMotion ? {} : { scale: 1.015, y: -2 }}
      whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'bg-bg-elevated rounded-xl border p-5 cursor-pointer transition-all shadow-soft',
        isSelected
          ? 'border-accent-cyan/40 shadow-glow-cyan bg-accent-cyan/[0.02]'
          : 'border-black/5 hover:border-black/10 hover:shadow-soft-md'
      )}
    >
      <div className="flex items-start gap-4">
        {/* App Icon */}
        <div className="w-11 h-11 rounded-lg bg-bg-surface border border-black/5 flex items-center justify-center flex-shrink-0">
          {app.largeIcon?.value && !iconError ? (
            <img
              src={`data:${app.largeIcon.type || 'image/png'};base64,${app.largeIcon.value}`}
              alt={app.displayName}
              className="w-9 h-9 rounded"
              onError={() => setIconError(true)}
            />
          ) : (
            <Package className="w-5 h-5 text-text-muted" />
          )}
        </div>

        {/* App Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-text-primary font-semibold text-[15px] leading-snug truncate">
            {app.displayName}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            {app.publisher && (
              <span className="text-sm text-text-secondary truncate">
                {app.publisher}
              </span>
            )}
            {app.displayVersion && (
              <span className="text-xs bg-black/5 text-text-muted px-1.5 py-0.5 rounded">
                v{app.displayVersion}
              </span>
            )}
          </div>

          {/* Metadata */}
          <div className="flex items-center gap-3 mt-3 text-xs text-text-muted">
            <span>{formatDate(app.createdDateTime)}</span>
            {app.size && (
              <>
                <span className="text-black/20">&#183;</span>
                <span>{formatSize(app.size)}</span>
              </>
            )}
            {app.installExperience?.runAsAccount && (
              <>
                <span className="text-black/20">&#183;</span>
                <span className="capitalize">{app.installExperience.runAsAccount}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Description preview */}
      {app.description && (
        <p className="text-sm text-text-secondary mt-3 line-clamp-2 leading-relaxed">
          {app.description}
        </p>
      )}
    </motion.div>
  );
});
