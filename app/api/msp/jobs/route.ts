/**
 * MSP Jobs API Route
 * GET - List packaging jobs across all managed tenants
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import type { MspJob, GetMspJobsResponse } from '@/types/msp';

/**
 * GET /api/msp/jobs
 * List jobs across all managed tenants for the user's MSP organization
 */
export async function GET(request: NextRequest) {
  try {
    const user = parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const tenantId = searchParams.get('tenantId'); // Optional: filter by specific tenant
    const status = searchParams.get('status'); // Optional: filter by status
    const offset = (page - 1) * limit;

    const supabase = createServerClient();

    // Get user's MSP organization membership (only for active organizations)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: membership } = await (supabase as any)
      .from('msp_user_memberships')
      .select('msp_organization_id, msp_organizations!inner(is_active)')
      .eq('user_id', user.userId)
      .eq('msp_organizations.is_active', true)
      .single();

    if (!membership) {
      return NextResponse.json(
        { error: 'Not a member of any MSP organization' },
        { status: 403 }
      );
    }

    const mspOrgId = membership.msp_organization_id;

    // Get all managed tenant IDs for this MSP
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: managedTenants } = await (supabase as any)
      .from('msp_managed_tenants')
      .select('tenant_id, display_name')
      .eq('msp_organization_id', mspOrgId)
      .eq('is_active', true)
      .eq('consent_status', 'granted')
      .not('tenant_id', 'is', null);

    if (!managedTenants || managedTenants.length === 0) {
      const response: GetMspJobsResponse = {
        jobs: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      };
      return NextResponse.json(response);
    }

    // Create a map of tenant ID to display name
    const tenantNameMap: Record<string, string> = {};
    const tenantIds: string[] = [];

    for (const t of managedTenants) {
      if (t.tenant_id) {
        tenantIds.push(t.tenant_id);
        tenantNameMap[t.tenant_id] = t.display_name;
      }
    }

    // If filtering by specific tenant, verify it's in the managed list
    if (tenantId) {
      if (!tenantIds.includes(tenantId)) {
        return NextResponse.json(
          { error: 'Tenant not managed by this organization' },
          { status: 403 }
        );
      }
    }

    // Build the query for jobs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('packaging_jobs')
      .select('*', { count: 'exact' })
      .in('tenant_id', tenantId ? [tenantId] : tenantIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Add status filter if provided
    if (status) {
      query = query.eq('status', status);
    }

    const { data: jobs, error: jobsError, count } = await query;

    if (jobsError) {
      console.error('Error fetching jobs:', jobsError);
      return NextResponse.json(
        { error: 'Failed to fetch jobs' },
        { status: 500 }
      );
    }

    // Map jobs to MSP job format with tenant display names
    const mspJobs: MspJob[] = (jobs || []).map((job: {
      id: string;
      tenant_id: string;
      winget_id: string;
      display_name: string;
      publisher: string | null;
      version: string;
      status: string;
      status_message: string | null;
      progress_percent: number;
      error_message: string | null;
      intune_app_id: string | null;
      intune_app_url: string | null;
      created_at: string;
      updated_at: string;
      completed_at: string | null;
    }) => ({
      id: job.id,
      tenant_id: job.tenant_id,
      tenant_display_name: tenantNameMap[job.tenant_id] || 'Unknown Tenant',
      winget_id: job.winget_id,
      display_name: job.display_name,
      publisher: job.publisher,
      version: job.version,
      status: job.status,
      status_message: job.status_message,
      progress_percent: job.progress_percent,
      error_message: job.error_message,
      intune_app_id: job.intune_app_id,
      intune_app_url: job.intune_app_url,
      created_at: job.created_at,
      updated_at: job.updated_at,
      completed_at: job.completed_at,
    }));

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    const response: GetMspJobsResponse = {
      jobs: mspJobs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('MSP jobs GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
