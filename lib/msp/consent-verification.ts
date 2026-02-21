/**
 * Tenant Consent Verification
 * Shared module for verifying admin consent via client credentials flow
 */

export type ConsentVerifyError =
  | 'consent_not_granted'
  | 'insufficient_intune_permissions'
  | 'network_error'
  | null;

export interface ConsentVerifyResult {
  verified: boolean;
  error?: ConsentVerifyError;
}

/**
 * Verify that admin consent has been granted for the tenant.
 * Uses client credentials grant to test if the service principal exists
 * and tests actual Intune API access to verify DeviceManagementApps.ReadWrite.All permission.
 */
export async function verifyTenantConsent(tenantId: string): Promise<ConsentVerifyResult> {
  const clientId = process.env.AZURE_AD_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET;

  // If credentials not configured, skip check (allows local/dev mode)
  if (!clientId || !clientSecret) {
    return { verified: true };
  }

  try {
    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
      }
    );

    if (!response.ok) {
      return { verified: false, error: 'consent_not_granted' };
    }

    // Token obtained - first check roles claim for explicit permission verification
    const tokenData = await response.json();
    const accessToken = tokenData.access_token;

    try {
      const tokenPayload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      const roles: string[] = tokenPayload.roles || [];

      if (!roles.includes('DeviceManagementApps.ReadWrite.All')) {
        return { verified: false, error: 'insufficient_intune_permissions' };
      }
    } catch {
      // Fall through to API test as backup
    }

    // Secondary validation: test actual Intune API access
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

    if (intuneTestResponse.status === 401 || intuneTestResponse.status === 403) {
      return { verified: false, error: 'insufficient_intune_permissions' };
    }

    if (intuneTestResponse.status >= 500) {
      return { verified: false, error: 'network_error' };
    }

    if (!intuneTestResponse.ok) {
      return { verified: false, error: 'network_error' };
    }

    return { verified: true };
  } catch {
    return { verified: false, error: 'network_error' };
  }
}
