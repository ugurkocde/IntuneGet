/**
 * MSP Role-Based Permission System
 * Defines permissions for different roles and utilities for checking access
 */

// ============================================
// Role Types
// ============================================

export type MspRole = 'owner' | 'admin' | 'operator' | 'viewer';

// ============================================
// Permission Definitions
// ============================================

/**
 * All available permissions in the MSP system
 */
export type Permission =
  | 'view_dashboard'
  | 'deploy_apps'
  | 'manage_tenants'
  | 'invite_members'
  | 'remove_members'
  | 'change_roles'
  | 'delete_org'
  | 'view_audit_logs'
  | 'export_reports'
  | 'batch_deploy'
  | 'manage_policies';

/**
 * Role permission matrix
 * Defines which permissions each role has
 */
const rolePermissions: Record<MspRole, Set<Permission>> = {
  owner: new Set([
    'view_dashboard',
    'deploy_apps',
    'manage_tenants',
    'invite_members',
    'remove_members',
    'change_roles',
    'delete_org',
    'view_audit_logs',
    'export_reports',
    'batch_deploy',
    'manage_policies',
  ]),
  admin: new Set([
    'view_dashboard',
    'deploy_apps',
    'manage_tenants',
    'invite_members',
    'remove_members',
    'view_audit_logs',
    'export_reports',
    'batch_deploy',
    'manage_policies',
  ]),
  operator: new Set([
    'view_dashboard',
    'deploy_apps',
    'view_audit_logs',
  ]),
  viewer: new Set([
    'view_dashboard',
  ]),
};

/**
 * Role hierarchy for comparisons
 * Higher number = more privileged
 */
const roleHierarchy: Record<MspRole, number> = {
  owner: 4,
  admin: 3,
  operator: 2,
  viewer: 1,
};

// ============================================
// Permission Checking Functions
// ============================================

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: MspRole, permission: Permission): boolean {
  return rolePermissions[role]?.has(permission) ?? false;
}

/**
 * Check if a role has all of the specified permissions
 */
export function hasAllPermissions(role: MspRole, permissions: Permission[]): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: MspRole, permissions: Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: MspRole): Permission[] {
  return Array.from(rolePermissions[role] || []);
}

/**
 * Check if a role is at least as privileged as another role
 */
export function isRoleAtLeast(role: MspRole, minimumRole: MspRole): boolean {
  return (roleHierarchy[role] || 0) >= (roleHierarchy[minimumRole] || 0);
}

/**
 * Check if a role can modify another role (can only modify lower roles)
 */
export function canModifyRole(actorRole: MspRole, targetRole: MspRole): boolean {
  // Only owners can modify owners
  if (targetRole === 'owner') {
    return false;
  }
  // Must have higher privilege than target
  return (roleHierarchy[actorRole] || 0) > (roleHierarchy[targetRole] || 0);
}

/**
 * Get roles that a user with the given role can assign
 */
export function getAssignableRoles(actorRole: MspRole): MspRole[] {
  const actorLevel = roleHierarchy[actorRole] || 0;
  return (Object.entries(roleHierarchy) as [MspRole, number][])
    .filter(([role, level]) => level < actorLevel && role !== 'owner')
    .map(([role]) => role);
}

// ============================================
// Role Display Utilities
// ============================================

/**
 * Get display name for a role
 */
export function getRoleDisplayName(role: MspRole): string {
  const names: Record<MspRole, string> = {
    owner: 'Owner',
    admin: 'Admin',
    operator: 'Operator',
    viewer: 'Viewer',
  };
  return names[role] || role;
}

/**
 * Get description for a role
 */
export function getRoleDescription(role: MspRole): string {
  const descriptions: Record<MspRole, string> = {
    owner: 'Full access to all features including organization deletion',
    admin: 'Manage tenants, members, and deployments',
    operator: 'Deploy apps and view dashboards',
    viewer: 'View-only access to dashboards',
  };
  return descriptions[role] || '';
}

/**
 * Get color class for role badge
 */
export function getRoleColor(role: MspRole): string {
  const colors: Record<MspRole, string> = {
    owner: 'text-purple-500 bg-purple-500/10',
    admin: 'text-blue-500 bg-blue-500/10',
    operator: 'text-green-500 bg-green-500/10',
    viewer: 'text-gray-500 bg-gray-500/10',
  };
  return colors[role] || 'text-gray-500 bg-gray-500/10';
}

// ============================================
// Validation Utilities
// ============================================

/**
 * Check if a string is a valid role
 */
export function isValidRole(value: string): value is MspRole {
  return ['owner', 'admin', 'operator', 'viewer'].includes(value);
}

/**
 * Safely parse a role string, returning a default if invalid
 */
export function parseRole(value: string | null | undefined, defaultRole: MspRole = 'viewer'): MspRole {
  if (!value) return defaultRole;
  return isValidRole(value) ? value : defaultRole;
}

// ============================================
// Type Guards
// ============================================

export interface MspMemberWithRole {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  role: MspRole;
  msp_organization_id: string;
}

/**
 * Check if a member object has a valid role
 */
export function isMemberWithValidRole(member: unknown): member is MspMemberWithRole {
  if (!member || typeof member !== 'object') return false;
  const m = member as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.user_id === 'string' &&
    typeof m.user_email === 'string' &&
    typeof m.role === 'string' &&
    isValidRole(m.role)
  );
}
