/**
 * MSP Webhooks API Routes
 * GET - List webhook configurations
 * POST - Create a new webhook configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { hasPermission, type MspRole } from '@/lib/msp-permissions';
import { createAuditLog } from '@/lib/audit-logger';
import { generateWebhookSecret } from '@/lib/msp/webhook-signatures';

const VALID_EVENT_TYPES = [
  'deployment.completed',
  'deployment.failed',
  'batch.completed',
  'member.joined',
  'member.removed',
  'consent.granted',
  'consent.expired',
  'consent.revoked',
];

interface WebhookInput {
  name: string;
  url: string;
  event_types: string[];
  headers?: Record<string, string>;
  generate_secret?: boolean;
}

/**
 * GET /api/msp/webhooks
 * List webhook configurations for the user's organization
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

    // Check permission (at least admin to manage webhooks)
    if (!hasPermission(membership.role as MspRole, 'manage_policies')) {
      return NextResponse.json(
        { error: 'You do not have permission to view webhooks' },
        { status: 403 }
      );
    }

    // Get webhooks
    const { data: webhooks, error } = await supabase
      .from('msp_webhook_configurations')
      .select('id, name, url, event_types, headers, is_enabled, failure_count, last_success_at, last_failure_at, created_at, created_by_email')
      .eq('organization_id', membership.msp_organization_id)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch webhooks' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      webhooks: webhooks || [],
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/msp/webhooks
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
        { error: 'You do not have permission to create webhooks' },
        { status: 403 }
      );
    }

    // Check webhook limit (max 5 per organization)
    const { count: existingCount } = await supabase
      .from('msp_webhook_configurations')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', membership.msp_organization_id);

    if (existingCount !== null && existingCount >= 5) {
      return NextResponse.json(
        { error: 'Maximum 5 webhooks per organization' },
        { status: 400 }
      );
    }

    // Parse and validate input
    const body: WebhookInput = await request.json();

    if (!body.name || !body.url) {
      return NextResponse.json(
        { error: 'Missing required fields: name, url' },
        { status: 400 }
      );
    }

    // Validate URL
    try {
      const url = new URL(body.url);
      if (url.protocol !== 'https:') {
        return NextResponse.json(
          { error: 'Webhook URL must use HTTPS' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid webhook URL' },
        { status: 400 }
      );
    }

    // Validate event types
    if (!Array.isArray(body.event_types) || body.event_types.length === 0) {
      return NextResponse.json(
        { error: 'At least one event type must be selected' },
        { status: 400 }
      );
    }

    const invalidEventTypes = body.event_types.filter(et => !VALID_EVENT_TYPES.includes(et));
    if (invalidEventTypes.length > 0) {
      return NextResponse.json(
        { error: `Invalid event types: ${invalidEventTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Generate secret if requested
    const secret = body.generate_secret ? generateWebhookSecret() : null;

    // Create webhook
    const { data: webhook, error: createError } = await supabase
      .from('msp_webhook_configurations')
      .insert({
        organization_id: membership.msp_organization_id,
        name: body.name.substring(0, 100),
        url: body.url,
        secret,
        event_types: body.event_types,
        headers: body.headers || {},
        created_by_email: user.userEmail,
      })
      .select()
      .single();

    if (createError) {
      return NextResponse.json(
        { error: 'Failed to create webhook' },
        { status: 500 }
      );
    }

    // Create audit log
    await createAuditLog({
      organization_id: membership.msp_organization_id,
      user_id: user.userId,
      user_email: user.userEmail,
      action: 'webhook.created',
      resource_type: 'webhook',
      resource_id: webhook.id,
      details: {
        name: body.name,
        url: body.url,
        event_types: body.event_types,
      },
    });

    // Return webhook without secret (or with if newly generated)
    return NextResponse.json({
      webhook: {
        ...webhook,
        secret: secret, // Only include secret on creation
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
