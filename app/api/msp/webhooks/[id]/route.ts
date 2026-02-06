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
import type { Database } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

// Type aliases for Supabase table types
type Tables = Database['public']['Tables'];
type MspUserMembership = Tables['msp_user_memberships']['Row'];
type MspWebhookConfiguration = Tables['msp_webhook_configurations']['Row'];
type MspWebhookConfigurationUpdate = Tables['msp_webhook_configurations']['Update'];

// Helper type for typed Supabase client operations
// Used to work around Supabase type inference limitations
type TypedSupabaseClient = SupabaseClient<Database>;

// Query result types
interface MembershipQueryResult {
  msp_organization_id: MspUserMembership['msp_organization_id'];
  role: MspUserMembership['role'];
}

interface WebhookQueryResult {
  id: MspWebhookConfiguration['id'];
  name: MspWebhookConfiguration['name'];
  url: MspWebhookConfiguration['url'];
  event_types: MspWebhookConfiguration['event_types'];
  headers: MspWebhookConfiguration['headers'];
  is_enabled: MspWebhookConfiguration['is_enabled'];
  failure_count: MspWebhookConfiguration['failure_count'];
  last_success_at: MspWebhookConfiguration['last_success_at'];
  last_failure_at: MspWebhookConfiguration['last_failure_at'];
  created_at: MspWebhookConfiguration['created_at'];
  created_by_email: MspWebhookConfiguration['created_by_email'];
}

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
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // Get user's membership
    const { data: membershipData, error: membershipError } = await supabase
      .from('msp_user_memberships')
      .select('msp_organization_id, role')
      .eq('user_id', user.userId)
      .single();

    const membership = membershipData as MembershipQueryResult | null;

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
    const { data: webhookData, error } = await supabase
      .from('msp_webhook_configurations')
      .select('id, name, url, event_types, headers, is_enabled, failure_count, last_success_at, last_failure_at, created_at, created_by_email')
      .eq('id', id)
      .eq('organization_id', membership.msp_organization_id)
      .single();

    const webhook = webhookData as WebhookQueryResult | null;

    if (error || !webhook) {
      return NextResponse.json(
        { error: 'Webhook not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ webhook });
  } catch (error) {
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
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // Get user's membership
    const { data: membershipData, error: membershipError } = await supabase
      .from('msp_user_memberships')
      .select('msp_organization_id, role')
      .eq('user_id', user.userId)
      .single();

    const membership = membershipData as MembershipQueryResult | null;

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
    const { data: existing, error: existingError } = await supabase
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

    // Update webhook - using typed client to ensure correct types
    const webhookUpdates: MspWebhookConfigurationUpdate = {
      ...(updates.name !== undefined && { name: updates.name as string }),
      ...(updates.url !== undefined && { url: updates.url as string }),
      ...(updates.event_types !== undefined && { event_types: updates.event_types as string[] }),
      ...(updates.headers !== undefined && { headers: updates.headers as Record<string, string> }),
      ...(updates.is_enabled !== undefined && { is_enabled: updates.is_enabled as boolean }),
      ...(updates.secret !== undefined && { secret: updates.secret as string }),
    };
    const typedClient = supabase as TypedSupabaseClient;
    const { data: webhookData, error: updateError } = await typedClient
      .from('msp_webhook_configurations')
      .update(webhookUpdates)
      .eq('id', id)
      .select('id, name, url, event_types, headers, is_enabled, failure_count, last_success_at, last_failure_at, created_at, created_by_email')
      .single();

    const webhook = webhookData as WebhookQueryResult | null;

    if (updateError) {
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
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // Get user's membership
    const { data: membershipData, error: membershipError } = await supabase
      .from('msp_user_memberships')
      .select('msp_organization_id, role')
      .eq('user_id', user.userId)
      .single();

    const membership = membershipData as MembershipQueryResult | null;

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
    const { data: webhookData, error: getError } = await supabase
      .from('msp_webhook_configurations')
      .select('name')
      .eq('id', id)
      .eq('organization_id', membership.msp_organization_id)
      .single();

    const webhook = webhookData as Pick<MspWebhookConfiguration, 'name'> | null;

    if (getError || !webhook) {
      return NextResponse.json(
        { error: 'Webhook not found' },
        { status: 404 }
      );
    }

    // Delete webhook
    const { error: deleteError } = await supabase
      .from('msp_webhook_configurations')
      .delete()
      .eq('id', id);

    if (deleteError) {
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
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
