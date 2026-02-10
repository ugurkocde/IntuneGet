import {
  Configuration,
  PublicClientApplication,
  LogLevel,
} from "@azure/msal-browser";
import { getPublicClientId } from "@/lib/runtime-config";

export const msalConfig: Configuration = {
  auth: {
    clientId: getPublicClientId(),
    authority: "https://login.microsoftonline.com/common",
    redirectUri:
      typeof window !== "undefined" ? window.location.origin : "",
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) {
          return;
        }
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            return;
          case LogLevel.Warning:
            console.warn(message);
            return;
          default:
            return;
        }
      },
    },
  },
};

// Scopes for user sign-in (delegated permissions)
// Note: DeviceManagementApps.ReadWrite.All is an APPLICATION permission
// granted via admin consent, not a delegated permission
export const graphScopes = [
  "https://graph.microsoft.com/User.Read",
  "openid",
  "profile",
];

/**
 * Get the admin consent URL for granting application permissions
 * This grants the service principal access to the user's tenant
 */
export function getAdminConsentUrl(tenantId?: string): string {
  const clientId = getPublicClientId();
  const redirectUri = typeof window !== "undefined"
    ? `${window.location.origin}/auth/consent-callback`
    : "";

  // Use 'organizations' for multi-tenant, or specific tenant if known
  const tenant = tenantId || "organizations";

  return `https://login.microsoftonline.com/${tenant}/adminconsent?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

/**
 * Get the MSP customer consent URL for granting application permissions
 * This is used when an MSP adds a customer tenant
 * The state parameter encodes the MSP org ID and tenant record ID for the callback
 * Note: This function is called from the server-side API, not from the client
 */
export function getMspCustomerConsentUrl(mspOrgId: string, tenantRecordId: string, baseUrl?: string, signedState?: string): string {
  const clientId = getPublicClientId();
  const base = baseUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const redirectUri = `${base}/api/msp/tenants/consent-callback`;

  // Use the pre-signed state if provided (from server), otherwise use plain state (legacy/client)
  const state = signedState || `${mspOrgId}:${tenantRecordId}`;

  // Use 'organizations' to allow any tenant to consent
  return `https://login.microsoftonline.com/organizations/adminconsent?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
}

// Singleton MSAL instance
let msalInstance: PublicClientApplication | null = null;

export function getMsalInstance(): PublicClientApplication {
  if (!msalInstance) {
    msalInstance = new PublicClientApplication(msalConfig);
  }
  return msalInstance;
}
