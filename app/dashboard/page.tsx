'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Package,
  Upload,
  Clock,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Zap,
  X,
  KeyRound,
  Rocket,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { AdminConsentBanner } from '@/components/AdminConsentBanner';
import { FilterPermissionNudge } from '@/components/FilterPermissionNudge';
import { useDashboardStats } from '@/hooks/useAnalytics';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { RecentActivityList, PageHeader } from '@/components/dashboard';
import { useUserSettings } from '@/components/providers/UserSettingsProvider';
import { T, Var } from 'gt-next';

function getTimeBasedGreeting(): React.ReactNode {
  const hour = new Date().getHours();
  if (hour < 12) return <T>Good morning</T>;
  if (hour < 17) return <T>Good afternoon</T>;
  return <T>Good evening</T>;
}

export default function DashboardPage() {
  const { user } = useMicrosoftAuth();
  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { errorType } = useOnboardingStatus();
  const { settings, setQuickStartDismissed } = useUserSettings();
  const [mounted, setMounted] = useState(false);
  const [greeting, setGreeting] = useState<React.ReactNode>(<T>Welcome back</T>);

  useEffect(() => {
    setMounted(true);
    setGreeting(getTimeBasedGreeting());
  }, []);

  const handleDismissQuickStart = async () => {
    await setQuickStartDismissed(true);
  };

  // Build attention items
  const attentionItems = useMemo(() => {
    const items: Array<{
      id: string;
      icon: React.ComponentType<{ className?: string }>;
      title: React.ReactNode;
      description: React.ReactNode;
      href: string;
      actionLabel: React.ReactNode;
      color: 'error' | 'warning' | 'cyan';
    }> = [];

    if (stats && stats.failed > 0) {
      items.push({
        id: 'failed-deployments',
        icon: AlertCircle,
        title: stats.failed !== 1
          ? <T><Var>{stats.failed}</Var> failed deployments</T>
          : <T><Var>{stats.failed}</Var> failed deployment</T>,
        description: <T>Review failed deployments and take action</T>,
        href: '/dashboard/uploads?status=failed',
        actionLabel: <T>View Details</T>,
        color: 'error',
      });
    }

    if (errorType === 'network_error' || errorType === 'missing_credentials') {
      items.push({
        id: 'token-warning',
        icon: KeyRound,
        title: <T>Connection issue detected</T>,
        description: errorType === 'missing_credentials'
          ? <T>Server configuration issue. Contact your administrator.</T>
          : <T>Unable to verify organization setup. Check your connection.</T>,
        href: '/dashboard/settings',
        actionLabel: <T>Settings</T>,
        color: 'warning',
      });
    }

    return items;
  }, [stats, errorType]);

  return (
    <div className="space-y-8">
      {/* Welcome header using PageHeader */}
      <PageHeader
        title={<T><Var>{greeting}</Var>, <Var>{user?.name?.split(' ')[0] || 'User'}</Var></T>}
        description={<T>Deploy Windows applications to Intune with precision and ease</T>}
        gradient
        gradientColors="cyan"
      />

      {/* Admin consent banner */}
      <AdminConsentBanner />

      {/* Non-blocking nudge to re-consent for the assignment-filters permission */}
      <FilterPermissionNudge />

      {/* Needs Attention section */}
      {attentionItems.length > 0 && (
        <div className={mounted ? 'animate-fade-up stagger-1' : 'opacity-0'}>
          <div className="space-y-3">
            {attentionItems.map((item) => {
              const colorMap = {
                error: {
                  border: 'border-l-status-error',
                  bg: 'from-status-error/5',
                  iconColor: 'text-status-error',
                },
                warning: {
                  border: 'border-l-status-warning',
                  bg: 'from-status-warning/5',
                  iconColor: 'text-status-warning',
                },
                cyan: {
                  border: 'border-l-accent-cyan',
                  bg: 'from-accent-cyan/5',
                  iconColor: 'text-accent-cyan',
                },
              };
              const colors = colorMap[item.color];
              return (
                <div
                  key={item.id}
                  className={`glass-light rounded-xl p-4 border-l-4 ${colors.border} border-t border-r border-b border-black/[0.08] bg-gradient-to-r ${colors.bg} to-transparent`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <item.icon className={`w-5 h-5 ${colors.iconColor} flex-shrink-0`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-text-primary">{item.title}</p>
                        <p className="text-xs text-text-muted">{item.description}</p>
                      </div>
                    </div>
                    <Link href={item.href}>
                      <Button size="sm" variant="ghost" className="text-text-secondary hover:text-text-primary flex-shrink-0">
                        {item.actionLabel}
                        <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                      </Button>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={<T>Total Deployed</T>}
          value={stats?.totalDeployed ?? 0}
          icon={Package}
          color="cyan"
          loading={statsLoading}
          mounted={mounted}
          delay={1}
        />
        <StatCard
          title={<T>This Month</T>}
          value={stats?.thisMonth ?? 0}
          icon={Upload}
          color="success"
          loading={statsLoading}
          mounted={mounted}
          delay={2}
        />
        <StatCard
          title={<T>Pending</T>}
          value={stats?.pending ?? 0}
          icon={Clock}
          color="warning"
          loading={statsLoading}
          mounted={mounted}
          delay={3}
          href="/dashboard/uploads?status=pending"
        />
        <StatCard
          title={<T>Failed</T>}
          value={stats?.failed ?? 0}
          icon={AlertCircle}
          color="error"
          loading={statsLoading}
          mounted={mounted}
          delay={4}
          href="/dashboard/uploads?status=failed"
        />
      </div>

      {/* Main content grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Quick start - dismissible */}
        {!settings.quickStartDismissed && (
          <div className={`glass-light rounded-xl p-6 ${mounted ? 'animate-fade-up stagger-5' : 'opacity-0'}`}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-accent-cyan" />
                <h2 className="text-lg font-semibold text-text-primary"><T>Quick Start</T></h2>
              </div>
              <button
                onClick={handleDismissQuickStart}
                className="text-text-muted hover:text-text-primary transition-colors p-1 rounded-lg hover:bg-overlay/5"
                aria-label="Dismiss Quick Start"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative">
              <div className="absolute left-4 top-8 bottom-8 w-px bg-gradient-to-b from-accent-cyan via-accent-violet to-accent-cyan/20" />

              <div className="space-y-4">
                <QuickStartStep
                  number={1}
                  title={<T>Browse the App Catalog</T>}
                  description={<T>Search from 13,000+ Winget packages</T>}
                  href="/dashboard/apps"
                />
                <QuickStartStep
                  number={2}
                  title={<T>Configure & Add to Cart</T>}
                  description={<T>Select architecture, scope, and detection rules</T>}
                />
                <QuickStartStep
                  number={3}
                  title={<T>Deploy to Intune</T>}
                  description={<T>One-click deployment to your tenant</T>}
                />
              </div>
            </div>

            <Link href="/dashboard/apps">
              <Button className="w-full mt-6 bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-bg-elevated border-0 shadow-glow-cyan">
                <Package className="w-4 h-4 mr-2" />
                <T>Browse App Catalog</T>
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        )}

        {/* Frequently deployed - shown when Quick Start is dismissed */}
        {settings.quickStartDismissed && stats?.frequentlyDeployed && stats.frequentlyDeployed.length > 0 && (
          <div className={`glass-light rounded-xl p-6 ${mounted ? 'animate-fade-up stagger-5' : 'opacity-0'}`}>
            <div className="flex items-center gap-2 mb-6">
              <Rocket className="w-5 h-5 text-accent-cyan" />
              <h2 className="text-lg font-semibold text-text-primary"><T>Frequently Deployed</T></h2>
            </div>

            <div className="space-y-3">
              {stats.frequentlyDeployed.slice(0, 5).map((app) => (
                <Link
                  key={app.winget_id}
                  href={`/dashboard/apps?search=${encodeURIComponent(app.winget_id)}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-overlay/5 transition-all group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-accent-cyan/10 flex items-center justify-center flex-shrink-0">
                      <Package className="w-4 h-4 text-accent-cyan" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate group-hover:text-accent-cyan-bright transition-colors">
                        {app.display_name}
                      </p>
                      <p className="text-xs text-text-muted"><T><Var>{app.deploy_count}</Var> deployments</T></p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="text-text-muted hover:text-accent-cyan flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                    <T>Redeploy</T>
                  </Button>
                </Link>
              ))}
            </div>

            <Link href="/dashboard/apps">
              <Button variant="ghost" className="w-full mt-4 text-text-secondary hover:text-text-primary">
                <T>Browse All Apps</T>
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </Link>
          </div>
        )}

        {/* If Quick Start dismissed but no frequent apps, show browse CTA */}
        {settings.quickStartDismissed && (!stats?.frequentlyDeployed || stats.frequentlyDeployed.length === 0) && (
          <div className={`glass-light rounded-xl p-6 flex flex-col items-center justify-center text-center ${mounted ? 'animate-fade-up stagger-5' : 'opacity-0'}`}>
            <Package className="w-10 h-10 text-accent-cyan/40 mb-3" />
            <h3 className="text-text-primary font-medium mb-1"><T>Start deploying</T></h3>
            <p className="text-text-muted text-sm mb-4"><T>Browse the App Catalog to deploy your first packages</T></p>
            <Link href="/dashboard/apps">
              <Button className="bg-gradient-to-r from-accent-cyan to-accent-violet hover:opacity-90 text-bg-elevated border-0">
                <Package className="w-4 h-4 mr-2" />
                <T>Browse App Catalog</T>
              </Button>
            </Link>
          </div>
        )}

        {/* Recent activity */}
        <div className={`glass-light rounded-xl p-6 ${mounted ? 'animate-fade-up stagger-6' : 'opacity-0'}`}>
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-accent-violet" />
              <h2 className="text-lg font-semibold text-text-primary"><T>Recent Activity</T></h2>
            </div>
            <Link
              href="/dashboard/uploads"
              className="text-sm text-accent-cyan hover:text-accent-cyan-bright transition-colors"
            >
              <T>View all</T>
            </Link>
          </div>

          <RecentActivityList
            activities={stats?.recentActivity}
            loading={statsLoading}
          />
        </div>
      </div>

      {/* Intune connection status - compact, only show when connected */}
      <div className={`glass-light rounded-xl p-4 ${mounted ? 'animate-fade-up animation-delay-300' : 'opacity-0'}`}>
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-status-success flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-text-primary text-sm font-medium"><T>Connected to Microsoft Intune</T></span>
            <span className="text-text-muted text-sm ml-2">
              {user?.email}
            </span>
          </div>
          <Link href="/dashboard/settings">
            <Button variant="ghost" size="sm" className="text-text-muted hover:text-text-primary text-xs">
              <T>Settings</T>
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
  href,
}: {
  title: React.ReactNode;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: 'cyan' | 'success' | 'warning' | 'error';
  loading?: boolean;
  mounted?: boolean;
  delay?: number;
  href?: string;
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

  const content = (
    <div
      className={`group glass-light rounded-xl p-5 card-hover-light contain-layout ${href ? 'cursor-pointer' : ''} ${mounted ? `animate-fade-up stagger-${delay}` : 'opacity-0'}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${classes.bg} transition-all ${classes.glow}`}>
          <Icon className={`w-5 h-5 ${classes.text}`} />
        </div>
        <div>
          {loading ? (
            <Loader2 className="w-5 h-5 text-text-secondary animate-spin" />
          ) : (
            <p className="text-2xl font-bold text-text-primary">{value}</p>
          )}
          <p className="text-text-secondary text-sm">{title}</p>
        </div>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href}>{content}</Link>;
  }

  return content;
}

function QuickStartStep({
  number,
  title,
  description,
  href,
}: {
  number: number;
  title: React.ReactNode;
  description: React.ReactNode;
  href?: string;
}) {
  const content = (
    <div className="group relative flex items-start gap-4 p-3 rounded-lg hover:bg-overlay/5 transition-all cursor-pointer">
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
