/**
 * Audit Logger
 * Utility for logging MSP organization actions
 */

import { createServerClient } from '@/lib/supabase';

// ============================================
// Types
// ============================================

export type AuditAction =
  // Tenant actions
  | 'tenant.created'
  | 'tenant.removed'
  | 'tenant.consent_granted'
  | 'tenant.consent_revoked'
  | 'tenant.updated'
  // Deployment actions
  | 'deployment.started'
  | 'deployment.completed'
  | 'deployment.failed'
  | 'deployment.cancelled'
  // Member actions
  | 'member.invited'
  | 'member.joined'
  | 'member.removed'
  | 'member.role_changed'
  // Organization actions
  | 'organization.created'
  | 'organization.updated'
  | 'organization.settings_updated'
  // Batch operations
  | 'batch.deployment_started'
  | 'batch.deployment_completed'
  | 'batch.deployment_failed'
  | 'batch.deployment_cancelled'
  // Webhook actions
  | 'webhook.created'
  | 'webhook.updated'
  | 'webhook.deleted'
  | 'webhook.tested';

export type ResourceType =
  | 'tenant'
  | 'member'
  | 'invitation'
  | 'deployment'
  | 'organization'
  | 'policy'
  | 'batch'
  | 'batch_deployment'
  | 'webhook';

export interface AuditLogEntry {
  organization_id: string;
  user_id: string;
  user_email: string;
  action: AuditAction;
  resource_type?: ResourceType;
  resource_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
}

export interface AuditLogRecord extends AuditLogEntry {
  id: string;
  created_at: string;
}

// Database row type - action comes as string from DB
interface AuditLogDbRow {
  id: string;
  organization_id: string;
  user_id: string;
  user_email: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// ============================================
// Logging Functions
// ============================================

/**
 * Create an audit log entry
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    const supabase = createServerClient();

    const { error } = await supabase
      .from('msp_audit_logs')
      .insert({
        organization_id: entry.organization_id,
        user_id: entry.user_id,
        user_email: entry.user_email,
        action: entry.action,
        resource_type: entry.resource_type || null,
        resource_id: entry.resource_id || null,
        details: entry.details || null,
        ip_address: entry.ip_address || null,
        user_agent: entry.user_agent ? entry.user_agent.substring(0, 500) : null,
      });

    if (error) {
      console.error('Failed to create audit log:', error);
    }
  } catch (error) {
    // Don't throw - audit logging should not break main functionality
    console.error('Audit logging error:', error);
  }
}

/**
 * Helper to extract request metadata
 */
export function getRequestMetadata(request: Request): {
  ip_address?: string;
  user_agent?: string;
} {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip_address = forwarded ? forwarded.split(',')[0].trim() : undefined;
  const user_agent = request.headers.get('user-agent') || undefined;

  return { ip_address, user_agent };
}

// ============================================
// Action-Specific Loggers
// ============================================

interface AuditContext {
  organization_id: string;
  user_id: string;
  user_email: string;
  ip_address?: string;
  user_agent?: string;
}

/**
 * Log tenant creation
 */
export async function logTenantCreated(
  ctx: AuditContext,
  tenantId: string,
  displayName: string
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'tenant.created',
    resource_type: 'tenant',
    resource_id: tenantId,
    details: { display_name: displayName },
  });
}

/**
 * Log tenant removal
 */
export async function logTenantRemoved(
  ctx: AuditContext,
  tenantId: string,
  displayName: string
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'tenant.removed',
    resource_type: 'tenant',
    resource_id: tenantId,
    details: { display_name: displayName },
  });
}

/**
 * Log consent granted
 */
export async function logConsentGranted(
  ctx: AuditContext,
  tenantId: string,
  tenantName: string
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'tenant.consent_granted',
    resource_type: 'tenant',
    resource_id: tenantId,
    details: { tenant_name: tenantName },
  });
}

/**
 * Log member invited
 */
export async function logMemberInvited(
  ctx: AuditContext,
  invitationId: string,
  email: string,
  role: string
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'member.invited',
    resource_type: 'invitation',
    resource_id: invitationId,
    details: { invited_email: email, role },
  });
}

/**
 * Log member joined
 */
export async function logMemberJoined(
  ctx: AuditContext,
  memberId: string,
  role: string,
  invitedBy: string
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'member.joined',
    resource_type: 'member',
    resource_id: memberId,
    details: { role, invited_by: invitedBy },
  });
}

/**
 * Log member removed
 */
export async function logMemberRemoved(
  ctx: AuditContext,
  memberId: string,
  removedEmail: string
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'member.removed',
    resource_type: 'member',
    resource_id: memberId,
    details: { removed_email: removedEmail },
  });
}

/**
 * Log role change
 */
export async function logRoleChanged(
  ctx: AuditContext,
  memberId: string,
  memberEmail: string,
  oldRole: string,
  newRole: string
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'member.role_changed',
    resource_type: 'member',
    resource_id: memberId,
    details: {
      member_email: memberEmail,
      old_role: oldRole,
      new_role: newRole,
    },
  });
}

/**
 * Log deployment started
 */
export async function logDeploymentStarted(
  ctx: AuditContext,
  jobId: string,
  wingetId: string,
  tenantId: string
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'deployment.started',
    resource_type: 'deployment',
    resource_id: jobId,
    details: { winget_id: wingetId, tenant_id: tenantId },
  });
}

/**
 * Log deployment completed
 */
export async function logDeploymentCompleted(
  ctx: AuditContext,
  jobId: string,
  wingetId: string,
  intuneAppId: string
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'deployment.completed',
    resource_type: 'deployment',
    resource_id: jobId,
    details: { winget_id: wingetId, intune_app_id: intuneAppId },
  });
}

/**
 * Log deployment failed
 */
export async function logDeploymentFailed(
  ctx: AuditContext,
  jobId: string,
  wingetId: string,
  errorMessage: string
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'deployment.failed',
    resource_type: 'deployment',
    resource_id: jobId,
    details: { winget_id: wingetId, error: errorMessage },
  });
}

/**
 * Log batch deployment started
 */
export async function logBatchDeploymentStarted(
  ctx: AuditContext,
  batchId: string,
  wingetId: string,
  tenantCount: number
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'batch.deployment_started',
    resource_type: 'batch',
    resource_id: batchId,
    details: { winget_id: wingetId, tenant_count: tenantCount },
  });
}

/**
 * Log batch deployment completed
 */
export async function logBatchDeploymentCompleted(
  ctx: AuditContext,
  batchId: string,
  wingetId: string,
  completedTenants: number,
  failedTenants: number
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'batch.deployment_completed',
    resource_type: 'batch_deployment',
    resource_id: batchId,
    details: {
      winget_id: wingetId,
      completed_tenants: completedTenants,
      failed_tenants: failedTenants,
    },
  });
}

/**
 * Log batch deployment failed (all items failed)
 */
export async function logBatchDeploymentFailed(
  ctx: AuditContext,
  batchId: string,
  wingetId: string,
  failedTenants: number
): Promise<void> {
  await createAuditLog({
    ...ctx,
    action: 'batch.deployment_failed',
    resource_type: 'batch_deployment',
    resource_id: batchId,
    details: {
      winget_id: wingetId,
      failed_tenants: failedTenants,
    },
  });
}

// ============================================
// Query Functions
// ============================================

export interface AuditLogQuery {
  organization_id: string;
  page?: number;
  limit?: number;
  action?: string;
  resource_type?: string;
  user_id?: string;
  start_date?: string;
  end_date?: string;
}

export interface AuditLogResult {
  logs: AuditLogRecord[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
}

/**
 * Query audit logs with filters and pagination
 */
export async function queryAuditLogs(query: AuditLogQuery): Promise<AuditLogResult> {
  const supabase = createServerClient();

  const page = query.page || 1;
  const limit = Math.min(query.limit || 50, 100);
  const offset = (page - 1) * limit;

  let dbQuery = supabase
    .from('msp_audit_logs')
    .select('*', { count: 'exact' })
    .eq('organization_id', query.organization_id);

  if (query.action) {
    dbQuery = dbQuery.eq('action', query.action);
  }

  if (query.resource_type) {
    dbQuery = dbQuery.eq('resource_type', query.resource_type);
  }

  if (query.user_id) {
    dbQuery = dbQuery.eq('user_id', query.user_id);
  }

  if (query.start_date) {
    dbQuery = dbQuery.gte('created_at', query.start_date);
  }

  if (query.end_date) {
    dbQuery = dbQuery.lte('created_at', query.end_date);
  }

  dbQuery = dbQuery
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data: logs, error, count } = await dbQuery;

  if (error) {
    console.error('Error querying audit logs:', error);
    throw new Error('Failed to query audit logs');
  }

  // Map database rows to typed records
  // The action field is stored as string in DB but we know it's a valid AuditAction
  const typedLogs: AuditLogRecord[] = ((logs || []) as AuditLogDbRow[]).map((row) => ({
    id: row.id,
    organization_id: row.organization_id,
    user_id: row.user_id,
    user_email: row.user_email,
    action: row.action as AuditAction,
    resource_type: row.resource_type as ResourceType | undefined,
    resource_id: row.resource_id ?? undefined,
    details: row.details ?? undefined,
    ip_address: row.ip_address ?? undefined,
    user_agent: row.user_agent ?? undefined,
    created_at: row.created_at,
  }));

  return {
    logs: typedLogs,
    total: count || 0,
    page,
    limit,
    total_pages: Math.ceil((count || 0) / limit),
  };
}
