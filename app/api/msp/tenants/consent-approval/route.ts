/**
 * MSP link approval by the customer.
 *
 * GET  ?state=...  describes the open request to a signed-in user.
 * POST { state }   links the caller's own tenant to the MSP, when the caller
 *                  is an administrator of that tenant.
 *
 * See lib/msp/consent-approval.ts for why this step exists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { getRequestMetadata } from '@/lib/audit-logger';
import { applyRateLimit, getIpKey, STRICT_RATE_LIMIT } from '@/lib/rate-limit';
import { TENANT_APPROVER_ROLE_NAMES } from '@/lib/auth/directory-roles';
import {
  approveLink,
  checkApprover,
  loadApprovalRequest,
  type ConsentApprovalErrorCode,
} from '@/lib/msp/consent-approval';

const ERROR_STATUS: Record<ConsentApprovalErrorCode, number> = {
  invalid_state: 400,
  request_not_found: 404,
  request_closed: 409,
  own_tenant: 403,
  tenant_mismatch: 403,
  not_administrator: 403,
  role_unknown: 403,
  update_failed: 500,
};

const ERROR_MESSAGE: Record<ConsentApprovalErrorCode, string> = {
  invalid_state: 'This link is invalid or has expired. Ask your service provider for a new one.',
  request_not_found: 'This request no longer exists. Ask your service provider for a new link.',
  request_closed: 'This request has already been completed.',
  own_tenant:
    'You are signed in with an account of the service provider. Approval has to come from an administrator of the customer organization.',
  tenant_mismatch: 'This request belongs to a different organization than the one you are signed in to.',
  not_administrator: `Approval needs one of these roles in your organization: ${TENANT_APPROVER_ROLE_NAMES.join(', ')}.`,
  role_unknown:
    'Your administrator role could not be confirmed. Sign out, sign in again and retry. If you use Privileged Identity Management, activate your role first.',
  update_failed: 'The approval could not be saved. Please try again.',
};

function errorResponse(code: ConsentApprovalErrorCode) {
  return NextResponse.json({ error: code, message: ERROR_MESSAGE[code] }, { status: ERROR_STATUS[code] });
}

export async function GET(request: NextRequest) {
  try {
    const rateLimited = await applyRateLimit(getIpKey(request), STRICT_RATE_LIMIT);
    if (rateLimited) return rateLimited;

    const authHeader = request.headers.get('Authorization');
    const user = await parseAccessToken(authHeader);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const state = new URL(request.url).searchParams.get('state');
    const loaded = await loadApprovalRequest(createServerClient(), state);
    if (!loaded.ok) {
      return errorResponse(loaded.code);
    }

    const approver = await checkApprover(loaded.request, user, authHeader);

    return NextResponse.json({
      organization_name: loaded.request.organizationName,
      requested_by: loaded.request.requestedByEmail,
      signed_in_as: user.userEmail,
      can_approve: approver.ok,
      blocked_reason: approver.ok ? null : approver.code,
      blocked_message: approver.ok ? null : ERROR_MESSAGE[approver.code],
      approver_roles: TENANT_APPROVER_ROLE_NAMES,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const rateLimited = await applyRateLimit(getIpKey(request), STRICT_RATE_LIMIT);
    if (rateLimited) return rateLimited;

    const authHeader = request.headers.get('Authorization');
    const user = await parseAccessToken(authHeader);
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as { state?: unknown } | null;
    const state = typeof body?.state === 'string' ? body.state : null;

    const supabase = createServerClient();
    const loaded = await loadApprovalRequest(supabase, state);
    if (!loaded.ok) {
      return errorResponse(loaded.code);
    }

    const approver = await checkApprover(loaded.request, user, authHeader);
    if (!approver.ok) {
      return errorResponse(approver.code);
    }

    const outcome = await approveLink(supabase, loaded.request, user, getRequestMetadata(request));
    if (!outcome.ok) {
      return errorResponse(outcome.code);
    }

    return NextResponse.json({
      status: outcome.status,
      organization_name: loaded.request.organizationName,
    });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
