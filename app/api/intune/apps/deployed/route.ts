import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';

interface UploadHistoryRow {
  winget_id: string;
}

interface TenantJobRow {
  winget_id: string;
  user_email: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

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

    // scope=tenant returns every user's IntuneGet deployments in the tenant
    // (with attribution) so the cart can warn about apps a teammate already
    // deployed. packaging_jobs carries user_email; upload_history does not.
    const scope = new URL(request.url).searchParams.get('scope');
    if (scope === 'tenant') {
      const { data, error } = await supabase
        .from('packaging_jobs')
        .select('winget_id, user_email')
        .eq('tenant_id', tenantResolution.tenantId)
        .eq('status', 'deployed');

      if (error) {
        return NextResponse.json(
          { error: 'Failed to fetch tenant deployed packages' },
          { status: 500 }
        );
      }

      const byWingetId = new Map<string, string | null>();
      for (const row of (data || []) as TenantJobRow[]) {
        if (row.winget_id && !byWingetId.has(row.winget_id)) {
          byWingetId.set(row.winget_id, row.user_email);
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

    const { data, error } = await supabase
      .from('upload_history')
      .select('winget_id')
      .eq('user_id', user.userId)
      .eq('intune_tenant_id', tenantResolution.tenantId);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch deployed packages' },
        { status: 500 }
      );
    }

    const deployedWingetIds = Array.from(
      new Set(
        ((data || []) as UploadHistoryRow[])
          .map((row) => row.winget_id)
          .filter(Boolean)
      )
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
