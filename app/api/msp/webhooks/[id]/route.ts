/**
 * MSP Webhook Details API Routes
 * GET - Get webhook details
 * PUT - Update webhook configuration
 * DELETE - Delete webhook
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

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface WebhookUpdateInput {
  name?: string;
  url?: string;
  event_types?: string[];
  headers?: Record<string, string>;
  is_enabled?: boolean;
  regenerate_secret?: boolean;
}

/**
 * GET /api/msp/webhooks/[id]
 * Get details of a specific webhook
 */
export async function GET(request: NextRequest, context: RouteContext) {
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
        { error: 'You do not have permission to view webhooks' },
        { status: 403 }
      );
    }

    // Get webhook (excluding secret)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: webhook, error } = await (supabase as any)
      .from('msp_webhook_configurations')
      .select('id, name, url, event_types, headers, is_enabled, failure_count, last_success_at, last_failure_at, created_at, created_by_email')
      .eq('id', id)
      .eq('organization_id', membership.msp_organization_id)
      .single();

    if (error || !webhook) {
      return NextResponse.json(
        { error: 'Webhook not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ webhook });
  } catch (error) {
    console.error('Webhook GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/msp/webhooks/[id]
 * Update a webhook configuration
 */
export async function PUT(request: NextRequest, context: RouteContext) {
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
        { error: 'You do not have permission to update webhooks' },
        { status: 403 }
      );
    }

    // Verify webhook exists and belongs to this org
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existing, error: existingError } = await (supabase as any)
      .from('msp_webhook_configurations')
      .select('id')
      .eq('id', id)
      .eq('organization_id', membership.msp_organization_id)
      .single();

    if (existingError || !existing) {
      return NextResponse.json(
        { error: 'Webhook not found' },
        { status: 404 }
      );
    }

    // Parse input
    const body: WebhookUpdateInput = await request.json();
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      updates.name = body.name.substring(0, 100);
    }

    if (body.url !== undefined) {
      try {
        const url = new URL(body.url);
        if (url.protocol !== 'https:') {
          return NextResponse.json(
            { error: 'Webhook URL must use HTTPS' },
            { status: 400 }
          );
        }
        updates.url = body.url;
      } catch {
        return NextResponse.json(
          { error: 'Invalid webhook URL' },
          { status: 400 }
        );
      }
    }

    if (body.event_types !== undefined) {
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

      updates.event_types = body.event_types;
    }

    if (body.headers !== undefined) {
      updates.headers = body.headers;
    }

    if (body.is_enabled !== undefined) {
      updates.is_enabled = body.is_enabled;
    }

    if (body.regenerate_secret) {
      updates.secret = generateWebhookSecret();
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      );
    }

    // Update webhook
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: webhook, error: updateError } = await (supabase as any)
      .from('msp_webhook_configurations')
      .update(updates)
      .eq('id', id)
      .select('id, name, url, event_types, headers, is_enabled, failure_count, last_success_at, last_failure_at, created_at, created_by_email')
      .single();

    if (updateError) {
      console.error('Error updating webhook:', updateError);
      return NextResponse.json(
        { error: 'Failed to update webhook' },
        { status: 500 }
      );
    }

    // Create audit log
    await createAuditLog({
      organization_id: membership.msp_organization_id,
      user_id: user.userId,
      user_email: user.userEmail,
      action: 'webhook.updated',
      resource_type: 'webhook',
      resource_id: id,
      details: updates,
    });

    return NextResponse.json({
      webhook,
      new_secret: body.regenerate_secret ? updates.secret : undefined,
    });
  } catch (error) {
    console.error('Webhook PUT error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/msp/webhooks/[id]
 * Delete a webhook configuration
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
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
        { error: 'You do not have permission to delete webhooks' },
        { status: 403 }
      );
    }

    // Get webhook name for audit log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: webhook, error: getError } = await (supabase as any)
      .from('msp_webhook_configurations')
      .select('name')
      .eq('id', id)
      .eq('organization_id', membership.msp_organization_id)
      .single();

    if (getError || !webhook) {
      return NextResponse.json(
        { error: 'Webhook not found' },
        { status: 404 }
      );
    }

    // Delete webhook
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: deleteError } = await (supabase as any)
      .from('msp_webhook_configurations')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting webhook:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete webhook' },
        { status: 500 }
      );
    }

    // Create audit log
    await createAuditLog({
      organization_id: membership.msp_organization_id,
      user_id: user.userId,
      user_email: user.userEmail,
      action: 'webhook.deleted',
      resource_type: 'webhook',
      resource_id: id,
      details: { name: webhook.name },
    });

    return NextResponse.json({
      success: true,
      message: 'Webhook deleted',
    });
  } catch (error) {
    console.error('Webhook DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
