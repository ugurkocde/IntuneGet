import { NextRequest, NextResponse } from 'next/server';
import { parseAccessToken } from '@/lib/auth-utils';
import { createServerClient, isSupabaseServerConfigured } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { hasPermission, type MspRole } from '@/lib/msp-permissions';
import { CuratedCatalogError } from '@/lib/curated-catalog/core.mjs';
import { CuratedConfigVerificationError } from '@/lib/curated-catalog/custom-config';
import { getApprovedCuratedRelease, reconcileCuratedCartItem } from '@/lib/curated-catalog/server';
import { buildCuratedCartItem } from '@/lib/curated-catalog/package';
import { splitQaPsadtConfig } from '@/lib/qa/package-profile';
import { isWin32CartItem, type Win32CartItem } from '@/types/upload';
import type { CuratedSettingsStatus } from '@/types/curated-verification';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

// Queue/check settings before deployment. This endpoint never creates an
// Intune app or a packaging job; /api/package remains the authoritative gate.
export async function POST(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
    const supabase = isSupabaseServerConfigured() ? createServerClient() : null;
    const target = supabase ? await resolveTargetTenantId({
      supabase, userId: user.userId, tokenTenantId: user.tenantId,
      requestedTenantId: request.headers.get('X-MSP-Tenant-Id'),
    }) : { tenantId: user.tenantId, errorResponse: null };
    if (target.errorResponse) return target.errorResponse;
    if (supabase && target.tenantId !== user.tenantId) {
      const { data: membership } = await supabase.from('msp_user_memberships').select('role').eq('user_id', user.userId).single();
      if (!membership || !hasPermission(membership.role as MspRole, 'deploy_apps')) {
        return NextResponse.json({ error: 'You do not have permission to deploy applications to this tenant.' }, { status: 403, headers: NO_STORE });
      }
    }
    const body = await request.json().catch(() => null);
    if (!Array.isArray(body?.items) || body.items.length === 0 || body.items.length > 100 ||
        body.items.some((item: Win32CartItem) => !item || !isWin32CartItem(item) || item.sourceType !== 'curated' ||
          typeof item.id !== 'string' || typeof item.wingetId !== 'string' || typeof item.version !== 'string')) {
      return NextResponse.json({ error: 'Select curated applications to check their settings.' }, { status: 400, headers: NO_STORE });
    }
    const items = await Promise.all((body.items as Win32CartItem[]).map(async (item): Promise<CuratedSettingsStatus> => {
      try {
        await reconcileCuratedCartItem(item, { tenantId: target.tenantId, userId: user.userId });
        return { itemId: item.id, status: 'ready' };
      } catch (error) {
        if (error instanceof CuratedConfigVerificationError) {
          const { app, release } = getApprovedCuratedRelease(item.wingetId, item.version, item.curatedReleaseId);
          const defaults = buildCuratedCartItem(app, release).psadtConfig;
          const presentation = splitQaPsadtConfig(item.psadtConfig).presentation;
          // Restore tested execution behaviour without discarding branding.
          const defaultConfig = { ...defaults };
          for (const key of ['brandingCompanyName', 'brandingWelcomeTitle', 'brandingWelcomeMessage', 'brandingAccentColor',
            'brandingLogoPath', 'brandingLogoDarkPath', 'brandingBannerPath', 'windowLocation'] as const) {
            if (key in presentation) Object.assign(defaultConfig, { [key]: presentation[key] });
          }
          defaultConfig.progressDialog = { ...defaults.progressDialog, ...(presentation.progressDialog as object) };
          return {
            itemId: item.id, status: error.status === 'unsupported' ? 'unavailable' : error.status === 'passed' ? 'requested' : error.status,
            defaultConfig,
          };
        }
        if (error instanceof CuratedCatalogError) return { itemId: item.id, status: 'unavailable' };
        throw error;
      }
    }));
    return NextResponse.json({ items }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: 'Could not check deployment settings. Please try again.' }, { status: 503, headers: NO_STORE });
  }
}
