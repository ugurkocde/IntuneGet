/**
 * MSP Webhook Deliveries API
 * GET - List delivery history for a webhook
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { hasPermission, type MspRole } from '@/lib/msp-permissions';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/msp/webhooks/[id]/deliveries
 * Get delivery history for a webhook
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

    // Check permission
    if (!hasPermission(membership.role as MspRole, 'manage_policies')) {
      return NextResponse.json(
        { error: 'You do not have permission to view webhook deliveries' },
        { status: 403 }
      );
    }

    // Verify webhook exists and belongs to this org
    const { data: webhook, error: webhookError } = await supabase
      .from('msp_webhook_configurations')
      .select('id')
      .eq('id', id)
      .eq('organization_id', membership.msp_organization_id)
      .single();

    if (webhookError || !webhook) {
      return NextResponse.json(
        { error: 'Webhook not found' },
        { status: 404 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

    // Get deliveries
    const { data: deliveries, error } = await supabase
      .from('msp_webhook_deliveries')
      .select('id, event_type, status, attempts, response_status, error_message, created_at, delivered_at')
      .eq('webhook_id', id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch deliveries' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      deliveries: deliveries || [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
