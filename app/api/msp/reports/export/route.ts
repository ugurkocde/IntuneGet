/**
 * MSP Reports Export API
 * GET - Export analytics data as CSV
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { hasPermission, type MspRole } from '@/lib/msp-permissions';

/**
 * GET /api/msp/reports/export
 * Export deployment data as CSV for the user's MSP organization
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
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: 'MSP organization not found' },
        { status: 404 }
      );
    }

    // Check permission
    if (!hasPermission(membership.role as MspRole, 'export_reports')) {
      return NextResponse.json(
        { error: 'You do not have permission to export reports' },
        { status: 403 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date') || getDefaultStartDate();
    const endDate = searchParams.get('end_date') || new Date().toISOString().split('T')[0];
    const tenantId = searchParams.get('tenant_id');
    const format = searchParams.get('format') || 'csv';

    if (format !== 'csv') {
      return NextResponse.json(
        { error: 'Only CSV format is currently supported' },
        { status: 400 }
      );
    }

    // Get managed tenants for this organization
    const { data: tenants } = await supabase
      .from('msp_managed_tenants')
      .select('tenant_id, display_name')
      .eq('msp_organization_id', membership.msp_organization_id)
      .eq('is_active', true)
      .eq('consent_status', 'granted');

    if (!tenants || tenants.length === 0) {
      return new Response('No data to export', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
        },
      });
    }

    // Validate tenant_id belongs to this MSP organization if specified
    if (tenantId) {
      const isManagedByOrg = tenants.some(t => t.tenant_id === tenantId);
      if (!isManagedByOrg) {
        return NextResponse.json(
          { error: 'Tenant not managed by your organization' },
          { status: 403 }
        );
      }
    }

    const tenantIds = tenantId
      ? [tenantId]
      : tenants.filter(t => t.tenant_id !== null).map(t => t.tenant_id as string);

    const tenantNameMap = new Map(
      tenants.filter(t => t.tenant_id !== null).map(t => [t.tenant_id as string, t.display_name])
    );

    // Get deployment data
    const { data: jobs } = await supabase
      .from('packaging_jobs')
      .select('id, tenant_id, winget_id, display_name, version, status, created_at, completed_at, error_message')
      .in('tenant_id', tenantIds)
      .gte('created_at', `${startDate}T00:00:00Z`)
      .lte('created_at', `${endDate}T23:59:59Z`)
      .order('created_at', { ascending: false })
      .limit(5000); // Limit export to 5000 rows

    const jobsList = jobs || [];

    // Generate CSV
    const headers = [
      'Job ID',
      'Tenant Name',
      'Package ID',
      'Package Name',
      'Version',
      'Status',
      'Created At',
      'Completed At',
      'Error Message',
    ];

    const rows = jobsList.map(job => [
      job.id,
      tenantNameMap.get(job.tenant_id || '') || job.tenant_id || '',
      job.winget_id,
      job.display_name,
      job.version,
      job.status,
      job.created_at,
      job.completed_at || '',
      job.error_message || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row: string[]) =>
        row.map((cell: string) => {
          // Escape cells that contain commas, quotes, or newlines
          const str = String(cell);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        }).join(',')
      ),
    ].join('\n');

    const filename = `msp-deployments-${startDate}-to-${endDate}.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
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
