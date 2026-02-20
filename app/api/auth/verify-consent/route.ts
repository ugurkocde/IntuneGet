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
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import {
  logTokenAcquired,
  logPermissionVerification,
  logApiPermissionTest,
  logPermissions,
} from '@/lib/permission-logger';

type ConsentErrorType = 'missing_credentials' | 'network_error' | 'consent_not_granted' | 'insufficient_intune_permissions' | null;

interface PermissionStatus {
  deviceManagementApps: boolean | null;
  userRead: boolean | null;
  groupRead: boolean | null;
  deviceManagementManagedDevices: boolean | null;
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
async function verifyConsentWithGraph(tenantId: string): Promise<GraphVerificationResult> {
  const clientId = process.env.AZURE_AD_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    // FAIL-CLOSED: Cannot verify without credentials
    return { verified: false, error: 'missing_credentials' };
  }

  try {
    const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (response.ok) {
      // We got a token - now test actual API access for each permission
      const tokenData = await response.json();
      const accessToken = tokenData.access_token;

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
            groupRead: tokenRoles.includes('Group.Read.All'),
            deviceManagementManagedDevices: tokenRoles.includes('DeviceManagementManagedDevices.Read.All'),
          };

          // Log the verification failure
          logPermissionVerification(
            '/api/auth/verify-consent',
            tenantId,
            false,
            permissionStatus,
            'insufficient_intune_permissions'
          );

          return {
            verified: false,
            error: 'insufficient_intune_permissions',
            permissions: permissionStatus,
          };
        }
      } catch {
        // Fall through to API test as backup
      }

      const permissions: PermissionStatus = {
        deviceManagementApps: null,
        userRead: true, // If we got a token, basic access works
        groupRead: tokenRoles.includes('Group.Read.All') || null,
        deviceManagementManagedDevices: tokenRoles.includes('DeviceManagementManagedDevices.Read.All') || null,
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

        // Log the Intune API permission test
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

      // Test Group.Read.All permission
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

        // Log the Group API permission test
        logApiPermissionTest(
          '/api/auth/verify-consent',
          tenantId,
          'Group.Read.All',
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

        // Log the Discovered Apps API permission test
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

      // Determine overall verification status
      const hasRequiredPermission = permissions.deviceManagementApps === true;

      // Log final verification result
      logPermissionVerification(
        '/api/auth/verify-consent',
        tenantId,
        hasRequiredPermission,
        permissions,
        hasRequiredPermission ? undefined : 'insufficient_intune_permissions'
      );

      if (!hasRequiredPermission && permissions.deviceManagementApps === false) {
        return { verified: false, error: 'insufficient_intune_permissions', permissions };
      }

      return { verified: hasRequiredPermission, permissions };
    }

    // Check the error
    const errorData = await response.json().catch(() => ({}));
    const errorCode = errorData.error;
    const errorDescription = errorData.error_description || '';

    // Invalid client credentials (wrong secret, expired secret)
    // AADSTS7000215: Invalid client secret provided
    // AADSTS7000222: Client secret is expired
    if (errorCode === 'invalid_client' ||
        errorDescription.includes('AADSTS7000215') ||
        errorDescription.includes('AADSTS7000222')) {
      return { verified: false, error: 'missing_credentials' };
    }

    // AADSTS700016: Application not found in the directory
    // AADSTS65001: User or admin has not consented
    // These mean consent was NOT granted
    if (errorCode === 'invalid_grant' ||
        errorCode === 'unauthorized_client' ||
        errorDescription.includes('AADSTS700016') ||
        errorDescription.includes('AADSTS65001')) {
      logPermissions({
        route: '/api/auth/verify-consent',
        action: 'consent_not_granted',
        tenantId,
        granted: false,
        error: 'consent_not_granted',
        details: { errorCode, errorDescription },
      });
      return { verified: false, error: 'consent_not_granted' };
    }

    // Other errors (network, temporary issues)
    // FAIL-CLOSED: Return false with network_error on unknown errors
    return { verified: false, error: 'network_error' };

  } catch {
    // FAIL-CLOSED: Network error
    return { verified: false, error: 'network_error' };
  }
}

/**
 * Store verified consent in database
 */
async function storeConsentRecord(
  tenantId: string,
  userId: string,
  userEmail: string
): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }

  try {
    const supabase = createServerClient();

    await supabase.from('tenant_consent').upsert({
      tenant_id: tenantId,
      consented_by_user_id: userId,
      consented_by_email: userEmail,
      consent_granted_at: new Date().toISOString(),
      is_active: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'tenant_id',
    });
  } catch {
    // Failed to store consent record - continue silently
  }
}

/**
 * Check if consent is already stored in database
 */
async function checkStoredConsent(tenantId: string): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('tenant_consent')
      .select('is_active')
      .eq('tenant_id', tenantId)
      .single();

    if (error || !data) {
      return false;
    }

    return data.is_active === true;
  } catch {
    return false;
  }
}

/**
 * Clear stored consent record (for when consent is revoked)
 */
async function clearStoredConsent(tenantId: string): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }

  try {
    const supabase = createServerClient();

    await supabase
      .from('tenant_consent')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);
  } catch {
    // Failed to clear consent record - continue silently
  }
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

    // First, check if we have a cached consent record in the database
    const hasStoredConsent = await checkStoredConsent(tenantId);
    if (hasStoredConsent) {
      // Re-verify to ensure consent is still valid (handles revocation)
      const reVerifyResult = await verifyConsentWithGraph(tenantId);
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
    const verifyResult = await verifyConsentWithGraph(tenantId);

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
 * GET handler for checking consent status without full verification
 * Uses cached database record if available
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');

  if (!tenantId) {
    return NextResponse.json(
      { error: 'tenantId parameter required' },
      { status: 400 }
    );
  }

  const hasStoredConsent = await checkStoredConsent(tenantId);

  return NextResponse.json({
    tenantId,
    hasConsent: hasStoredConsent,
    message: hasStoredConsent
      ? 'Consent record found'
      : 'No consent record found - verification required',
  });
}
