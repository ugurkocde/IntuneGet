/**
 * MSP Reports Analytics API
 * GET - Get analytics data for MSP dashboards
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { hasPermission, type MspRole } from '@/lib/msp-permissions';
import type { Database } from '@/types/database';

// Type aliases for Supabase query results
type MspUserMembershipRow = Database['public']['Tables']['msp_user_memberships']['Row'];
type MspManagedTenantRow = Database['public']['Tables']['msp_managed_tenants']['Row'];

// Type for membership query result
type MembershipQueryResult = Pick<MspUserMembershipRow, 'msp_organization_id' | 'role'>;

// Type for managed tenant query result (tenant_id can be null in DB but we filter for granted consent)
interface ManagedTenantQueryResult {
  tenant_id: string;
  display_name: string;
}

// Type for job query result
interface JobQueryResult {
  id: string;
  tenant_id: string | null;
  status: string;
  winget_id: string;
  display_name: string;
  created_at: string;
}

interface DeploymentsByTenant {
  tenant_id: string;
  tenant_name: string;
  total: number;
  completed: number;
  failed: number;
  pending: number;
}

interface DailyTrend {
  date: string;
  total: number;
  completed: number;
  failed: number;
}

interface TenantSuccessRate {
  tenant_id: string;
  tenant_name: string;
  success_rate: number;
  total_deployments: number;
}

interface AnalyticsResponse {
  summary: {
    total_deployments: number;
    completed_deployments: number;
    failed_deployments: number;
    pending_deployments: number;
    success_rate: number;
    total_tenants: number;
    active_tenants: number;
  };
  deployments_by_tenant: DeploymentsByTenant[];
  daily_trends: DailyTrend[];
  tenant_success_rates: TenantSuccessRate[];
  top_apps: {
    winget_id: string;
    display_name: string;
    deployment_count: number;
  }[];
}

/**
 * GET /api/msp/reports/analytics
 * Get analytics data for the user's MSP organization
 */
export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // Get user's membership and verify they belong to an organization
    const { data: membership, error: membershipError } = await supabase
      .from('msp_user_memberships')
      .select('msp_organization_id, role')
      .eq('user_id', user.userId)
      .single() as { data: MembershipQueryResult | null; error: Error | null };

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: 'MSP organization not found' },
        { status: 404 }
      );
    }

    // Check permission
    if (!hasPermission(membership.role as MspRole, 'view_dashboard')) {
      return NextResponse.json(
        { error: 'You do not have permission to view analytics' },
        { status: 403 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date') || getDefaultStartDate();
    const endDate = searchParams.get('end_date') || new Date().toISOString().split('T')[0];
    const tenantId = searchParams.get('tenant_id');

    // Get managed tenants for this organization
    const { data: tenants } = await supabase
      .from('msp_managed_tenants')
      .select('tenant_id, display_name')
      .eq('msp_organization_id', membership.msp_organization_id)
      .eq('is_active', true)
      .eq('consent_status', 'granted') as { data: ManagedTenantQueryResult[] | null };

    if (!tenants || tenants.length === 0) {
      return NextResponse.json({
        summary: {
          total_deployments: 0,
          completed_deployments: 0,
          failed_deployments: 0,
          pending_deployments: 0,
          success_rate: 0,
          total_tenants: 0,
          active_tenants: 0,
        },
        deployments_by_tenant: [],
        daily_trends: [],
        tenant_success_rates: [],
        top_apps: [],
      } as AnalyticsResponse);
    }

    // Validate tenant_id belongs to this MSP organization if specified
    if (tenantId) {
      const isManagedByOrg = tenants.some((t: ManagedTenantQueryResult) => t.tenant_id === tenantId);
      if (!isManagedByOrg) {
        return NextResponse.json(
          { error: 'Tenant not managed by your organization' },
          { status: 403 }
        );
      }
    }

    const tenantIds = tenantId
      ? [tenantId]
      : tenants.map((t: ManagedTenantQueryResult) => t.tenant_id);

    const tenantNameMap = new Map(
      tenants.map((t: ManagedTenantQueryResult) => [t.tenant_id, t.display_name])
    );

    // Get deployment stats by tenant
    const { data: jobs } = await supabase
      .from('packaging_jobs')
      .select('id, tenant_id, status, winget_id, display_name, created_at')
      .in('tenant_id', tenantIds)
      .gte('created_at', `${startDate}T00:00:00Z`)
      .lte('created_at', `${endDate}T23:59:59Z`) as { data: JobQueryResult[] | null };

    const jobsList = jobs || [];

    // Calculate summary
    const summary = {
      total_deployments: jobsList.length,
      completed_deployments: jobsList.filter((j: JobQueryResult) => j.status === 'deployed' || j.status === 'completed').length,
      failed_deployments: jobsList.filter((j: JobQueryResult) => j.status === 'failed').length,
      pending_deployments: jobsList.filter((j: JobQueryResult) =>
        ['queued', 'packaging', 'testing', 'uploading'].includes(j.status)
      ).length,
      success_rate: 0,
      total_tenants: tenants.length,
      active_tenants: new Set(jobsList.filter((j: JobQueryResult) => j.tenant_id).map((j: JobQueryResult) => j.tenant_id)).size,
    };

    const finishedJobs = summary.completed_deployments + summary.failed_deployments;
    summary.success_rate = finishedJobs > 0
      ? Math.round((summary.completed_deployments / finishedJobs) * 100)
      : 0;

    // Calculate deployments by tenant
    const tenantStats = new Map<string, DeploymentsByTenant>();
    for (const tenant of tenants) {
      tenantStats.set(tenant.tenant_id, {
        tenant_id: tenant.tenant_id,
        tenant_name: tenant.display_name,
        total: 0,
        completed: 0,
        failed: 0,
        pending: 0,
      });
    }

    for (const job of jobsList) {
      if (!job.tenant_id) continue;
      const stat = tenantStats.get(job.tenant_id);
      if (stat) {
        stat.total++;
        if (job.status === 'deployed' || job.status === 'completed') {
          stat.completed++;
        } else if (job.status === 'failed') {
          stat.failed++;
        } else {
          stat.pending++;
        }
      }
    }

    const deploymentsByTenant = Array.from(tenantStats.values())
      .filter(t => t.total > 0)
      .sort((a, b) => b.total - a.total);

    // Calculate daily trends
    const dailyStats = new Map<string, DailyTrend>();
    for (const job of jobsList) {
      const date = job.created_at.split('T')[0];
      if (!dailyStats.has(date)) {
        dailyStats.set(date, { date, total: 0, completed: 0, failed: 0 });
      }
      const stat = dailyStats.get(date)!;
      stat.total++;
      if (job.status === 'deployed' || job.status === 'completed') {
        stat.completed++;
      } else if (job.status === 'failed') {
        stat.failed++;
      }
    }

    const dailyTrends = Array.from(dailyStats.values())
      .sort((a, b) => a.date.localeCompare(b.date));

    // Calculate tenant success rates
    const tenantSuccessRates: TenantSuccessRate[] = deploymentsByTenant
      .filter(t => t.completed + t.failed > 0)
      .map(t => ({
        tenant_id: t.tenant_id,
        tenant_name: t.tenant_name,
        success_rate: Math.round((t.completed / (t.completed + t.failed)) * 100),
        total_deployments: t.total,
      }))
      .sort((a, b) => b.success_rate - a.success_rate);

    // Calculate top apps
    const appCounts = new Map<string, { winget_id: string; display_name: string; count: number }>();
    for (const job of jobsList) {
      const key = job.winget_id;
      if (!appCounts.has(key)) {
        appCounts.set(key, { winget_id: key, display_name: job.display_name, count: 0 });
      }
      appCounts.get(key)!.count++;
    }

    const topApps = Array.from(appCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(a => ({
        winget_id: a.winget_id,
        display_name: a.display_name,
        deployment_count: a.count,
      }));

    return NextResponse.json({
      summary,
      deployments_by_tenant: deploymentsByTenant,
      daily_trends: dailyTrends,
      tenant_success_rates: tenantSuccessRates,
      top_apps: topApps,
    } as AnalyticsResponse);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function getDefaultStartDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().split('T')[0];
}
