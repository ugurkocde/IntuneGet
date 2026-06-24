/**
 * Intune App Settings API Route
 * Updates assignments and categories on an existing Intune app without repackaging
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import {
  getApp,
  assignToGroups,
  convertToGraphAssignments,
  syncAppCategories,
} from '@/lib/intune-api';
import { parseAccessToken } from '@/lib/auth-utils';
import type { PackageAssignment, IntuneAppCategorySelection } from '@/types/upload';
import type { Json } from '@/types/database';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: intuneAppId } = await params;

    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Resolve tenant (MSP-aware)
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

    const tenantId = tenantResolution.tenantId;

    // Verify admin consent
    const { data: consentData, error: consentError } = await supabase
      .from('tenant_consent')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (consentError || !consentData) {
      return NextResponse.json(
        { error: 'Admin consent not found. Please complete the admin consent flow.' },
        { status: 403 }
      );
    }

    // Get service principal token
    const graphToken = await getServicePrincipalToken(tenantId);

    if (!graphToken) {
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    // Verify the app still exists in Intune
    const existingApp = await getApp(graphToken, intuneAppId);

    if (!existingApp) {
      return NextResponse.json(
        { error: 'App not found in Intune. It may have been deleted. Try redeploying instead.' },
        { status: 404 }
      );
    }

    // Parse request body
    const body = await request.json();
    const {
      assignments,
      categories,
      wingetId,
    } = body as {
      assignments?: PackageAssignment[];
      categories?: IntuneAppCategorySelection[];
      wingetId?: string;
    };

    // Apply assignments
    if (assignments) {
      const graphAssignments = convertToGraphAssignments(assignments);
      await assignToGroups(graphToken, intuneAppId, graphAssignments);
    }

    // Sync categories
    if (categories) {
      await syncAppCategories(graphToken, intuneAppId, categories);
    }

    // Persist updated assignments/categories in the most recent packaging_jobs row
    if (wingetId) {
      const { data: latestJob } = await supabase
        .from('packaging_jobs')
        .select('id, package_config')
        .eq('user_id', user.userId)
        .eq('tenant_id', tenantId)
        .eq('winget_id', wingetId)
        .eq('status', 'deployed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestJob?.package_config && typeof latestJob.package_config === 'object' && !Array.isArray(latestJob.package_config)) {
        const updatedConfig: Record<string, Json | undefined> = {
          ...(latestJob.package_config as Record<string, Json | undefined>),
        };
        if (assignments) {
          updatedConfig.assignments = assignments as unknown as Json;
        }
        if (categories) {
          updatedConfig.categories = categories as unknown as Json;
        }
        await supabase
          .from('packaging_jobs')
          .update({ package_config: updatedConfig })
          .eq('id', latestJob.id);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update app settings';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
