/**
 * Verify Admin Consent API Route
 *
 * Verifies that admin consent has been granted for a tenant by attempting
 * to acquire a client credentials token for that tenant.
 *
 * This is more reliable than localStorage because:
 * - It actually tests if the service principal exists in the tenant
 * - It works across devices/browsers
 * - It can't be spoofed by the user
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import { acquireConsentToken } from '@/lib/consent-token';
import {
  checkStoredConsent,
  storeConsentRecord,
  clearStoredConsent,
} from '@/lib/msp/consent-cache';
import {
  logTokenAcquired,
  logPermissionVerification,
  logApiPermissionTest,
  logPermissions,
} from '@/lib/permission-logger';

type ConsentErrorType = 'missing_credentials' | 'network_error' | 'consent_not_granted' | 'insufficient_intune_permissions' | 'consent_propagating' | null;

interface PermissionStatus {
  deviceManagementApps: boolean | null;
  userRead: boolean | null;
  groupRead: boolean | null;
  deviceManagementManagedDevices: boolean | null;
  deviceManagementServiceConfig: boolean | null;
}

interface ConsentVerificationResult {
  verified: boolean;
  tenantId: string;
  message: string;
  cachedResult?: boolean;
  error?: ConsentErrorType;
  permissions?: PermissionStatus;
}

interface GraphVerificationResult {
  verified: boolean;
  error?: ConsentErrorType;
  permissions?: PermissionStatus;
}

/**
 * Try to get a client credentials token for a specific tenant
 * If successful, it means admin consent has been granted
 *
 * FAIL-CLOSED: Returns { verified: false, error } on any error condition.
 * This prevents users from bypassing consent verification.
 */
async function verifyConsentWithGraph(tenantId: string, justConsented = false): Promise<GraphVerificationResult> {
  // Acquire a service-principal token via the shared classifier so this route
  // and lib/msp/consent-verification.ts cannot disagree about what counts as
  // consent_not_granted vs a transient network error.
  const tokenResult = await acquireConsentToken(tenantId);

  if (!tokenResult.ok) {
    if (tokenResult.error === 'consent_not_granted') {
      logPermissions({
        route: '/api/auth/verify-consent',
        action: 'consent_not_granted',
        tenantId,
        granted: false,
        error: 'consent_not_granted',
        details: {
          errorCode: tokenResult.errorCode,
          errorDescription: tokenResult.errorDescription,
        },
      });
    }
    return { verified: false, error: tokenResult.error };
  }

  const accessToken = tokenResult.accessToken;

  // Decode token and check roles claim for explicit permission verification
  let tokenRoles: string[] = [];
  try {
    const tokenPayload = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64').toString()
    );
    tokenRoles = tokenPayload.roles || [];

    // Log token acquisition with roles
    logTokenAcquired('/api/auth/verify-consent', tenantId, tokenRoles);

    // Check for the exact permission needed for Intune deployment
    const hasIntuneWritePermission = tokenRoles.includes('DeviceManagementApps.ReadWrite.All');

    if (!hasIntuneWritePermission) {
      const permissionStatus = {
        deviceManagementApps: false,
        userRead: true,
        groupRead: tokenRoles.includes('GroupMember.Read.All'),
        deviceManagementManagedDevices: tokenRoles.includes('DeviceManagementManagedDevices.Read.All'),
        deviceManagementServiceConfig: tokenRoles.includes('DeviceManagementServiceConfig.ReadWrite.All'),
      };

      // If consent was just granted, Microsoft can take minutes to propagate
      // the role claims into new service-principal tokens. Return a distinct
      // error so the UI can show an actionable "still propagating" message.
      const errorType: ConsentErrorType = justConsented
        ? 'consent_propagating'
        : 'insufficient_intune_permissions';

      logPermissionVerification(
        '/api/auth/verify-consent',
        tenantId,
        false,
        permissionStatus,
        errorType
      );

      return {
        verified: false,
        error: errorType,
        permissions: permissionStatus,
      };
    }
  } catch {
    // Fall through to API test as backup
  }

  const permissions: PermissionStatus = {
    deviceManagementApps: null,
    userRead: true, // If we got a token, basic access works
    groupRead: tokenRoles.includes('GroupMember.Read.All') || null,
    deviceManagementManagedDevices: tokenRoles.includes('DeviceManagementManagedDevices.Read.All') || null,
    deviceManagementServiceConfig: tokenRoles.includes('DeviceManagementServiceConfig.ReadWrite.All') || null,
  };

  // Test DeviceManagementApps.ReadWrite.All permission
  try {
    const intuneTestResponse = await fetch(
      'https://graph.microsoft.com/beta/deviceAppManagement/mobileApps?$top=1&$select=id',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (intuneTestResponse.status === 403) {
      permissions.deviceManagementApps = false;
    } else if (intuneTestResponse.status >= 500) {
      // Server error - leave as null (unknown)
      permissions.deviceManagementApps = null;
    } else {
      // Success or 404 (no apps yet) - permission is granted
      permissions.deviceManagementApps = true;
    }

    logApiPermissionTest(
      '/api/auth/verify-consent',
      tenantId,
      'DeviceManagementApps.ReadWrite.All',
      intuneTestResponse.status,
      permissions.deviceManagementApps
    );
  } catch {
    permissions.deviceManagementApps = null;
  }

  // Test GroupMember.Read.All permission
  try {
    const groupTestResponse = await fetch(
      'https://graph.microsoft.com/v1.0/groups?$top=1&$select=id',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (groupTestResponse.status === 403) {
      permissions.groupRead = false;
    } else if (groupTestResponse.status >= 500) {
      permissions.groupRead = null;
    } else {
      permissions.groupRead = true;
    }

    logApiPermissionTest(
      '/api/auth/verify-consent',
      tenantId,
      'GroupMember.Read.All',
      groupTestResponse.status,
      permissions.groupRead
    );
  } catch {
    permissions.groupRead = null;
  }

  // Test DeviceManagementManagedDevices.Read.All permission
  try {
    const discoveredAppsTestResponse = await fetch(
      'https://graph.microsoft.com/v1.0/deviceManagement/detectedApps?$top=1&$select=id',
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (discoveredAppsTestResponse.status === 403) {
      permissions.deviceManagementManagedDevices = false;
    } else if (discoveredAppsTestResponse.status >= 500) {
      permissions.deviceManagementManagedDevices = null;
    } else {
      permissions.deviceManagementManagedDevices = true;
    }

    logApiPermissionTest(
      '/api/auth/verify-consent',
      tenantId,
      'DeviceManagementManagedDevices.Read.All',
      discoveredAppsTestResponse.status,
      permissions.deviceManagementManagedDevices
    );
  } catch {
    permissions.deviceManagementManagedDevices = null;
  }

  const hasRequiredPermission = permissions.deviceManagementApps === true;

  // Honor the just-consented hint on the live-API-test path too. If JWT
  // decode succeeded but rolled through here because the test also checks
  // live Graph, or if decode failed (catch above), we still want a fresh
  // consent to surface the propagating state rather than "insufficient".
  const fallthroughError: ConsentErrorType = justConsented
    ? 'consent_propagating'
    : 'insufficient_intune_permissions';

  logPermissionVerification(
    '/api/auth/verify-consent',
    tenantId,
    hasRequiredPermission,
    permissions,
    hasRequiredPermission ? undefined : fallthroughError
  );

  if (!hasRequiredPermission && permissions.deviceManagementApps === false) {
    return { verified: false, error: fallthroughError, permissions };
  }

  return { verified: hasRequiredPermission, permissions };
}

export async function POST(request: NextRequest): Promise<NextResponse<ConsentVerificationResult>> {
  try {
    // Get the authorization header
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { verified: false, tenantId: '', message: 'Authentication required' },
        { status: 401 }
      );
    }

    // Verify the token against Microsoft Graph before trusting any claims
    const userInfo = await parseAccessToken(authHeader);
    if (!userInfo) {
      return NextResponse.json(
        { verified: false, tenantId: '', message: 'Authentication failed' },
        { status: 401 }
      );
    }

    let tenantId = userInfo.tenantId;
    const userId = userInfo.userId;
    const userEmail = userInfo.userEmail;

    const supabase = createServerClient();
    const mspTenantId = request.headers.get('X-MSP-Tenant-Id');

    const tenantResolution = await resolveTargetTenantId({
      supabase,
      userId,
      tokenTenantId: tenantId,
      requestedTenantId: mspTenantId,
    });

    if (tenantResolution.errorResponse) {
      return NextResponse.json(
        {
          verified: false,
          tenantId: tenantResolution.tenantId,
          message: 'Not authorized to verify consent for this tenant',
        },
        { status: 403 }
      );
    }

    tenantId = tenantResolution.tenantId;

    // Hint from the client indicating admin consent was just granted.
    // Lets us distinguish Microsoft's role-claim propagation delay from a
    // genuine "insufficient permissions" scenario.
    const justConsented = new URL(request.url).searchParams.get('justConsented') === 'true';

    // First, check if we have a cached consent record in the database
    const hasStoredConsent = await checkStoredConsent(tenantId);
    if (hasStoredConsent) {
      // Re-verify to ensure consent is still valid (handles revocation)
      const reVerifyResult = await verifyConsentWithGraph(tenantId, justConsented);
      if (!reVerifyResult.verified) {
        // Clear stale cache
        await clearStoredConsent(tenantId);
        return NextResponse.json({
          verified: false,
          tenantId,
          message: reVerifyResult.error === 'consent_not_granted'
            ? 'Admin consent has been revoked or expired.'
            : reVerifyResult.error === 'insufficient_intune_permissions'
              ? 'Intune permissions not granted. Please re-grant admin consent to include DeviceManagementApps.ReadWrite.All permission.'
              : reVerifyResult.error === 'consent_propagating'
                ? 'Consent was granted. Microsoft is still propagating the new permissions to tokens - this typically takes 5-15 minutes. Please check again shortly.'
                : reVerifyResult.error === 'missing_credentials'
                  ? 'Server configuration error. Contact administrator.'
                  : 'Unable to verify consent. Please check your connection and try again.',
          cachedResult: false,
          error: reVerifyResult.error,
          permissions: reVerifyResult.permissions,
        });
      }
      return NextResponse.json({
        verified: true,
        tenantId,
        message: 'Admin consent verified (cached)',
        cachedResult: true,
        permissions: reVerifyResult.permissions,
      });
    }

    // No cached record - verify by trying to get a token
    const verifyResult = await verifyConsentWithGraph(tenantId, justConsented);

    if (verifyResult.verified) {
      // Store the consent record for future checks
      await storeConsentRecord(tenantId, userId, userEmail);
    }

    return NextResponse.json({
      verified: verifyResult.verified,
      tenantId,
      message: verifyResult.verified
        ? 'Admin consent verified'
        : verifyResult.error === 'consent_not_granted'
          ? 'Admin consent not granted. A Global Administrator must grant consent.'
          : verifyResult.error === 'insufficient_intune_permissions'
            ? 'Intune permissions not granted. Please re-grant admin consent to include DeviceManagementApps.ReadWrite.All permission.'
            : verifyResult.error === 'consent_propagating'
              ? 'Consent was granted. Microsoft is still propagating the new permissions to tokens - this typically takes 5-15 minutes. Please check again shortly.'
              : verifyResult.error === 'missing_credentials'
                ? 'Server configuration error. Contact administrator.'
                : 'Unable to verify consent. Please check your connection and try again.',
      cachedResult: false,
      error: verifyResult.error,
      permissions: verifyResult.permissions,
    });

  } catch {
    return NextResponse.json(
      { verified: false, tenantId: '', message: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET handler for checking consent status without full verification.
 * Uses the cached database record if available.
 *
 * Authenticated: callers can only query the tenant of their own access token,
 * preventing unauthenticated probing of "is this tenant an IntuneGet customer?".
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // Authenticate first — this endpoint exposes whether a tenant has a stored
  // consent record, which is information disclosure if left open.
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  const userInfo = await parseAccessToken(authHeader);
  if (!userInfo) {
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const queryTenantId = searchParams.get('tenantId');

  if (!queryTenantId) {
    return NextResponse.json(
      { error: 'tenantId parameter required' },
      { status: 400 }
    );
  }

  // Only allow querying the user's own tenant. MSP users querying their
  // managed tenants should go through the authenticated POST flow which
  // validates membership via resolveTargetTenantId.
  if (queryTenantId !== userInfo.tenantId) {
    return NextResponse.json(
      { error: 'Not authorized to query this tenant' },
      { status: 403 }
    );
  }

  const hasStoredConsent = await checkStoredConsent(queryTenantId);

  return NextResponse.json({
    tenantId: queryTenantId,
    hasConsent: hasStoredConsent,
    message: hasStoredConsent
      ? 'Consent record found'
      : 'No consent record found - verification required',
  });
}
