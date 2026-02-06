'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Package, Upload, Clock, ArrowRight, AlertCircle, CheckCircle2, Loader2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { AdminConsentBanner } from '@/components/AdminConsentBanner';
import { useDashboardStats } from '@/hooks/useAnalytics';
import { RecentActivityList } from '@/components/dashboard';

function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function DashboardPage() {
  const { user } = useMicrosoftAuth();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const [mounted, setMounted] = useState(false);
  const [greeting, setGreeting] = useState('Welcome back');

  useEffect(() => {
    setMounted(true);
    setGreeting(getTimeBasedGreeting());
  }, []);

  return (
    <div className="space-y-8">
      {/* Welcome header */}
      <div className={mounted ? 'animate-fade-up stagger-1' : 'opacity-0'}>
        <h1 className="text-display-sm text-text-primary">
          {greeting},{' '}
          <span className="gradient-text-cyan">{user?.name?.split(' ')[0] || 'User'}</span>
        </h1>
        <p className="text-text-secondary mt-2">
          Deploy Windows applications to Intune with precision and ease
        </p>
      </div>

      {/* Admin consent banner - shows if consent hasn't been granted */}
      <AdminConsentBanner />

      {/* Stat cards with staggered animation */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Deployed"
          value={stats?.totalDeployed ?? 0}
          icon={Package}
          color="cyan"
          loading={statsLoading}
          mounted={mounted}
          delay={1}
        />
        <StatCard
          title="This Month"
          value={stats?.thisMonth ?? 0}
          icon={Upload}
          color="success"
          loading={statsLoading}
          mounted={mounted}
          delay={2}
        />
        <StatCard
          title="Pending"
          value={stats?.pending ?? 0}
          icon={Clock}
          color="warning"
          loading={statsLoading}
          mounted={mounted}
          delay={3}
        />
        <StatCard
          title="Failed"
          value={stats?.failed ?? 0}
          icon={AlertCircle}
          color="error"
          loading={statsLoading}
          mounted={mounted}
          delay={4}
        />
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quick start */}
        <div className={`glass-light rounded-xl p-6 ${mounted ? 'animate-fade-up stagger-5' : 'opacity-0'}`}>
          <div className="flex items-center gap-2 mb-6">
            <Zap className="w-5 h-5 text-accent-cyan" />
            <h2 className="text-lg font-semibold text-text-primary">Quick Start</h2>
          </div>

          {/* Timeline with gradient line */}
          <div className="relative">
            {/* Gradient connecting line */}
            <div className="absolute left-4 top-8 bottom-8 w-px bg-gradient-to-b from-accent-cyan via-accent-violet to-accent-cyan/20" />

            <div className="space-y-4">
              <QuickStartStep
                number={1}
                title="Browse the App Catalog"
                description="Search from 10,000+ Winget packages"
                href="/dashboard/apps"
              />
              <QuickStartStep
                number={2}
                title="Configure & Add to Cart"
                description="Select architecture, scope, and detection rules"
              />
              <QuickStartStep
                number={3}
                title="Deploy to Intune"
                description="One-click deployment to your tenant"
              />
            </div>
          </div>

          <Link href="/dashboard/apps">
            <Button className="w-full mt-6 bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-bg-elevated border-0 shadow-glow-cyan">
              <Package className="w-4 h-4 mr-2" />
              Browse App Catalog
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>

        {/* Recent activity */}
        <div className={`glass-light rounded-xl p-6 ${mounted ? 'animate-fade-up stagger-6' : 'opacity-0'}`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-accent-violet" />
              <h2 className="text-lg font-semibold text-text-primary">Recent Activity</h2>
            </div>
            <Link
              href="/dashboard/uploads"
              className="text-sm text-accent-cyan hover:text-accent-cyan-bright transition-colors"
            >
              View all
            </Link>
          </div>

          <RecentActivityList
            activities={stats?.recentActivity}
            loading={statsLoading}
          />
        </div>
      </div>

      {/* Intune connection status */}
      <div className={`glass-light rounded-xl p-6 border-glow-cyan ${mounted ? 'animate-fade-up animation-delay-300' : 'opacity-0'}`}>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-status-success/10 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6 text-status-success" />
          </div>
          <div className="flex-1">
            <h3 className="text-text-primary font-medium">Connected to Microsoft Intune</h3>
            <p className="text-text-secondary text-sm mt-1">
              Tenant: <span className="text-mono text-accent-cyan">{user?.tenantId || 'Not connected'}</span>
            </p>
            <p className="text-text-muted text-sm">
              Signed in as: {user?.email}
            </p>
          </div>
          <Link href="/dashboard/settings">
            <Button variant="outline" size="sm" className="border-black/10 text-text-secondary hover:bg-black/5 hover:border-accent-cyan/50">
              Settings
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  loading,
  mounted,
  delay,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  color: 'cyan' | 'success' | 'warning' | 'error';
  loading?: boolean;
  mounted?: boolean;
  delay?: number;
}) {
  const colorClasses = {
    cyan: {
      bg: 'bg-accent-cyan/10',
      text: 'text-accent-cyan',
      glow: 'group-hover:shadow-glow-cyan',
      border: 'group-hover:border-accent-cyan/30',
    },
    success: {
      bg: 'bg-status-success/10',
      text: 'text-status-success',
      glow: 'group-hover:shadow-glow-success',
      border: 'group-hover:border-status-success/30',
    },
    warning: {
      bg: 'bg-status-warning/10',
      text: 'text-status-warning',
      glow: 'group-hover:shadow-glow-warning',
      border: 'group-hover:border-status-warning/30',
    },
    error: {
      bg: 'bg-status-error/10',
      text: 'text-status-error',
      glow: 'group-hover:shadow-glow-error',
      border: 'group-hover:border-status-error/30',
    },
  };

  const classes = colorClasses[color];

  return (
    <div
      className={`group glass-light rounded-xl p-6 card-hover-light contain-layout ${mounted ? `animate-fade-up stagger-${delay}` : 'opacity-0'}`}
    >
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${classes.bg} transition-all ${classes.glow}`}>
          <Icon className={`w-6 h-6 ${classes.text}`} />
        </div>
        <div>
          {loading ? (
            <Loader2 className="w-6 h-6 text-text-secondary animate-spin" />
          ) : (
            <p className="text-2xl font-bold text-text-primary">{value}</p>
          )}
          <p className="text-text-secondary text-sm">{title}</p>
        </div>
      </div>
    </div>
  );
}

function QuickStartStep({
  number,
  title,
  description,
  href,
}: {
  number: number;
  title: string;
  description: string;
  href?: string;
}) {
  const content = (
    <div className="group relative flex items-start gap-4 p-3 rounded-lg hover:bg-black/5 transition-all cursor-pointer">
      {/* Step number with gradient */}
      <div className="relative z-10 w-8 h-8 rounded-full bg-gradient-to-br from-accent-cyan to-accent-violet text-bg-elevated flex items-center justify-center font-medium text-sm flex-shrink-0 shadow-glow-cyan">
        {number}
      </div>
      <div className="pt-0.5">
        <p className="text-text-primary font-medium group-hover:text-accent-cyan-bright transition-colors">{title}</p>
        <p className="text-text-muted text-sm">{description}</p>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}
