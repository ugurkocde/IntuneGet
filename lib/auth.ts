/**
 * Authentication Utilities
 * Server-side helpers for token validation and user profile management
 */

import { createServerClient, isSupabaseConfigured } from './supabase';

/**
 * User info extracted from token
 */
export interface TokenUser {
  id: string;
  name?: string;
  email?: string;
  tenantId?: string;
}

/**
 * Decode JWT token payload without verification
 */
function decodeToken(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    return payload;
  } catch {
    return null;
  }
}

/**
 * Validate an access token from the client
 * Decodes and checks basic claims (expiry)
 */
export async function validateToken(accessToken: string): Promise<TokenUser | null> {
  if (!accessToken) return null;

  try {
    const payload = decodeToken(accessToken);
    if (!payload) return null;

    // Basic validation - check expiry
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < now) {
      console.warn('Token has expired');
      return null;
    }

    return {
      id: (payload.oid as string) || (payload.sub as string) || '',
      name: payload.name as string | undefined,
      email: (payload.preferred_username as string) || (payload.email as string) || undefined,
      tenantId: payload.tid as string | undefined,
    };
  } catch (error) {
    console.error('Token validation error:', error);
    return null;
  }
}

/**
 * Store user profile and tokens in Supabase
 */
export async function storeUserProfile(
  userId: string,
  profile: {
    email?: string;
    name?: string;
    tenantId?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: Date;
  }
): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase not configured, skipping profile storage');
    return;
  }

  try {
    const supabase = createServerClient();

    await supabase.from('user_profiles').upsert({
      id: userId,
      email: profile.email,
      name: profile.name,
      intune_tenant_id: profile.tenantId,
      microsoft_access_token: profile.accessToken,
      microsoft_refresh_token: profile.refreshToken,
      token_expires_at: profile.expiresAt?.toISOString(),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error storing user profile:', error);
  }
}

/**
 * Get stored tokens for a user
 */
export async function getStoredTokens(
  userId: string
): Promise<{
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  tenantId?: string;
} | null> {
  if (!isSupabaseConfigured()) {
    return null;
  }

  try {
    const supabase = createServerClient();

    const { data, error } = await supabase
      .from('user_profiles')
      .select('microsoft_access_token, microsoft_refresh_token, token_expires_at, intune_tenant_id')
      .eq('id', userId)
      .single();

    if (error || !data) return null;

    return {
      accessToken: data.microsoft_access_token ?? undefined,
      refreshToken: data.microsoft_refresh_token ?? undefined,
      expiresAt: data.token_expires_at ? new Date(data.token_expires_at) : undefined,
      tenantId: data.intune_tenant_id ?? undefined,
    };
  } catch (error) {
    console.error('Error getting stored tokens:', error);
    return null;
  }
}

/**
 * Get the Entra ID tenant ID from a token
 */
export function getTenantFromToken(accessToken: string): string | null {
  const payload = decodeToken(accessToken);
  if (!payload) return null;
  return (payload.tid as string) || null;
}

/**
 * Check if Entra ID client ID is configured
 */
export function isAzureAdConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID);
}
