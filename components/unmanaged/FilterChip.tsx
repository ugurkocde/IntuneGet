'use client';

import { ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FilterChipProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  count?: number;
  color?: string;
  icon?: LucideIcon;
}

export function FilterChip({
  active,
  onClick,
  children,
  count,
  color,
  icon: Icon,
}: FilterChipProps) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200',
        active
          ? 'bg-black/10 text-text-primary shadow-lg'
          : 'bg-black/[0.03] text-text-secondary hover:bg-black/[0.06] hover:text-text-primary'
      )}
      style={active && color ? {
        boxShadow: prefersReducedMotion ? undefined : `0 0 20px ${color}30`,
        borderColor: `${color}40`,
      } : {}}
    >
      {active && (
        <span
          className="absolute inset-0 rounded-full opacity-20"
          style={{ backgroundColor: color }}
        />
      )}
      {Icon && <Icon className="relative w-3.5 h-3.5" />}
      <span className="relative">{children}</span>
      {count !== undefined && (
        <span
          className={cn(
            'relative px-2 py-0.5 rounded-full text-xs tabular-nums',
            active ? 'bg-black/20' : 'bg-black/5'
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
