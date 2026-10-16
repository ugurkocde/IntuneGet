import { NextRequest, NextResponse } from 'next/server';
import { getServerClientOrNull } from '@/lib/supabase';
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
    const intuneAppId = searchParams.get('intuneAppId');

    if (!wingetId) {
      return NextResponse.json(
        { error: 'wingetId parameter required' },
        { status: 400 }
      );
    }

    const supabase = getServerClientOrNull();
    const mspTenantId = request.headers.get('X-MSP-Tenant-Id');

    if (!supabase) {
      const job = await getDatabase().jobs.getLatestDeployed(
        user.userId, user.tenantId, wingetId, intuneAppId ?? undefined
      );
      return NextResponse.json({
        config: job?.package_config ?? null,
        deployedAt: job?.completed_at ?? null,
        intuneAppId: job?.intune_app_id ?? null,
      });
    }

    const tenantResolution = await resolveTargetTenantId({
      supabase,
      userId: user.userId,
      tokenTenantId: user.tenantId,
      requestedTenantId: mspTenantId,
    });

    if (tenantResolution.errorResponse) {
      return tenantResolution.errorResponse;
    }

    // Get the most recent successfully deployed job's package_config
    let query = supabase
      .from('packaging_jobs')
      .select('package_config, completed_at, intune_app_id')
      .eq('user_id', user.userId)
      .eq('tenant_id', tenantResolution.tenantId)
      .eq('winget_id', wingetId)
      .eq('status', 'deployed');
    if (intuneAppId !== null) query = query.eq('intune_app_id', intuneAppId);
    const { data, error } = await query
      .order('completed_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({
        config: null,
        deployedAt: null,
        intuneAppId: null,
      });
    }

    return NextResponse.json({
      config: data.package_config,
      deployedAt: data.completed_at,
      intuneAppId: data.intune_app_id || null,
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
