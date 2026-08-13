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

    const { searchParams } = new URL(request.url);
    const wingetId = searchParams.get('wingetId');

    if (!wingetId) {
      return NextResponse.json(
        { error: 'wingetId parameter required' },
        { status: 400 }
      );
    }

    // MSP tenant resolution requires Supabase; fall back to the token's own
    // tenant in Supabase-less SQLite installs (matches the pattern in
    // unmanaged-apps/route.ts). The package_config lookup below goes through
    // the db abstraction, which already supports both SQLite and Supabase.
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

    // Get the most recent successfully deployed job's package_config
    const db = getDatabase();
    const userJobs = await db.jobs.getByUserId(user.userId, 500);
    const deployedJob = userJobs
      .filter(
        (job) =>
          job.tenant_id === tenantId &&
          job.winget_id === wingetId &&
          job.status === 'deployed'
      )
      .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))[0];

    if (!deployedJob) {
      return NextResponse.json({
        config: null,
        deployedAt: null,
        intuneAppId: null,
      });
    }

    return NextResponse.json({
      config: deployedJob.package_config,
      deployedAt: deployedJob.completed_at,
      intuneAppId: deployedJob.intune_app_id || null,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
