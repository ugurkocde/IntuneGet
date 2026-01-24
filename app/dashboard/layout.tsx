'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  LayoutDashboard,
  Package,
  Upload,
  Settings,
  LogOut,
  ShoppingCart,
  Menu,
  X,
  ChevronRight,
  Server,
  BarChart3,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCartStore } from '@/stores/cart-store';
import { cn } from '@/lib/utils';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { UpdateBadge } from '@/components/inventory';
import { TenantSwitcher } from '@/components/msp';

type NavItem = {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  badge?: string;
};

const navigation: NavItem[] = [
  { name: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { name: 'App Catalog', href: '/dashboard/apps', icon: Package },
  { name: 'Inventory', href: '/dashboard/inventory', icon: Server, badge: 'update' },
  { name: 'Uploads', href: '/dashboard/uploads', icon: Upload },
  { name: 'Reports', href: '/dashboard/reports', icon: BarChart3 },
  { name: 'MSP', href: '/dashboard/msp', icon: Building2 },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, user, signOut } = useMicrosoftAuth();
  const { isOnboardingComplete, isChecking: isCheckingOnboarding } = useOnboardingStatus();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const cartItemCount = useCartStore((state) => state.getItemCount());
  const toggleCart = useCartStore((state) => state.toggleCart);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/auth/signin?callbackUrl=/dashboard');
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && !isCheckingOnboarding && !isOnboardingComplete) {
      router.push('/onboarding');
    }
  }, [isLoading, isAuthenticated, isCheckingOnboarding, isOnboardingComplete, router]);

  const handleSignOut = async () => {
    await signOut();
  };

  if (isLoading || isCheckingOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-deepest">
        <div className="relative">
          <div className="animate-spin rounded-full h-12 w-12 border-2 border-accent-cyan/20 border-t-accent-cyan"></div>
          <div className="absolute inset-0 rounded-full blur-xl bg-accent-cyan/20 animate-pulse-glow"></div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !isOnboardingComplete) {
    return null;
  }

  return (
    <div className="min-h-screen bg-bg-deepest bg-grid-dark">
      {/* Ambient glow elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-accent-cyan/8 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-accent-violet/8 rounded-full blur-3xl" />
      </div>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-64 bg-bg-surface/95 backdrop-blur-xl transform transition-transform duration-300 ease-spring lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Gradient border on right edge */}
        <div className="absolute top-0 right-0 bottom-0 w-px bg-gradient-to-b from-accent-cyan/30 via-accent-violet/20 to-transparent" />

        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center justify-between h-16 px-4 border-b border-white/5">
            <Link href="/dashboard" className="group flex items-center gap-3">
              <div className="relative w-9 h-9 rounded-lg overflow-hidden shadow-glow-cyan transition-shadow duration-300 group-hover:shadow-glow-cyan-lg">
                <Image
                  src="/favicon.svg"
                  alt="IntuneGet Logo"
                  width={36}
                  height={36}
                  className="w-full h-full"
                />
              </div>
              <span className="text-xl font-bold text-white tracking-tight">IntuneGet</span>
            </Link>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {navigation.map((item, index) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    'group relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                    isActive
                      ? 'text-white'
                      : 'text-zinc-400 hover:text-white hover:bg-white/5'
                  )}
                  style={mounted ? { animationDelay: `${index * 50}ms` } : undefined}
                >
                  {/* Active indicator - gradient pill with glow */}
                  {isActive && (
                    <>
                      <div className="absolute inset-0 bg-gradient-to-r from-accent-cyan/15 to-accent-violet/10 rounded-lg" />
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-cyan rounded-r-full shadow-glow-cyan" />
                    </>
                  )}

                  <item.icon className={cn(
                    'w-5 h-5 relative z-10 transition-colors',
                    isActive ? 'text-accent-cyan' : 'group-hover:text-accent-cyan-bright'
                  )} />
                  <span className="font-medium relative z-10">{item.name}</span>
                  {item.badge === 'update' && <UpdateBadge />}
                  {isActive && !item.badge && (
                    <ChevronRight className="w-4 h-4 ml-auto relative z-10 text-accent-cyan" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* User section */}
          <div className="p-4 border-t border-white/5">
            <div className="flex items-center gap-3 mb-4">
              {/* Avatar with gradient ring */}
              <div className="relative">
                <div className="absolute -inset-0.5 bg-gradient-to-br from-accent-cyan to-accent-violet rounded-full opacity-75" />
                <div className="relative w-10 h-10 rounded-full bg-bg-elevated flex items-center justify-center">
                  <span className="text-sm font-semibold text-white">
                    {user?.name?.charAt(0) || user?.email?.charAt(0) || 'U'}
                  </span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user?.name || 'User'}
                </p>
                <p className="text-xs text-zinc-500 truncate">
                  {user?.email}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              onClick={handleSignOut}
              className="w-full justify-start text-zinc-400 hover:text-white hover:bg-white/5"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-16 glass-dark">
          <div className="flex items-center justify-between h-full px-4 lg:px-6">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden text-zinc-400 hover:text-white transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>

            <div className="flex-1 lg:flex-none" />

            <div className="flex items-center gap-3">
              {/* Tenant Switcher (for MSP users) */}
              <TenantSwitcher />

              {/* Cart button */}
              <Button
                variant="ghost"
                onClick={toggleCart}
                className="relative text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
              >
                <ShoppingCart className="w-5 h-5" />
                {cartItemCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-r from-accent-cyan to-accent-violet text-white text-xs font-medium rounded-full flex items-center justify-center shadow-glow-cyan animate-scale-in">
                    {cartItemCount}
                  </span>
                )}
              </Button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6 relative">
          {children}
        </main>
      </div>
    </div>
  );
}
