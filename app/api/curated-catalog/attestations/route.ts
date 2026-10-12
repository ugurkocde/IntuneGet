/**
 * Curated licence attestations
 * Lets a user who can deploy to a tenant record that the tenant accepts the
 * publisher licence agreement a curated application requires. Packaging and
 * dispatch routes verify the stored acceptance server-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { parseAccessToken } from '@/lib/auth-utils';
import { createServerClient, isSupabaseServerConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { hasPermission, type MspRole } from '@/lib/msp-permissions';
import { getDatabase } from '@/lib/db';
import { CURATED_APPS } from '@/lib/curated-catalog/definitions';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

type Caller =
  | { errorResponse: NextResponse }
  | {
      errorResponse: null;
      user: NonNullable<Awaited<ReturnType<typeof parseAccessToken>>>;
      tenantId: string;
      supabase: ReturnType<typeof createServerClient> | null;
    };

async function resolveCaller(request: NextRequest): Promise<Caller> {
  const user = await parseAccessToken(request.headers.get('Authorization'));
  if (!user) {
    return { errorResponse: NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE }) };
  }
  if (!isSupabaseServerConfigured()) {
    return { user, tenantId: user.tenantId, supabase: null, errorResponse: null };
  }
  const supabase = createServerClient();
  const { tenantId, errorResponse } = await resolveTargetTenantId({
    supabase,
    userId: user.userId,
    tokenTenantId: user.tenantId,
    requestedTenantId: request.headers.get('X-MSP-Tenant-Id'),
  });
  return errorResponse ? { errorResponse } : { user, tenantId, supabase, errorResponse: null };
}

function requirements() {
  return CURATED_APPS.flatMap(app => app.licenceAttestation ? [{ app, attestation: app.licenceAttestation }] : []);
}

export async function GET(request: NextRequest) {
  try {
    const caller = await resolveCaller(request);
    if (caller.errorResponse) return caller.errorResponse;
    const accepted = await getDatabase().curatedLicenceAttestations.listByTenant(caller.tenantId);
    return NextResponse.json({
      attestations: requirements().map(({ app, attestation }) => {
        const record = accepted.find(entry => entry.attestation_id === attestation.id && entry.attestation_version === attestation.version);
        return {
          appId: app.id, attestation,
          accepted: Boolean(record),
          acceptedAt: record?.accepted_at ?? null,
          acceptedByEmail: record?.accepted_by_email ?? null,
        };
      }),
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('Failed to read licence acceptances:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Licence acceptances are temporarily unavailable.' }, { status: 503, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  try {
    const caller = await resolveCaller(request);
    if (caller.errorResponse) return caller.errorResponse;
    const { user, tenantId, supabase } = caller;

    // Accepting for a managed customer tenant requires the MSP deploy right.
    if (supabase && tenantId !== user.tenantId) {
      const { data: membership } = await supabase
        .from('msp_user_memberships')
        .select('role')
        .eq('user_id', user.userId)
        .single();
      if (!membership || !hasPermission(membership.role as MspRole, 'deploy_apps')) {
        return NextResponse.json(
          { error: 'You do not have permission to deploy applications to this tenant.' },
          { status: 403, headers: NO_STORE }
        );
      }
    }

    const body = await request.json().catch(() => null) as {
      appId?: unknown; attestationId?: unknown; attestationVersion?: unknown; accepted?: unknown;
    } | null;
    if (!body || body.accepted !== true || typeof body.appId !== 'string' ||
        typeof body.attestationId !== 'string' || typeof body.attestationVersion !== 'string') {
      return NextResponse.json(
        { error: 'Explicit acceptance of a specific agreement version is required.' },
        { status: 400, headers: NO_STORE }
      );
    }

    const requirement = requirements().find(({ app }) => app.id === body.appId);
    if (!requirement) {
      return NextResponse.json(
        { error: 'This application does not require a licence agreement.' },
        { status: 404, headers: NO_STORE }
      );
    }
    const { app, attestation } = requirement;
    if (attestation.id !== body.attestationId || attestation.version !== body.attestationVersion) {
      return NextResponse.json(
        { error: 'The licence agreement has changed. Review the current version and accept it again.', attestation },
        { status: 409, headers: NO_STORE }
      );
    }

    const record = await getDatabase().curatedLicenceAttestations.accept({
      tenant_id: tenantId,
      app_id: app.id,
      attestation_id: attestation.id,
      attestation_version: attestation.version,
      accepted_by_user_id: user.userId,
      accepted_by_email: user.userEmail || null,
    });
    return NextResponse.json({
      appId: app.id, attestation, accepted: true,
      acceptedAt: record.accepted_at, acceptedByEmail: record.accepted_by_email,
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('Failed to record licence acceptance:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'The licence acceptance could not be recorded. Please try again.' }, { status: 503, headers: NO_STORE });
  }
}
