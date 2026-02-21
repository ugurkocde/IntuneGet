'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  LayoutDashboard,
  Package,
  Rocket,
  Menu,
  X,
  Server,
  BarChart3,
  Building2,
  ArrowUpCircle,
  Radar,
  FolderSync,
  Users,
  ScrollText,
  Layers,
  Webhook,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { springPresets, staggerContainerFast } from '@/lib/animations/variants';
import { useSidebarStore } from '@/stores/sidebar-store';
import { useUserSettings } from '@/components/providers/UserSettingsProvider';
import { useMspOptional } from '@/hooks/useMspOptional';
import { UpdateBadge } from '@/components/inventory';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SidebarNavItem } from './SidebarNavItem';
import { SidebarUserSection } from './SidebarUserSection';
import type { LucideIcon } from 'lucide-react';

type NavItem = {
  name: string;
  href: string;
  icon: LucideIcon;
  badge?: React.ReactNode;
};

type NavGroup = {
  label?: string;
  items: NavItem[];
};

const coreNav: NavItem[] = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'App Catalog', href: '/dashboard/apps', icon: Package },
  { name: 'Deployments', href: '/dashboard/uploads', icon: Rocket },
  { name: 'Discovered Apps', href: '/dashboard/unmanaged', icon: Radar },
];

const managementNav: NavItem[] = [
  { name: 'SCCM Migration', href: '/dashboard/sccm', icon: FolderSync },
  { name: 'Inventory', href: '/dashboard/inventory', icon: Server },
  { name: 'App Updates', href: '/dashboard/updates', icon: ArrowUpCircle, badge: <UpdateBadge /> },
];

const analyticsNav: NavItem[] = [
  { name: 'Reports', href: '/dashboard/reports', icon: BarChart3 },
  { name: 'App Requests', href: '/dashboard/app-requests', icon: Lightbulb },
];

const mspNav: NavItem[] = [
  { name: 'MSP Dashboard', href: '/dashboard/msp', icon: Building2 },
  { name: 'Batch Deploy', href: '/dashboard/msp/batch', icon: Layers },
  { name: 'Team', href: '/dashboard/msp/team', icon: Users },
  { name: 'MSP Reports', href: '/dashboard/msp/reports', icon: BarChart3 },
  { name: 'Webhooks', href: '/dashboard/msp/webhooks', icon: Webhook },
  { name: 'Audit Logs', href: '/dashboard/msp/audit', icon: ScrollText },
];

const reducedMotionStagger = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
};

interface SidebarProps {
  user: { id?: string; name?: string | null; email?: string | null } | null;
  onSignOut: () => void;
}

export function Sidebar({ user, onSignOut }: SidebarProps) {
  const { isCollapsed, toggleCollapse } = useSidebarStore();
  const { setSidebarCollapsed } = useUserSettings();
  const { isMspUser } = useMspOptional();
  const prefersReducedMotion = useReducedMotion();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const handleToggleCollapse = useCallback(() => {
    const next = !isCollapsed;
    setSidebarCollapsed(next);
    toggleCollapse();
  }, [isCollapsed, setSidebarCollapsed, toggleCollapse]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const closeMobile = () => setMobileOpen(false);

  const navGroups: NavGroup[] = [
    { items: coreNav },
    { label: 'Management', items: managementNav },
    { label: 'Analytics', items: analyticsNav },
    ...(isMspUser
      ? [{ label: 'MSP', items: mspNav }]
      : [{ label: 'MSP', items: [{ name: 'MSP Dashboard', href: '/dashboard/msp', icon: Building2 }] }]),
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={cn(
        'flex items-center h-16 border-b border-overlay/5',
        isCollapsed ? 'justify-center px-3' : 'justify-between px-4'
      )}>
        <Link href="/dashboard" className="group flex items-center gap-3">
          <div className="relative w-9 h-9 rounded-lg overflow-hidden shadow-glow-cyan transition-shadow duration-300 group-hover:shadow-glow-cyan-lg flex-shrink-0">
            <Image
              src="/favicon.svg"
              alt="IntuneGet Logo"
              width={36}
              height={36}
              className="w-full h-full"
            />
          </div>
          <AnimatePresence mode="wait">
            {!isCollapsed && (
              <motion.span
                key="logo-text"
                initial={prefersReducedMotion ? false : { opacity: 0, width: 0 }}
                animate={{ opacity: 1, width: 'auto' }}
                exit={{ opacity: 0, width: 0 }}
                transition={{ duration: 0.15 }}
                className="text-xl font-bold text-text-primary tracking-tight whitespace-nowrap overflow-hidden"
              >
                IntuneGet
              </motion.span>
            )}
          </AnimatePresence>
        </Link>

        {/* Mobile close button */}
        <button
          onClick={closeMobile}
          className="lg:hidden text-text-secondary hover:text-text-primary transition-colors"
          aria-label="Close sidebar"
        >
          <X className="w-6 h-6" />
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="Main navigation" className="flex-1 px-3 py-4 overflow-y-auto">
        <motion.div
          variants={prefersReducedMotion ? reducedMotionStagger : staggerContainerFast}
          initial={mounted ? false : 'hidden'}
          animate="visible"
          className="space-y-1"
        >
          {navGroups.map((group, groupIndex) => (
            <div key={group.label || 'core'}>
              {/* Section divider/label */}
              {group.label && (
                <div className={cn('pt-4 pb-2', isCollapsed ? 'px-0' : 'px-3')}>
                  <AnimatePresence mode="wait">
                    {isCollapsed ? (
                      <div className="border-t border-overlay/5 mx-2" />
                    ) : (
                      <motion.span
                        key={`label-${group.label}`}
                        initial={prefersReducedMotion ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted"
                      >
                        {group.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {group.items.map((item) => (
                <SidebarNavItem
                  key={item.href}
                  name={item.name}
                  href={item.href}
                  icon={item.icon}
                  badge={item.badge}
                  isCollapsed={isCollapsed}
                  onClick={closeMobile}
                />
              ))}
            </div>
          ))}
        </motion.div>
      </nav>

      {/* Collapse toggle - desktop only */}
      <div className="hidden lg:flex px-3 pb-2">
        <button
          onClick={handleToggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'flex items-center gap-2 w-full rounded-lg px-3 py-2 text-text-muted hover:text-text-primary hover:bg-overlay/[0.04] transition-colors',
            isCollapsed && 'justify-center px-2'
          )}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-5 h-5 flex-shrink-0" />
          ) : (
            <>
              <PanelLeftClose className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm font-medium">Collapse</span>
            </>
          )}
        </button>
      </div>

      {/* User section */}
      <SidebarUserSection
        user={user}
        isCollapsed={isCollapsed}
        onSignOut={onSignOut}
        onNavigate={closeMobile}
      />
    </div>
  );

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-30 lg:hidden text-text-secondary hover:text-text-primary transition-colors"
        aria-label="Open sidebar"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Mobile backdrop */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="sidebar-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
            onClick={closeMobile}
          />
        )}
      </AnimatePresence>

      {/* Mobile sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-64 bg-bg-surface/95 backdrop-blur-xl transform transition-transform duration-300 ease-spring lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-accent-cyan/30 via-accent-violet/20 to-transparent" />
        {sidebarContent}
      </aside>

      {/* Desktop sidebar */}
      <motion.aside
        className="fixed top-0 left-0 z-50 h-full bg-bg-surface/95 backdrop-blur-xl hidden lg:block"
        animate={{ width: isCollapsed ? 72 : 256 }}
        transition={prefersReducedMotion ? { duration: 0 } : springPresets.snappy}
      >
        <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-accent-cyan/30 via-accent-violet/20 to-transparent" />
        {sidebarContent}
      </motion.aside>
    </TooltipProvider>
  );
}
