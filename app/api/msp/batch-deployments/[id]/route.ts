/**
 * MSP Batch Deployment Details API Routes
 * GET - Get batch deployment details
 * DELETE - Cancel a batch deployment
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { hasPermission, type MspRole } from '@/lib/msp-permissions';
import { createAuditLog } from '@/lib/audit-logger';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/msp/batch-deployments/[id]
 * Get details of a specific batch deployment
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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

    // Get batch deployment
    const { data: batch, error: batchError } = await supabase
      .from('msp_batch_deployments')
      .select('*')
      .eq('id', id)
      .eq('organization_id', membership.msp_organization_id)
      .single();

    if (batchError || !batch) {
      return NextResponse.json(
        { error: 'Batch deployment not found' },
        { status: 404 }
      );
    }

    // Get batch deployment items
    const { data: items } = await supabase
      .from('msp_batch_deployment_items')
      .select('*')
      .eq('batch_id', id)
      .order('tenant_display_name', { ascending: true });

    return NextResponse.json({
      batch: {
        ...batch,
        items: items || [],
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
 * DELETE /api/msp/batch-deployments/[id]
 * Cancel a batch deployment
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
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
        { error: 'You do not have permission to cancel batch deployments' },
        { status: 403 }
      );
    }

    // Get batch deployment
    const { data: batch, error: batchError } = await supabase
      .from('msp_batch_deployments')
      .select('*')
      .eq('id', id)
      .eq('organization_id', membership.msp_organization_id)
      .single();

    if (batchError || !batch) {
      return NextResponse.json(
        { error: 'Batch deployment not found' },
        { status: 404 }
      );
    }

    // Check if batch can be cancelled
    if (batch.status === 'completed' || batch.status === 'cancelled') {
      return NextResponse.json(
        { error: 'Batch deployment cannot be cancelled in its current state' },
        { status: 400 }
      );
    }

    // Update batch status
    const { error: updateError } = await supabase
      .from('msp_batch_deployments')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by_email: user.userEmail,
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to cancel batch deployment' },
        { status: 500 }
      );
    }

    // Update pending items to skipped
    await supabase
      .from('msp_batch_deployment_items')
      .update({ status: 'skipped' })
      .eq('batch_id', id)
      .eq('status', 'pending');

    // Create audit log
    await createAuditLog({
      organization_id: membership.msp_organization_id,
      user_id: user.userId,
      user_email: user.userEmail,
      action: 'batch.deployment_cancelled',
      resource_type: 'batch_deployment',
      resource_id: id,
      details: {
        winget_id: batch.winget_id,
        display_name: batch.display_name,
        completed_tenants: batch.completed_tenants,
        total_tenants: batch.total_tenants,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Batch deployment cancelled',
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
