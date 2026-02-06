/**
 * Webhook Test API Route
 * POST - Send a test payload to a webhook
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { sendTestWebhook } from '@/lib/webhooks/service';
import type { WebhookConfiguration } from '@/types/notifications';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/webhooks/[id]/test
 * Send a test payload to the webhook
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { id } = await params;

    const supabase = createServerClient();

    // Get webhook configuration
    const { data: webhook, error: fetchError } = await supabase
      .from('webhook_configurations')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.userId)
      .single();

    if (fetchError || !webhook) {
      return NextResponse.json(
        { error: 'Webhook not found' },
        { status: 404 }
      );
    }

    // Send test webhook
    const result = await sendTestWebhook(webhook as WebhookConfiguration);

    // Update webhook status based on result
    const statusUpdate: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (result.success) {
      statusUpdate.last_success_at = new Date().toISOString();
      statusUpdate.failure_count = 0;
    } else {
      statusUpdate.last_failure_at = new Date().toISOString();
      statusUpdate.failure_count = (webhook.failure_count || 0) + 1;
    }

    await supabase
      .from('webhook_configurations')
      .update(statusUpdate)
      .eq('id', id);

    return NextResponse.json({
      success: result.success,
      statusCode: result.statusCode,
      error: result.error,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
