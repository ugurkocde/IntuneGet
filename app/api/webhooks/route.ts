/**
 * Webhooks API Routes
 * GET - List user's webhook configurations
 * POST - Create a new webhook configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { validateWebhookUrl, detectWebhookType } from '@/lib/webhooks/service';
import type {
  WebhookConfiguration,
  WebhookConfigurationInput,
} from '@/types/notifications';

/**
 * GET /api/webhooks
 * List all webhook configurations for the user
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

    // Get user's webhook configurations
    const { data: webhooks, error } = await supabase
      .from('webhook_configurations')
      .select('*')
      .eq('user_id', user.userId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch webhooks' },
        { status: 500 }
      );
    }

    // Mask secrets in response
    const sanitizedWebhooks = (webhooks || []).map((webhook: WebhookConfiguration) => ({
      ...webhook,
      secret: webhook.secret ? '********' : null,
    }));

    return NextResponse.json({ webhooks: sanitizedWebhooks });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/webhooks
 * Create a new webhook configuration
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

    // Parse request body
    const body: WebhookConfigurationInput = await request.json();

    // Validate required fields
    if (!body.name || body.name.trim().length < 1) {
      return NextResponse.json(
        { error: 'Webhook name is required' },
        { status: 400 }
      );
    }

    if (!body.url) {
      return NextResponse.json(
        { error: 'Webhook URL is required' },
        { status: 400 }
      );
    }

    // Validate URL
    const urlValidation = validateWebhookUrl(body.url);
    if (!urlValidation.valid) {
      return NextResponse.json(
        { error: urlValidation.error || 'Invalid webhook URL' },
        { status: 400 }
      );
    }

    // Auto-detect webhook type if not provided
    let webhookType = body.webhook_type;
    if (!webhookType) {
      webhookType = detectWebhookType(body.url) || 'custom';
    }

    // Validate webhook type
    if (!['slack', 'teams', 'discord', 'custom'].includes(webhookType)) {
      return NextResponse.json(
        { error: 'Invalid webhook type' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Check webhook limit (max 10 per user)
    const { count, error: countError } = await supabase
      .from('webhook_configurations')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.userId);

    if (countError) {
      return NextResponse.json(
        { error: 'Failed to create webhook' },
        { status: 500 }
      );
    }

    if (count !== null && count >= 10) {
      return NextResponse.json(
        { error: 'Maximum of 10 webhooks allowed per user' },
        { status: 400 }
      );
    }

    // Create webhook
    const { data: webhook, error } = await supabase
      .from('webhook_configurations')
      .insert({
        user_id: user.userId,
        name: body.name.trim(),
        url: body.url,
        webhook_type: webhookType,
        secret: body.secret || null,
        headers: body.headers || {},
        is_enabled: body.is_enabled ?? true,
        failure_count: 0,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to create webhook' },
        { status: 500 }
      );
    }

    // Mask secret in response
    const sanitizedWebhook = {
      ...webhook,
      secret: webhook.secret ? '********' : null,
    };

    return NextResponse.json({ webhook: sanitizedWebhook }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
