/**
 * MSP Batch Deployments API Routes
 * GET - List batch deployments
 * POST - Create a new batch deployment
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { hasPermission, type MspRole } from '@/lib/msp-permissions';
import { createAuditLog } from '@/lib/audit-logger';

interface BatchDeploymentInput {
  winget_id: string;
  display_name: string;
  version: string;
  tenant_ids: string[];
  concurrency_limit?: number;
}

/**
 * GET /api/msp/batch-deployments
 * List batch deployments for the user's organization
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

    // Get user's membership
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

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const status = searchParams.get('status');
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('msp_batch_deployments')
      .select('*', { count: 'exact' })
      .eq('organization_id', membership.msp_organization_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && ['pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      query = query.eq('status', status as 'pending' | 'in_progress' | 'completed' | 'cancelled');
    }

    const { data: batches, error, count } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch batch deployments' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      batches: batches || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        total_pages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/msp/batch-deployments
 * Create a new batch deployment
 */
export async function POST(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // Get user's membership
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
    if (!hasPermission(membership.role as MspRole, 'batch_deploy')) {
      return NextResponse.json(
        { error: 'You do not have permission to create batch deployments' },
        { status: 403 }
      );
    }

    // Parse and validate input
    const body: BatchDeploymentInput = await request.json();

    if (!body.winget_id || !body.display_name || !body.version) {
      return NextResponse.json(
        { error: 'Missing required fields: winget_id, display_name, version' },
        { status: 400 }
      );
    }

    if (!Array.isArray(body.tenant_ids) || body.tenant_ids.length === 0) {
      return NextResponse.json(
        { error: 'At least one tenant must be selected' },
        { status: 400 }
      );
    }

    if (body.tenant_ids.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 tenants per batch deployment' },
        { status: 400 }
      );
    }

    const concurrencyLimit = Math.min(10, Math.max(1, body.concurrency_limit || 3));

    // Verify all tenant_ids belong to this organization and have consent
    const { data: tenants } = await supabase
      .from('msp_managed_tenants')
      .select('tenant_id, display_name')
      .eq('msp_organization_id', membership.msp_organization_id)
      .eq('is_active', true)
      .eq('consent_status', 'granted')
      .in('tenant_id', body.tenant_ids);

    if (!tenants || tenants.length === 0) {
      return NextResponse.json(
        { error: 'No valid tenants found with granted consent' },
        { status: 400 }
      );
    }

    const validTenantIds = new Set(tenants.filter(t => t.tenant_id !== null).map(t => t.tenant_id as string));
    const invalidTenants = body.tenant_ids.filter(id => !validTenantIds.has(id));

    if (invalidTenants.length > 0) {
      return NextResponse.json(
        { error: `Some tenants are invalid or do not have consent: ${invalidTenants.join(', ')}` },
        { status: 400 }
      );
    }

    // Create batch deployment
    const { data: batch, error: batchError } = await supabase
      .from('msp_batch_deployments')
      .insert({
        organization_id: membership.msp_organization_id,
        created_by_user_id: user.userId,
        created_by_email: user.userEmail,
        winget_id: body.winget_id,
        display_name: body.display_name,
        version: body.version,
        total_tenants: tenants.length,
        concurrency_limit: concurrencyLimit,
      })
      .select()
      .single();

    if (batchError) {
      return NextResponse.json(
        { error: 'Failed to create batch deployment' },
        { status: 500 }
      );
    }

    // Create batch deployment items
    const items = tenants
      .filter(tenant => tenant.tenant_id !== null)
      .map(tenant => ({
        batch_id: batch.id,
        tenant_id: tenant.tenant_id as string,
        tenant_display_name: tenant.display_name,
      }));

    const { error: itemsError } = await supabase
      .from('msp_batch_deployment_items')
      .insert(items);

    if (itemsError) {
      // Clean up the batch if items failed
      await supabase.from('msp_batch_deployments').delete().eq('id', batch.id);
      return NextResponse.json(
        { error: 'Failed to create batch deployment items' },
        { status: 500 }
      );
    }

    // Create audit log
    await createAuditLog({
      organization_id: membership.msp_organization_id,
      user_id: user.userId,
      user_email: user.userEmail,
      action: 'batch.deployment_started',
      resource_type: 'batch_deployment',
      resource_id: batch.id,
      details: {
        winget_id: body.winget_id,
        display_name: body.display_name,
        version: body.version,
        tenant_count: tenants.length,
      },
    });

    return NextResponse.json({
      batch: {
        ...batch,
        items: items.map((item: { tenant_id: string; tenant_display_name: string }) => ({
          ...item,
          status: 'pending',
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
