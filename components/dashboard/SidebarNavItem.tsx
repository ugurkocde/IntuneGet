'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { listItem } from '@/lib/animations/variants';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import type { LucideIcon } from 'lucide-react';

interface SidebarNavItemProps {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: React.ReactNode;
  isCollapsed: boolean;
  onClick?: () => void;
}

const reducedMotionVariant = {
  hidden: { opacity: 1, x: 0 },
  visible: { opacity: 1, x: 0 },
};

export function SidebarNavItem({
  name,
  href,
  icon: Icon,
  badge,
  isCollapsed,
  onClick,
}: SidebarNavItemProps) {
  const pathname = usePathname();
  const prefersReducedMotion = useReducedMotion();

  const isActive =
    pathname === href ||
    (href !== '/dashboard' && href !== '/dashboard/msp' && pathname.startsWith(href));

  const content = (
    <motion.div variants={prefersReducedMotion ? reducedMotionVariant : listItem}>
      <Link
        href={href}
        onClick={onClick}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'group relative flex items-center gap-3 rounded-lg transition-colors duration-150',
          isCollapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5',
          isActive
            ? 'bg-accent-cyan/8 text-text-primary'
            : 'text-text-secondary hover:text-text-primary hover:bg-black/[0.04]'
        )}
      >
        {isActive && (
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-cyan rounded-r-full shadow-glow-cyan" />
        )}

        <Icon
          className={cn(
            'w-5 h-5 flex-shrink-0 relative z-10 transition-colors duration-150',
            isActive
              ? 'text-accent-cyan'
              : 'group-hover:text-accent-cyan-bright'
          )}
        />

        <AnimatePresence mode="wait">
          {!isCollapsed && (
            <motion.span
              key="label"
              initial={prefersReducedMotion ? false : { opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.15 }}
              className={cn(
                'font-medium relative z-10 whitespace-nowrap overflow-hidden',
                isActive ? 'text-accent-cyan-bright' : ''
              )}
            >
              {name}
            </motion.span>
          )}
        </AnimatePresence>

        {!isCollapsed && badge}
      </Link>
    </motion.div>
  );

  if (isCollapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <p className="font-medium">{name}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
