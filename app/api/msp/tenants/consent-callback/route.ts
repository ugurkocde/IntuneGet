/**
 * MSP Tenant Consent Callback
 * Handles the redirect from Microsoft after a customer admin grants consent
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { verifyConsentState, getBaseUrl } from '@/lib/auth-utils';

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

  // Handle error from Microsoft
  if (error) {
    console.error('Consent error:', error, errorDescription);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tenantRecord, error: fetchError } = await (supabase as any)
      .from('msp_managed_tenants')
      .select('*')
      .eq('id', tenantRecordId)
      .eq('msp_organization_id', mspOrgId)
      .single();

    if (fetchError || !tenantRecord) {
      console.error('Tenant record not found:', fetchError);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingTenant } = await (supabase as any)
      .from('msp_managed_tenants')
      .select('id, display_name')
      .eq('msp_organization_id', mspOrgId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .neq('id', tenantRecordId)
      .single();

    if (existingTenant) {
      // This tenant is already managed - update the existing record and delete this one
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: updateError } = await (supabase as any)
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
      console.error('Error updating tenant record:', updateError);

      const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
      errorUrl.searchParams.set('error', 'update_failed');
      errorUrl.searchParams.set('message', 'Failed to update tenant record');

      return NextResponse.redirect(errorUrl);
    }

    // Also record this in tenant_consent for general tracking
    // This is a secondary record; errors here shouldn't fail the consent flow
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: consentTrackingError } = await (supabase as any)
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
      // Log but don't fail - the main record is already updated
      console.warn('Failed to update tenant_consent tracking:', consentTrackingError);
    }

    // Redirect to success page
    const successUrl = new URL('/dashboard/msp/tenants', baseUrl);
    successUrl.searchParams.set('success', 'consent_granted');
    successUrl.searchParams.set('tenant', tenantRecordId);

    return NextResponse.redirect(successUrl);
  } catch (err) {
    console.error('Consent callback error:', err);

    const errorUrl = new URL('/dashboard/msp/tenants', baseUrl);
    errorUrl.searchParams.set('error', 'internal_error');
    errorUrl.searchParams.set('message', 'An unexpected error occurred');

    return NextResponse.redirect(errorUrl);
  }
}
