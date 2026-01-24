'use client';

import { memo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Package, Calendar, User } from 'lucide-react';
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
  // Track if the icon failed to load
  const [iconError, setIconError] = useState(false);

  const handleIconError = () => {
    setIconError(true);
  };

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
      whileHover={prefersReducedMotion ? {} : { scale: 1.02, y: -2 }}
      whileTap={prefersReducedMotion ? {} : { scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={cn(
        'glass-dark border rounded-xl p-4 cursor-pointer transition-all contain-layout',
        isSelected
          ? 'border-accent-cyan/50 bg-accent-cyan/5 shadow-glow-cyan'
          : 'border-white/5 hover:border-accent-cyan/30 hover:shadow-glow-cyan/30'
      )}
    >
      <div className="flex items-start gap-4">
        {/* App Icon */}
        <div className="w-12 h-12 rounded-lg bg-bg-elevated flex items-center justify-center flex-shrink-0 border border-white/5">
          {app.largeIcon?.value && !iconError ? (
            <img
              src={`data:${app.largeIcon.type || 'image/png'};base64,${app.largeIcon.value}`}
              alt={app.displayName}
              className="w-10 h-10 rounded"
              onError={handleIconError}
            />
          ) : (
            <Package className="w-6 h-6 text-zinc-400" />
          )}
        </div>

        {/* App Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-medium truncate">{app.displayName}</h3>
          <div className="flex items-center gap-2 mt-1">
            {app.publisher && (
              <span className="text-sm text-zinc-400 truncate">
                {app.publisher}
              </span>
            )}
            {app.displayVersion && (
              <>
                <span className="text-zinc-600">|</span>
                <span className="text-sm text-zinc-500">v{app.displayVersion}</span>
              </>
            )}
          </div>

          {/* Metadata */}
          <div className="flex items-center gap-4 mt-3 text-xs text-zinc-500">
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>{formatDate(app.createdDateTime)}</span>
            </div>
            {app.size && (
              <div className="flex items-center gap-1">
                <Package className="w-3 h-3" />
                <span>{formatSize(app.size)}</span>
              </div>
            )}
            {app.installExperience?.runAsAccount && (
              <div className="flex items-center gap-1">
                <User className="w-3 h-3" />
                <span className="capitalize">{app.installExperience.runAsAccount}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Description preview */}
      {app.description && (
        <p className="text-sm text-zinc-500 mt-3 line-clamp-2">{app.description}</p>
      )}
    </motion.div>
  );
});
