/**
 * MSP Feature Validators
 * Zod schemas for validating MSP-related inputs
 */

import { z } from 'zod';
import { isValidRole, type MspRole } from '@/lib/msp-permissions';

// ============================================
// Team Invitations
// ============================================

export const invitationSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .max(320, 'Email must be 320 characters or less')
    .email('Invalid email format')
    .transform((e) => e.toLowerCase().trim()),
  role: z
    .string()
    .refine((val): val is MspRole => isValidRole(val), {
      message: 'Role must be admin, operator, or viewer',
    })
    .refine((val) => val !== 'owner', {
      message: 'Cannot invite users as owner',
    }),
});

export type InvitationInput = z.infer<typeof invitationSchema>;

// ============================================
// Member Management
// ============================================

export const updateMemberRoleSchema = z.object({
  role: z
    .string()
    .refine((val): val is MspRole => isValidRole(val), {
      message: 'Role must be owner, admin, operator, or viewer',
    }),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

// ============================================
// Token Validation
// ============================================

export const invitationTokenSchema = z.object({
  token: z
    .string()
    .length(64, 'Invalid invitation token format')
    .regex(/^[a-f0-9]+$/, 'Invalid invitation token format'),
});

export type InvitationTokenInput = z.infer<typeof invitationTokenSchema>;

// ============================================
// Batch Deployment
// ============================================

export const batchDeploymentSchema = z.object({
  tenant_ids: z
    .array(z.string().uuid('Invalid tenant ID format'))
    .min(1, 'At least one tenant must be selected')
    .max(50, 'Cannot deploy to more than 50 tenants at once'),
  winget_id: z
    .string()
    .min(1, 'WinGet ID is required')
    .max(200, 'WinGet ID must be 200 characters or less'),
  version: z.string().max(50).optional(),
  deployment_config: z
    .object({
      groups: z.array(z.string().uuid()).optional(),
      required: z.boolean().optional(),
      available: z.boolean().optional(),
    })
    .optional(),
});

export type BatchDeploymentInput = z.infer<typeof batchDeploymentSchema>;

// ============================================
// Audit Log Query
// ============================================

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  action: z.string().max(100).optional(),
  resource_type: z.string().max(50).optional(),
  user_id: z.string().max(100).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
});

export type AuditLogQueryInput = z.infer<typeof auditLogQuerySchema>;

// ============================================
// Organization Settings
// ============================================

export const updateOrganizationSchema = z.object({
  name: z
    .string()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100, 'Organization name must be 100 characters or less')
    .optional(),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50, 'Slug must be 50 characters or less')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
    .optional(),
});

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

// ============================================
// Validation Helpers
// ============================================

/**
 * Validate and parse input against a schema
 */
export function validateMspInput<T>(
  schema: z.ZodSchema<T>,
  input: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(input);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Zod v4 uses issues instead of errors
  const issues = result.error.issues || [];
  if (issues.length === 0) {
    return { success: false, error: 'Validation failed' };
  }

  const firstIssue = issues[0];
  const errorMessage = firstIssue.path && firstIssue.path.length > 0
    ? `${firstIssue.path.join('.')}: ${firstIssue.message}`
    : firstIssue.message;

  return { success: false, error: errorMessage };
}

/**
 * Validate UUID format
 */
export function isValidUuid(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Sanitize organization name
 */
export function sanitizeOrgName(name: string): string {
  return name
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .trim()
    .substring(0, 100);
}
