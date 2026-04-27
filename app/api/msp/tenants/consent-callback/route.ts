/**
 * MSP Tenant Consent Callback
 * Handles the redirect from Microsoft after a customer admin grants consent
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyConsentState, getBaseUrl } from '@/lib/auth-utils';
import { acquireConsentToken } from '@/lib/consent-token';
import {
  logConsentCallback,
  logTokenAcquired,
  logConsentStatus,
  logPermissions,
} from '@/lib/permission-logger';

/**
 * GET /api/msp/tenants/consent-callback
 * Handle the OAuth consent callback from Microsoft
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Microsoft sends these parameters after consent
  const adminConsent = searchParams.get('admin_consent');
  const tenantId = searchParams.get('tenant');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');

  // Get the base URL for redirects
  const baseUrl = getBaseUrl();

  // Log the consent callback receipt
  logConsentCallback(
    '/api/msp/tenants/consent-callback',
    tenantId || 'unknown',
    adminConsent,
    error || undefined
  );

  // Handle error from Microsoft
  if (error) {
    logConsentStatus(
      '/api/msp/tenants/consent-callback',
      tenantId || 'unknown',
      'denied',
      undefined,
      { errorCode: error, errorDescription }
    );

    // Redirect to error page
    const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
    errorUrl.searchParams.set('error', 'consent_denied');
    errorUrl.searchParams.set('message', errorDescription || 'Consent was denied');

    return NextResponse.redirect(errorUrl);
  }

  // Verify consent was granted
  if (adminConsent !== 'True') {
    const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
    errorUrl.searchParams.set('error', 'consent_not_granted');
    errorUrl.searchParams.set('message', 'Admin consent was not granted');

    return NextResponse.redirect(errorUrl);
  }

  // Verify and parse the signed state parameter
  if (!state) {
    const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
    errorUrl.searchParams.set('error', 'invalid_state');
    errorUrl.searchParams.set('message', 'Missing state parameter');

    return NextResponse.redirect(errorUrl);
  }

  const stateData = verifyConsentState(state);

  if (!stateData) {
    const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
    errorUrl.searchParams.set('error', 'invalid_state');
    errorUrl.searchParams.set('message', 'Invalid or expired consent link. Please generate a new one.');

    return NextResponse.redirect(errorUrl);
  }

  const { mspOrgId, tenantRecordId } = stateData;

  if (!tenantId) {
    const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
    errorUrl.searchParams.set('error', 'missing_tenant');
    errorUrl.searchParams.set('message', 'No tenant ID received from Microsoft');

    return NextResponse.redirect(errorUrl);
  }

  try {
    const supabase = createServerClient();

    // Verify the tenant record exists and belongs to the MSP org
    const { data: tenantRecord, error: fetchError } = await supabase
      .from('msp_managed_tenants')
      .select('*')
      .eq('id', tenantRecordId)
      .eq('msp_organization_id', mspOrgId)
      .single();

    if (fetchError || !tenantRecord) {
      const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
      errorUrl.searchParams.set('error', 'tenant_not_found');
      errorUrl.searchParams.set('message', 'Tenant record not found');

      return NextResponse.redirect(errorUrl);
    }

    // Check if this tenant is already linked to another tenant ID
    if (tenantRecord.tenant_id && tenantRecord.tenant_id !== tenantId) {
      const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
      errorUrl.searchParams.set('error', 'tenant_mismatch');
      errorUrl.searchParams.set('message', 'This record is already linked to a different tenant');

      return NextResponse.redirect(errorUrl);
    }

    // Check if this tenant ID is already managed by this MSP
    const { data: existingTenant } = await supabase
      .from('msp_managed_tenants')
      .select('id, display_name')
      .eq('msp_organization_id', mspOrgId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .neq('id', tenantRecordId)
      .single();

    if (existingTenant) {
      // This tenant is already managed - update the existing record and delete this one
      await supabase
        .from('msp_managed_tenants')
        .delete()
        .eq('id', tenantRecordId);

      const successUrl = new URL('/dashboard/msp/tenants', baseUrl);
      successUrl.searchParams.set('success', 'already_managed');
      successUrl.searchParams.set('message', `This tenant is already managed as "${existingTenant.display_name}"`);

      return NextResponse.redirect(successUrl);
    }

    // Try to get tenant name from Microsoft Graph (optional)
    let tenantName: string | null = null;
    try {
      // We can't easily get tenant info without an access token here
      // The tenant name will be updated when the MSP user interacts with this tenant
      tenantName = null;
    } catch {
      // Ignore errors getting tenant name
    }

    // Update the tenant record with consent info
    const { error: updateError } = await supabase
      .from('msp_managed_tenants')
      .update({
        tenant_id: tenantId,
        tenant_name: tenantName,
        consent_status: 'granted',
        consent_granted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenantRecordId);

    if (updateError) {
      const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
      errorUrl.searchParams.set('error', 'update_failed');
      errorUrl.searchParams.set('message', 'Failed to update tenant record');

      return NextResponse.redirect(errorUrl);
    }

    // Verify actual Intune permissions BEFORE writing the tenant_consent
    // cache record. The /api/package fast path trusts a present `is_active: true`
    // record to skip live verification, so we must not create one until we've
    // confirmed the required role is in the JWT. Uses the shared
    // acquireConsentToken so error classification matches the user-facing
    // verify-consent endpoint.
    let permissionVerified = false;

    const tokenResult = await acquireConsentToken(tenantId);

    if (tokenResult.ok) {
      try {
        const tokenPayload = JSON.parse(
          Buffer.from(tokenResult.accessToken.split('.')[1], 'base64').toString()
        );
        const roles: string[] = tokenPayload.roles || [];

        logTokenAcquired('/api/msp/tenants/consent-callback', tenantId, roles);

        permissionVerified = roles.includes('DeviceManagementApps.ReadWrite.All');

        if (!permissionVerified) {
          logConsentStatus(
            '/api/msp/tenants/consent-callback',
            tenantId,
            'incomplete',
            roles,
            { reason: 'missing_intune_permission' }
          );

          await supabase
            .from('msp_managed_tenants')
            .update({
              consent_status: 'consent_incomplete',
              updated_at: new Date().toISOString(),
            })
            .eq('id', tenantRecordId);
        } else {
          logConsentStatus(
            '/api/msp/tenants/consent-callback',
            tenantId,
            'granted',
            roles,
            { tenantRecordId }
          );
        }
      } catch (verifyError) {
        logPermissions({
          route: '/api/msp/tenants/consent-callback',
          action: 'permission_verification_error',
          tenantId,
          granted: false,
          error: 'verification_exception',
          details: { error: String(verifyError) },
        });
        // Continue - we'll catch this at deployment time
      }
    } else {
      // Token acquisition failed (consent_not_granted, network_error, or
      // missing_credentials). The earlier unconditional update set
      // msp_managed_tenants.consent_status='granted' optimistically — reset
      // it to 'consent_incomplete' so the table doesn't end up claiming a
      // tenant has consented when it actually hasn't.
      await supabase
        .from('msp_managed_tenants')
        .update({
          consent_status: 'consent_incomplete',
          updated_at: new Date().toISOString(),
        })
        .eq('id', tenantRecordId);

      logPermissions({
        route: '/api/msp/tenants/consent-callback',
        action: 'token_acquisition_failed',
        tenantId,
        granted: false,
        error: tokenResult.error,
        details: {
          errorCode: tokenResult.errorCode,
          errorDescription: tokenResult.errorDescription,
        },
      });
    }

    // Only persist the tenant_consent cache record after the live token+role
    // check actually confirms the required permission. A failed/transient
    // verification must not leave behind an `is_active: true` record that
    // would let /api/package skip live verification and silently queue jobs
    // that will 401 at upload time.
    if (permissionVerified) {
      const { error: consentTrackingError } = await supabase
        .from('tenant_consent')
        .upsert({
          tenant_id: tenantId,
          tenant_name: tenantName,
          consented_by_user_id: tenantRecord.added_by_user_id,
          consent_granted_at: new Date().toISOString(),
          is_active: true,
        }, {
          onConflict: 'tenant_id',
        });

      if (consentTrackingError) {
        // Log but don't fail - msp_managed_tenants is the authoritative MSP record
      }
    }

    // Modify the success redirect based on verification result
    if (!permissionVerified) {
      const warningUrl = new URL('/dashboard/msp/tenants', baseUrl);
      warningUrl.searchParams.set('warning', 'incomplete_permissions');
      warningUrl.searchParams.set('tenant', tenantRecordId);
      warningUrl.searchParams.set('message', 'Consent granted but Intune permissions could not be verified. The customer admin may need to re-grant consent, or Microsoft may still be propagating permissions — please retry in a few minutes.');

      return NextResponse.redirect(warningUrl);
    }

    // Redirect to success page
    const successUrl = new URL('/dashboard/msp/tenants', baseUrl);
    successUrl.searchParams.set('success', 'consent_granted');
    successUrl.searchParams.set('tenant', tenantRecordId);

    return NextResponse.redirect(successUrl);
  } catch (err) {
    const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
    errorUrl.searchParams.set('error', 'internal_error');
    errorUrl.searchParams.set('message', 'An unexpected error occurred');

    return NextResponse.redirect(errorUrl);
  }
}
