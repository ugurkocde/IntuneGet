/**
 * Permission Logger
 *
 * Structured logging utility for permission checks in authentication routes.
 * Outputs JSON logs that are easily parseable in Vercel's log viewer.
 */

export interface PermissionLogContext {
  route: string;
  action: string;
  tenantId?: string;
  permissions?: string[];
  requiredPermissions?: string[];
  granted?: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

const REQUIRED_INTUNE_PERMISSIONS = [
  'DeviceManagementApps.ReadWrite.All',
  'GroupMember.Read.All',
];

const OPTIONAL_PERMISSIONS = [
  'User.Read.All',
];

/**
 * Log permission-related events in a structured format for Vercel logs
 */
export function logPermissions(context: PermissionLogContext): void {
  const timestamp = new Date().toISOString();

  const logEntry = {
    timestamp,
    ...context,
  };

  // Use a consistent prefix for easy filtering in Vercel logs
  console.log(`[PERMISSION_CHECK] ${JSON.stringify(logEntry)}`);
}

/**
 * Log when a token is acquired
 */
export function logTokenAcquired(
  route: string,
  tenantId: string,
  roles: string[]
): void {
  const hasRequiredPermissions = REQUIRED_INTUNE_PERMISSIONS.every(
    perm => roles.includes(perm)
  );

  logPermissions({
    route,
    action: 'token_acquired',
    tenantId,
    permissions: roles,
    requiredPermissions: REQUIRED_INTUNE_PERMISSIONS,
    granted: hasRequiredPermissions,
    details: {
      hasIntunePermission: roles.includes('DeviceManagementApps.ReadWrite.All'),
      hasGroupRead: roles.includes('GroupMember.Read.All'),
      totalRoles: roles.length,
    },
  });
}

/**
 * Log permission verification result
 */
export function logPermissionVerification(
  route: string,
  tenantId: string,
  verified: boolean,
  permissions: {
    deviceManagementApps?: boolean | null;
    userRead?: boolean | null;
    groupRead?: boolean | null;
  },
  error?: string
): void {
  const grantedPermissions: string[] = [];
  const missingPermissions: string[] = [];

  if (permissions.deviceManagementApps === true) {
    grantedPermissions.push('DeviceManagementApps.ReadWrite.All');
  } else if (permissions.deviceManagementApps === false) {
    missingPermissions.push('DeviceManagementApps.ReadWrite.All');
  }

  if (permissions.groupRead === true) {
    grantedPermissions.push('GroupMember.Read.All');
  } else if (permissions.groupRead === false) {
    missingPermissions.push('GroupMember.Read.All');
  }

  if (permissions.userRead === true) {
    grantedPermissions.push('User.Read');
  }

  logPermissions({
    route,
    action: 'permission_verification',
    tenantId,
    permissions: grantedPermissions,
    requiredPermissions: REQUIRED_INTUNE_PERMISSIONS,
    granted: verified,
    error,
    details: {
      missingPermissions,
      deviceManagementApps: permissions.deviceManagementApps,
      groupRead: permissions.groupRead,
      userRead: permissions.userRead,
    },
  });
}

/**
 * Log consent callback received
 */
export function logConsentCallback(
  route: string,
  tenantId: string,
  adminConsent: string | null,
  error?: string
): void {
  logPermissions({
    route,
    action: 'consent_callback_received',
    tenantId,
    granted: adminConsent === 'True',
    error,
    details: {
      adminConsentValue: adminConsent,
    },
  });
}

/**
 * Log final consent status
 */
export function logConsentStatus(
  route: string,
  tenantId: string,
  status: 'granted' | 'denied' | 'incomplete' | 'error',
  roles?: string[],
  details?: Record<string, unknown>
): void {
  const hasRequiredPermissions = roles
    ? REQUIRED_INTUNE_PERMISSIONS.every(perm => roles.includes(perm))
    : false;

  logPermissions({
    route,
    action: 'consent_status_final',
    tenantId,
    permissions: roles,
    requiredPermissions: REQUIRED_INTUNE_PERMISSIONS,
    granted: status === 'granted' && hasRequiredPermissions,
    details: {
      status,
      hasRequiredPermissions,
      ...details,
    },
  });
}

/**
 * Log API permission test result
 */
export function logApiPermissionTest(
  route: string,
  tenantId: string,
  permission: string,
  statusCode: number,
  granted: boolean | null
): void {
  logPermissions({
    route,
    action: 'api_permission_test',
    tenantId,
    permissions: granted ? [permission] : [],
    requiredPermissions: [permission],
    granted: granted === true,
    details: {
      permissionTested: permission,
      httpStatusCode: statusCode,
      result: granted === true ? 'granted' : granted === false ? 'denied' : 'unknown',
    },
  });
}

export { REQUIRED_INTUNE_PERMISSIONS, OPTIONAL_PERMISSIONS };
