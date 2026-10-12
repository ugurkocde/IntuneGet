import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { parseAccessToken } from '@/lib/auth-utils';
import { getServerClientOrNull } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { aggregateDashboardStats } from '@/lib/analytics/dashboard-stats';

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const scope = new URL(request.url).searchParams.get('scope') ?? 'mine';
    if (scope !== 'mine' && scope !== 'tenant') return NextResponse.json({ error: 'Invalid statistics scope' }, { status: 400 });
    let jobs;
    if (scope === 'mine') {
      // Personal activity remains visible across the caller's tenants, including
      // customer-only MSP members whose primary tenant is not selectable.
      jobs = await getDatabase().jobs.getAnalyticsJobs({ userId: user.userId });
    } else {
      const supabase = getServerClientOrNull();
      const requestedTenantId = request.headers.get('X-MSP-Tenant-Id');
      let tenantId = user.tenantId;
      if (supabase) {
        const resolved = await resolveTargetTenantId({ supabase, userId: user.userId, tokenTenantId: user.tenantId, requestedTenantId });
        if (resolved.errorResponse) return resolved.errorResponse;
        tenantId = resolved.tenantId;
      } else if (requestedTenantId) {
        return NextResponse.json({ error: 'Tenant selection requires MSP access' }, { status: 400 });
      }
      jobs = await getDatabase().jobs.getAnalyticsJobs({ tenantId });
    }
    return NextResponse.json({ ...aggregateDashboardStats(jobs, scope === 'tenant'), scope }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch statistics' }, { status: 503 });
  }
}
