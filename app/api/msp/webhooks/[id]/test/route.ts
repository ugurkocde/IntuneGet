/**
 * MSP Webhook Test API
 * POST - Send a test payload to the webhook
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { hasPermission, type MspRole } from '@/lib/msp-permissions';
import { sendTestWebhook } from '@/lib/msp/webhook-service';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/msp/webhooks/[id]/test
 * Send a test webhook delivery
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const user = parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // Get user's membership
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: membership, error: membershipError } = await (supabase as any)
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
        { error: 'You do not have permission to test webhooks' },
        { status: 403 }
      );
    }

    // Get webhook
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: webhook, error: webhookError } = await (supabase as any)
      .from('msp_webhook_configurations')
      .select('*')
      .eq('id', id)
      .eq('organization_id', membership.msp_organization_id)
      .single();

    if (webhookError || !webhook) {
      return NextResponse.json(
        { error: 'Webhook not found' },
        { status: 404 }
      );
    }

    // Send test webhook
    const result = await sendTestWebhook(webhook);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Webhook test POST error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
