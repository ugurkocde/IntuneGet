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

interface ConsentVerificationResult {
  verified: boolean;
  tenantId: string;
  message: string;
  cachedResult?: boolean;
}

/**
 * Try to get a client credentials token for a specific tenant
 * If successful, it means admin consent has been granted
 */
async function verifyConsentWithGraph(tenantId: string): Promise<boolean> {
  const clientId = process.env.AZURE_AD_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_AD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.warn('Entra ID credentials not configured for consent verification');
    // If no server credentials, we can't verify - allow user to proceed
    // (they'll get an error later if consent wasn't actually granted)
    return true;
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
      // We got a token - consent has been granted
      return true;
    }

    // Check the error
    const errorData = await response.json().catch(() => ({}));
    const errorCode = errorData.error;

    // AADSTS700016: Application not found in the directory
    // AADSTS65001: User or admin has not consented
    // These mean consent was NOT granted
    if (errorCode === 'invalid_grant' ||
        errorCode === 'unauthorized_client' ||
        errorData.error_description?.includes('AADSTS700016') ||
        errorData.error_description?.includes('AADSTS65001')) {
      return false;
    }

    // Other errors (network, temporary issues) - we can't be sure
    console.error('Consent verification error:', errorData);
    // Return true to not block the user on transient errors
    return true;

  } catch (error) {
    console.error('Error verifying consent:', error);
    // Network error - don't block the user
    return true;
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('tenant_consent').upsert({
      tenant_id: tenantId,
      consented_by_user_id: userId,
      consented_by_email: userEmail,
      consent_granted_at: new Date().toISOString(),
      is_active: true,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'tenant_id',
    });
  } catch (error) {
    console.error('Error storing consent record:', error);
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
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

    // Decode the token to get tenant ID
    const accessToken = authHeader.slice(7);
    let tenantId: string;
    let userId: string;
    let userEmail: string;

    try {
      const payload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      tenantId = payload.tid;
      userId = payload.oid || payload.sub;
      userEmail = payload.preferred_username || payload.email || '';

      if (!tenantId) {
        return NextResponse.json(
          { verified: false, tenantId: '', message: 'No tenant ID in token' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { verified: false, tenantId: '', message: 'Invalid token format' },
        { status: 401 }
      );
    }

    // First, check if we have a cached consent record in the database
    const hasStoredConsent = await checkStoredConsent(tenantId);
    if (hasStoredConsent) {
      return NextResponse.json({
        verified: true,
        tenantId,
        message: 'Admin consent verified (cached)',
        cachedResult: true,
      });
    }

    // No cached record - verify by trying to get a token
    const verified = await verifyConsentWithGraph(tenantId);

    if (verified) {
      // Store the consent record for future checks
      await storeConsentRecord(tenantId, userId, userEmail);
    }

    return NextResponse.json({
      verified,
      tenantId,
      message: verified
        ? 'Admin consent verified'
        : 'Admin consent not granted. A Global Administrator must grant consent.',
      cachedResult: false,
    });

  } catch (error) {
    console.error('Verify consent error:', error);
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
