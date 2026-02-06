'use client';

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Settings, LogOut, User, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useProfileStore } from '@/stores/profile-store';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

interface SidebarUserSectionProps {
  user: { id?: string; name?: string | null; email?: string | null } | null;
  isCollapsed: boolean;
  onSignOut: () => void;
  onNavigate?: () => void;
}

export function SidebarUserSection({
  user,
  isCollapsed,
  onSignOut,
  onNavigate,
}: SidebarUserSectionProps) {
  const pathname = usePathname();
  const prefersReducedMotion = useReducedMotion();
  const profileImage = useProfileStore((state) => state.profileImage);
  const initials = user?.name?.charAt(0) || user?.email?.charAt(0) || 'U';

  const avatar = (
    <div className="relative flex-shrink-0">
      <div className="absolute -inset-0.5 bg-gradient-to-br from-accent-cyan to-accent-violet rounded-full opacity-75 group-hover:opacity-100 transition-opacity" />
      <div className="relative w-9 h-9 rounded-full bg-bg-elevated flex items-center justify-center overflow-hidden">
        {profileImage ? (
          <img
            src={profileImage}
            alt="Profile"
            className="w-full h-full object-cover"
            onError={() => useProfileStore.getState().setProfileImage(null)}
          />
        ) : (
          <span className="text-sm font-semibold text-text-primary">
            {initials}
          </span>
        )}
      </div>
    </div>
  );

  if (isCollapsed) {
    return (
      <div className="p-3 border-t border-black/5">
        <DropdownMenu>
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="group flex items-center justify-center w-full rounded-lg p-1.5 hover:bg-black/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-1">
                  {avatar}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              <p className="font-medium">{user?.name || 'User'}</p>
              {user?.email && (
                <p className="text-xs text-text-muted">{user.email}</p>
              )}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="right" align="end" sideOffset={12} className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium">{user?.name || 'User'}</p>
                {user?.email && (
                  <p className="text-xs text-text-muted">{user.email}</p>
                )}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/account" onClick={onNavigate}>
                <User className="w-4 h-4 mr-2" />
                Account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/settings" onClick={onNavigate}>
                <Settings className="w-4 h-4 mr-2" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onSignOut}>
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  return (
    <div className="p-3 border-t border-black/5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="group flex items-center gap-3 w-full rounded-lg p-2 hover:bg-black/[0.04] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/50 focus-visible:ring-offset-1">
            {avatar}
            <AnimatePresence mode="wait">
              {!isCollapsed && (
                <motion.div
                  key="user-info"
                  initial={prefersReducedMotion ? false : { opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="text-sm font-medium text-text-primary truncate group-hover:text-accent-cyan-bright transition-colors">
                    {user?.name || 'User'}
                  </p>
                  <p className="text-xs text-text-muted truncate">
                    {user?.email}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
            <ChevronRight className={cn(
              'w-4 h-4 text-text-muted transition-all',
              'group-hover:text-accent-cyan opacity-0 group-hover:opacity-100',
              isCollapsed && 'hidden'
            )} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="right"
          align="end"
          sideOffset={12}
          className="w-56"
        >
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{user?.name || 'User'}</p>
              {user?.email && (
                <p className="text-xs text-text-muted">{user.email}</p>
              )}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link
              href="/dashboard/account"
              onClick={onNavigate}
              className={cn(
                pathname === '/dashboard/account' && 'text-accent-cyan'
              )}
            >
              <User className="w-4 h-4 mr-2" />
              Account
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link
              href="/dashboard/settings"
              onClick={onNavigate}
              className={cn(
                pathname.startsWith('/dashboard/settings') && 'text-accent-cyan'
              )}
            >
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onSignOut}>
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
