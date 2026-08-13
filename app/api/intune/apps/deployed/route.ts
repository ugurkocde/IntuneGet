import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { getDatabase } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // MSP tenant resolution requires Supabase; fall back to the token's own
    // tenant in Supabase-less SQLite installs (matches the pattern in
    // unmanaged-apps/route.ts). The deployment lookups below go through the
    // db abstraction, which already supports both SQLite and Supabase.
    let tenantId = user.tenantId;
    if (isSupabaseConfigured()) {
      const supabase = createServerClient();
      const mspTenantId = request.headers.get('X-MSP-Tenant-Id');

      const tenantResolution = await resolveTargetTenantId({
        supabase,
        userId: user.userId,
        tokenTenantId: user.tenantId,
        requestedTenantId: mspTenantId,
      });

      if (tenantResolution.errorResponse) {
        return tenantResolution.errorResponse;
      }

      tenantId = tenantResolution.tenantId;
    }

    const db = getDatabase();

    // scope=tenant returns every user's IntuneGet deployments in the tenant
    // (with attribution) so the cart can warn about apps a teammate already
    // deployed. packaging_jobs carries user_email; upload_history does not.
    const scope = new URL(request.url).searchParams.get('scope');
    if (scope === 'tenant') {
      const tenantJobs = await db.jobs.getByTenantIdAndStatus(tenantId, 'deployed');

      const byWingetId = new Map<string, string | null>();
      for (const job of tenantJobs) {
        if (job.winget_id && !byWingetId.has(job.winget_id)) {
          byWingetId.set(job.winget_id, job.user_email);
        }
      }

      const tenantDeployments = Array.from(byWingetId, ([wingetId, deployedBy]) => ({
        wingetId,
        deployedBy,
      }));

      return NextResponse.json({
        tenantDeployments,
        deployedWingetIds: tenantDeployments.map((d) => d.wingetId),
        count: tenantDeployments.length,
        scope: 'tenant',
      });
    }

    const history = await db.uploadHistory.getByUserIdAndTenantId(user.userId, tenantId);
    const deployedWingetIds = Array.from(
      new Set(history.map((row) => row.winget_id).filter(Boolean))
    );

    return NextResponse.json({
      deployedWingetIds,
      count: deployedWingetIds.length,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
