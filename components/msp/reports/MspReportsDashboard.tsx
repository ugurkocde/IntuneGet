'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useMicrosoftAuth } from '@/hooks/useMicrosoftAuth';
import { useMsp } from '@/contexts/MspContext';
import { DeploymentsByTenantChart } from './DeploymentsByTenantChart';
import { TenantSuccessRateChart } from './TenantSuccessRateChart';
import { CrossTenantTrendChart } from './CrossTenantTrendChart';
import { MspExportOptions } from './MspExportOptions';
import {
  BarChart3,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  Building2,
  Loader2,
  Package,
} from 'lucide-react';

interface AnalyticsData {
  summary: {
    total_deployments: number;
    completed_deployments: number;
    failed_deployments: number;
    pending_deployments: number;
    success_rate: number;
    total_tenants: number;
    active_tenants: number;
  };
  deployments_by_tenant: Array<{
    tenant_id: string;
    tenant_name: string;
    total: number;
    completed: number;
    failed: number;
    pending: number;
  }>;
  daily_trends: Array<{
    date: string;
    total: number;
    completed: number;
    failed: number;
  }>;
  tenant_success_rates: Array<{
    tenant_id: string;
    tenant_name: string;
    success_rate: number;
    total_deployments: number;
  }>;
  top_apps: Array<{
    winget_id: string;
    display_name: string;
    deployment_count: number;
  }>;
}

interface DateRange {
  label: string;
  startDate: string;
  endDate: string;
}

function getDateRanges(): DateRange[] {
  const today = new Date();
  const endDate = today.toISOString().split('T')[0];

  const last7Days = new Date(today);
  last7Days.setDate(last7Days.getDate() - 7);

  const last30Days = new Date(today);
  last30Days.setDate(last30Days.getDate() - 30);

  const last90Days = new Date(today);
  last90Days.setDate(last90Days.getDate() - 90);

  return [
    { label: 'Last 7 days', startDate: last7Days.toISOString().split('T')[0], endDate },
    { label: 'Last 30 days', startDate: last30Days.toISOString().split('T')[0], endDate },
    { label: 'Last 90 days', startDate: last90Days.toISOString().split('T')[0], endDate },
  ];
}

export function MspReportsDashboard() {
  const { getAccessToken, isAuthenticated } = useMicrosoftAuth();
  const { managedTenants } = useMsp();
  const dateRanges = useMemo(() => getDateRanges(), []);
  const [selectedRange, setSelectedRange] = useState<DateRange>(dateRanges[1]); // Default to 30 days
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');

  const activeTenants = useMemo(
    () => managedTenants.filter((t) => t.is_active && t.consent_status === 'granted'),
    [managedTenants]
  );

  const { data, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ['msp-analytics', selectedRange.startDate, selectedRange.endDate, selectedTenantId],
    queryFn: async () => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const params = new URLSearchParams({
        start_date: selectedRange.startDate,
        end_date: selectedRange.endDate,
      });

      if (selectedTenantId) {
        params.set('tenant_id', selectedTenantId);
      }

      const response = await fetch(`/api/msp/reports/analytics?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch analytics');
      }

      return response.json();
    },
    enabled: isAuthenticated,
    staleTime: 60 * 1000, // 1 minute
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-accent-cyan animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 rounded-xl glass-light border border-red-500/20 text-center">
        <XCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <p className="text-sm text-red-400">Failed to load analytics data</p>
      </div>
    );
  }

  const summary = data?.summary || {
    total_deployments: 0,
    completed_deployments: 0,
    failed_deployments: 0,
    pending_deployments: 0,
    success_rate: 0,
    total_tenants: 0,
    active_tenants: 0,
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {/* Date range selector */}
          <div className="flex rounded-lg overflow-hidden border border-black/10">
            {dateRanges.map((range) => (
              <button
                key={range.label}
                onClick={() => setSelectedRange(range)}
                className={`px-3 py-1.5 text-sm transition-colors ${
                  selectedRange.label === range.label
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'bg-transparent text-text-secondary hover:text-text-primary hover:bg-black/5'
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          {/* Tenant filter */}
          {activeTenants.length > 1 && (
            <select
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-lg border border-black/10 bg-transparent text-text-primary focus:outline-none focus:border-accent-cyan"
            >
              <option value="">All tenants</option>
              {activeTenants.map((tenant) => (
                <option key={tenant.id} value={tenant.tenant_id || ''}>
                  {tenant.display_name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Export */}
        <MspExportOptions
          startDate={selectedRange.startDate}
          endDate={selectedRange.endDate}
          tenantId={selectedTenantId || undefined}
        />
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={BarChart3}
          label="Total Deployments"
          value={summary.total_deployments}
          color="text-accent-cyan"
        />
        <StatCard
          icon={CheckCircle2}
          label="Completed"
          value={summary.completed_deployments}
          color="text-emerald-400"
          subtitle={`${summary.success_rate}% success rate`}
        />
        <StatCard
          icon={XCircle}
          label="Failed"
          value={summary.failed_deployments}
          color="text-red-400"
        />
        <StatCard
          icon={Building2}
          label="Active Tenants"
          value={summary.active_tenants}
          color="text-accent-violet"
          subtitle={`of ${summary.total_tenants} total`}
        />
      </div>

      {/* Charts Grid */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Deployments Over Time */}
        <div className="p-6 rounded-xl glass-light border border-black/5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-accent-cyan" />
            <h3 className="text-lg font-medium text-text-primary">Deployment Trends</h3>
          </div>
          <CrossTenantTrendChart data={data?.daily_trends || []} />
        </div>

        {/* Deployments by Tenant */}
        <div className="p-6 rounded-xl glass-light border border-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Building2 className="w-5 h-5 text-accent-violet" />
            <h3 className="text-lg font-medium text-text-primary">Deployments by Tenant</h3>
          </div>
          <DeploymentsByTenantChart data={data?.deployments_by_tenant || []} />
        </div>

        {/* Success Rate by Tenant */}
        <div className="p-6 rounded-xl glass-light border border-black/5">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <h3 className="text-lg font-medium text-text-primary">Success Rate by Tenant</h3>
          </div>
          <TenantSuccessRateChart data={data?.tenant_success_rates || []} />
        </div>

        {/* Top Apps */}
        <div className="p-6 rounded-xl glass-light border border-black/5">
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-medium text-text-primary">Top Deployed Apps</h3>
          </div>
          <div className="space-y-3">
            {data?.top_apps && data.top_apps.length > 0 ? (
              data.top_apps.slice(0, 8).map((app, index) => (
                <div
                  key={app.winget_id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-black/5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-medium text-text-muted w-6">
                      #{index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {app.display_name}
                      </p>
                      <p className="text-xs text-text-muted truncate">{app.winget_id}</p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-accent-cyan flex-shrink-0 ml-2">
                    {app.deployment_count}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-text-muted">
                No deployment data available
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: string;
  subtitle?: string;
}

function StatCard({ icon: Icon, label, value, color, subtitle }: StatCardProps) {
  return (
    <div className="p-4 rounded-xl glass-light border border-black/5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-text-muted">{label}</span>
      </div>
      <p className="text-2xl font-bold text-text-primary">{value.toLocaleString()}</p>
      {subtitle && <p className="text-xs text-text-muted mt-1">{subtitle}</p>}
    </div>
  );
}
