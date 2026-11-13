/**
 * MSP Tenant Consent Callback
 * Receives the redirect from Microsoft after the admin consent screen.
 *
 * This route never links a tenant. The `tenant` and `admin_consent` values
 * Microsoft appends are plain query parameters that anyone holding a consent
 * link can type into the address bar, so they are treated as a hint only.
 * The link is created by a signed-in administrator of the customer tenant in
 * /api/msp/tenants/consent-approval. Here we only check that the round trip
 * belongs to an open request and send the browser on to the approval page.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getBaseUrl } from '@/lib/auth-utils';
import { loadApprovalRequest } from '@/lib/msp/consent-approval';
import { logConsentCallback, logConsentStatus } from '@/lib/permission-logger';

const ROUTE = '/api/msp/tenants/consent-callback';
const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function approvalPage(params: Record<string, string>): NextResponse {
  const url = new URL('/msp/consent/approve', getBaseUrl());
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

/**
 * GET /api/msp/tenants/consent-callback
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const adminConsent = searchParams.get('admin_consent');
  const tenantParam = searchParams.get('tenant');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  // Only a well formed tenant id is kept, and only for the log line.
  const tenantHint = tenantParam && TENANT_ID_PATTERN.test(tenantParam) ? tenantParam.toLowerCase() : null;

  logConsentCallback(ROUTE, tenantHint || 'unknown', adminConsent, error || undefined);

  // Outcomes are passed as fixed codes. Free text from the query string (for
  // example error_description) is never forwarded to a page.
  if (error) {
    logConsentStatus(ROUTE, tenantHint || 'unknown', 'denied', undefined, { errorCode: error.slice(0, 100) });
    return approvalPage({ error: 'consent_denied' });
  }

  if (adminConsent !== 'True') {
    return approvalPage({ error: 'consent_not_granted' });
  }

  try {
    const result = await loadApprovalRequest(createServerClient(), state);
    if (!result.ok) {
      return approvalPage({ error: result.code });
    }

    return approvalPage({ state: state as string });
  } catch {
    return approvalPage({ error: 'internal_error' });
  }
}
