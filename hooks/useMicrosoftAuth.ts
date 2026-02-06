"use client";

import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { InteractionRequiredAuthError, AccountInfo } from "@azure/msal-browser";
import { graphScopes, getAdminConsentUrl } from "@/lib/msal-config";
import { useCallback, useRef, useEffect, useState } from "react";
import { isTokenExpiringSoon, getTokenExpiryMinutes } from "@/lib/token-utils";

/**
 * Hook to manage Microsoft authentication and access tokens
 * Provides sign-in, sign-out, and token management functionality
 */
// Track sign-in to server for logging
async function trackSignInToServer(
  account: AccountInfo,
  authMethod: 'popup' | 'redirect' | 'silent'
): Promise<void> {
  try {
    await fetch('/api/auth/track-signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: account.localAccountId,
        email: account.username,
        name: account.name || null,
        tenantId: account.tenantId,
        authMethod,
      }),
    });
  } catch {
    // Silently fail - tracking shouldn't break auth flow
  }
}

export function useMicrosoftAuth() {
  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();

  // Track sign-out in progress to prevent auth guard redirects
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Cache the current token to check expiry
  const cachedTokenRef = useRef<string | null>(null);
  const tokenExpiryRef = useRef<number | null>(null);

  // Track if we've already tracked this session's sign-in
  const hasTrackedSignInRef = useRef<string | null>(null);

  /**
   * Force refresh the token, bypassing cache
   */
  const refreshToken = useCallback(async (): Promise<string | null> => {
    if (accounts.length === 0) {
      return null;
    }

    try {
      const tokenResponse = await instance.acquireTokenSilent({
        scopes: graphScopes,
        account: accounts[0],
        forceRefresh: true,
      });

      cachedTokenRef.current = tokenResponse.accessToken;
      tokenExpiryRef.current = tokenResponse.expiresOn?.getTime() || null;

      return tokenResponse.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        try {
          const tokenResponse = await instance.acquireTokenPopup({
            scopes: graphScopes,
            account: accounts[0],
          });

          cachedTokenRef.current = tokenResponse.accessToken;
          tokenExpiryRef.current = tokenResponse.expiresOn?.getTime() || null;

          return tokenResponse.accessToken;
        } catch {
          return null;
        }
      }
      return null;
    }
  }, [instance, accounts]);

  /**
   * Get access token, with automatic refresh if expiring soon
   */
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (accounts.length === 0) {
      return null;
    }

    // Check if we have a cached token that's expiring soon (< 5 minutes)
    if (
      cachedTokenRef.current &&
      isTokenExpiringSoon(cachedTokenRef.current, 5)
    ) {
      // Force refresh the token
      return await refreshToken();
    }

    try {
      const tokenResponse = await instance.acquireTokenSilent({
        scopes: graphScopes,
        account: accounts[0],
      });

      cachedTokenRef.current = tokenResponse.accessToken;
      tokenExpiryRef.current = tokenResponse.expiresOn?.getTime() || null;

      return tokenResponse.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        try {
          const tokenResponse = await instance.acquireTokenPopup({
            scopes: graphScopes,
            account: accounts[0],
          });

          cachedTokenRef.current = tokenResponse.accessToken;
          tokenExpiryRef.current = tokenResponse.expiresOn?.getTime() || null;

          return tokenResponse.accessToken;
        } catch {
          return null;
        }
      }
      return null;
    }
  }, [instance, accounts, refreshToken]);

  /**
   * Check if the current token is expiring soon
   */
  const isTokenExpiring = useCallback(
    (thresholdMinutes: number = 5): boolean => {
      if (!cachedTokenRef.current) return true;
      return isTokenExpiringSoon(cachedTokenRef.current, thresholdMinutes);
    },
    []
  );

  /**
   * Get remaining minutes until token expires
   */
  const getTokenExpiryTime = useCallback((): number | null => {
    if (!cachedTokenRef.current) return null;
    return getTokenExpiryMinutes(cachedTokenRef.current);
  }, []);

  // Track sign-in for redirect flows (when user returns to app after redirect)
  useEffect(() => {
    const account = accounts[0];
    if (account && hasTrackedSignInRef.current !== account.localAccountId) {
      // Mark as tracked to prevent duplicate tracking
      hasTrackedSignInRef.current = account.localAccountId;
      // Track as redirect/silent since we're detecting an existing session
      trackSignInToServer(account, 'silent');
    }
  }, [accounts]);

  /**
   * Sign in with Microsoft popup
   */
  const signIn = useCallback(async () => {
    try {
      const result = await instance.loginPopup({ scopes: graphScopes });
      if (result?.account) {
        document.cookie = 'msal-auth-hint=1; path=/; SameSite=Lax; max-age=86400';
        hasTrackedSignInRef.current = result.account.localAccountId;
        await trackSignInToServer(result.account, 'popup');
      }
      return !!result;
    } catch {
      return false;
    }
  }, [instance]);

  /**
   * Sign in with Microsoft redirect
   */
  const signInRedirect = useCallback(async () => {
    try {
      document.cookie = 'msal-auth-hint=1; path=/; SameSite=Lax; max-age=86400';
      await instance.loginRedirect({ scopes: graphScopes });
      return true;
    } catch {
      return false;
    }
  }, [instance]);

  /**
   * Sign out and redirect to home
   */
  const signOut = useCallback(async () => {
    try {
      // Signal sign-out in progress to prevent auth guard redirects
      setIsSigningOut(true);

      // Clear auth hint cookie so middleware blocks dashboard access
      document.cookie = 'msal-auth-hint=; path=/; SameSite=Lax; max-age=0';

      // Clear local cached tokens first
      cachedTokenRef.current = null;
      tokenExpiryRef.current = null;

      // Get the active account for promptless logout
      const account = instance.getActiveAccount();

      await instance.logoutRedirect({
        account: account || undefined,
        postLogoutRedirectUri: window.location.origin,
      });
      return true;
    } catch {
      setIsSigningOut(false);
      return false;
    }
  }, [instance]);

  /**
   * Get user information from the current account
   */
  const getUserInfo = useCallback(() => {
    const account = accounts[0];
    if (!account) return null;

    return {
      id: account.localAccountId,
      name: account.name || null,
      email: account.username || null,
      tenantId: account.tenantId,
    };
  }, [accounts]);

  /**
   * Redirect to admin consent page
   * Only Global Admins or Privileged Role Admins can grant consent
   */
  const requestAdminConsent = useCallback(() => {
    const userInfo = getUserInfo();
    const consentUrl = getAdminConsentUrl(userInfo?.tenantId);
    window.location.href = consentUrl;
  }, [getUserInfo]);

  /**
   * Get a shareable admin consent URL for the user's tenant
   * Users can send this to their Global Admin
   */
  const getShareableConsentUrl = useCallback((): string | null => {
    const userInfo = getUserInfo();
    if (!userInfo?.tenantId) return null;
    return getAdminConsentUrl(userInfo.tenantId);
  }, [getUserInfo]);

  return {
    isAuthenticated,
    isSigningOut,
    account: accounts[0] || null,
    user: getUserInfo(),
    getAccessToken,
    refreshToken,
    isTokenExpiring,
    getTokenExpiryTime,
    signIn,
    signInRedirect,
    signOut,
    requestAdminConsent,
    getShareableConsentUrl,
  };
}
