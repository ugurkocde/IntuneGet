/**
 * Intune App Settings API Route
 * Updates assignments and categories on an existing Intune app without repackaging
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncAppRelationships, RelationshipUpdateError } from '@/lib/intune-relationships';
import type { AppRelationship } from '@/types/intune';
import { getServerClientOrNull } from '@/lib/supabase';
import { getDatabase } from '@/lib/db';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { getServicePrincipalToken } from '@/lib/intune/graph-client';
import {
  getApp,
  assignToGroups,
  convertToGraphAssignments,
  syncAppCategories,
  setAppRules,
} from '@/lib/intune-api';
import { buildCartItemRequirementRules } from '@/lib/requirement-rules';
import { parseAccessToken } from '@/lib/auth-utils';
import type { PackageAssignment, IntuneAppCategorySelection } from '@/types/upload';
import type { Json } from '@/types/database';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let phase: 'params' | 'authentication' | 'tenant-resolution' | 'consent' | 'graph-token' | 'app-lookup' | 'request-body' | 'local-config' | 'requirement-rules' | 'set-rules' | 'convert-assignments' | 'assignments' | 'categories' | 'config-read' | 'config-save' = 'params';
  const applied: string[] = [];
  try {
    const { id: intuneAppId } = await params;

    phase = 'authentication';
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Resolve tenant (MSP-aware)
    phase = 'tenant-resolution';
    const supabase = getServerClientOrNull();
    const mspTenantId = request.headers.get('X-MSP-Tenant-Id');

    const tenantResolution = supabase ? await resolveTargetTenantId({
      supabase,
      userId: user.userId,
      tokenTenantId: user.tenantId,
      requestedTenantId: mspTenantId,
      requiredPermission: 'deploy_apps',
    }) : { tenantId: user.tenantId, errorResponse: null };

    if (tenantResolution.errorResponse) {
      return tenantResolution.errorResponse;
    }

    const tenantId = tenantResolution.tenantId;

    phase = 'consent';
    // Verify admin consent
    const { data: consentData, error: consentError } = supabase ? await supabase
      .from('tenant_consent')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single() : { data: true, error: null };

    if (consentError || !consentData) {
      return NextResponse.json(
        { error: 'Admin consent not found. Please complete the admin consent flow.' },
        { status: 403 }
      );
    }

    phase = 'graph-token';
    // Get service principal token
    const graphToken = await getServicePrincipalToken(tenantId);

    if (!graphToken) {
      console.error('[intune-app-settings] Update failed', { phase });
      return NextResponse.json(
        { error: 'Failed to get Graph API token' },
        { status: 500 }
      );
    }

    phase = 'app-lookup';
    // Verify the app still exists in Intune
    const existingApp = await getApp(graphToken, intuneAppId);

    if (!existingApp) {
      return NextResponse.json(
        { error: 'App not found in Intune. It may have been deleted. Try redeploying instead.' },
        { status: 404 }
      );
    }

    phase = 'request-body';
    // Parse request body
    const body = await request.json();
    const {
      assignments,
      categories,
      wingetId,
      relationships,
      baselineRelationships,
    } = body as {
      assignments?: PackageAssignment[];
      categories?: IntuneAppCategorySelection[];
      wingetId?: string;
      relationships?: AppRelationship[];
      baselineRelationships?: AppRelationship[];
    };

    phase = 'local-config';
    // Validate the exact local deployment before changing its Intune settings.
    const localDb = wingetId && !supabase ? getDatabase() : null;
    const localJob = localDb && wingetId
      ? await localDb.jobs.getLatestDeployed(user.userId, tenantId, wingetId, intuneAppId)
      : null;
    const localConfig = localJob?.package_config;
    if (localDb && (!localJob || !localConfig || typeof localConfig !== 'object' || Array.isArray(localConfig))) {
      return NextResponse.json(
        { error: 'No matching local deployment configuration was found. Refresh before updating Intune settings.' },
        { status: 409 }
      );
    }

    // Relationship edits require a saved deployment bound to this user, tenant and exact app.
    // Persist this phase before any legacy assignment/category writes can fail.
    if (relationships !== undefined) {
      if (typeof wingetId !== 'string' || !wingetId) return NextResponse.json({ error: 'A matching deployed package is required.' }, { status: 400 });
      const db = getDatabase();
      const source = await db.jobs.getLatestDeployed(user.userId, tenantId, wingetId, intuneAppId);
      const config = source?.package_config;
      if (!source || !config || typeof config !== 'object' || Array.isArray(config)) return NextResponse.json({ error: 'Refresh the matching deployed package before updating relationships.' }, { status: 409 });
      if (!Array.isArray(baselineRelationships) || JSON.stringify(baselineRelationships) !== JSON.stringify(config.relationships ?? [])) {
        return NextResponse.json({ error: 'The saved relationships changed. Refresh the app before trying again.' }, { status: 409 });
      }
      const savedRelationships = await syncAppRelationships(graphToken, intuneAppId, (config.relationships ?? []) as unknown as AppRelationship[], relationships);
      applied.push('relationships');
      const fields = { relationships: savedRelationships };
      if (!supabase) {
        const { sqliteDeployedConfig } = await import('@/lib/db/sqlite');
        if (!sqliteDeployedConfig.mergeFields(source.id, { userId: user.userId, tenantId, wingetId, intuneAppId }, fields, source.updated_at)) throw new Error('Save failed');
      } else {
        // Compare the source snapshot so a concurrent settings write is never overwritten.
        const { data: saved, error } = await supabase.from('packaging_jobs')
          .update({ package_config: { ...config, relationships: savedRelationships } as unknown as Json })
          .eq('id', source.id).eq('user_id', user.userId).eq('tenant_id', tenantId)
          .eq('winget_id', wingetId).eq('intune_app_id', intuneAppId).eq('status', 'deployed')
          .is('archived_at', null).eq('updated_at', source.updated_at).select('id').maybeSingle();
        if (error || !saved) throw new Error('Save failed');
      }
    }

    // Apply assignments
    if (assignments) {
      phase = 'requirement-rules';
      const productCode = existingApp.msiInformation?.productCode;
      const requirementRules = buildCartItemRequirementRules(
        existingApp.displayName,
        productCode ? 'msi' : 'exe',
        productCode,
        assignments
      );
      // Skip when the app already carries requirement rules so repeated
      // settings updates do not stack duplicates onto the rules array.
      const existingRules = existingApp.rules ?? [];
      const hasRequirementRule = existingRules.some(
        (rule) => rule.ruleType === 'requirement'
      );
      if (requirementRules && !hasRequirementRule) {
        phase = 'set-rules';
        await setAppRules(graphToken, intuneAppId, [
          ...existingRules,
          ...requirementRules,
        ]);
      }

      phase = 'convert-assignments';
      const graphAssignments = convertToGraphAssignments(assignments);
      phase = 'assignments';
      await assignToGroups(graphToken, intuneAppId, graphAssignments);
    }

    // Sync categories
    if (categories) {
      phase = 'categories';
      await syncAppCategories(graphToken, intuneAppId, categories);
    }

    // Persist updated assignments/categories in the most recent packaging_jobs row
    if (wingetId && supabase && (assignments || categories)) {
      phase = 'config-read';
      const { data: latestJob } = await supabase
        .from('packaging_jobs')
        .select('id, package_config, updated_at')
        .eq('user_id', user.userId)
        .eq('tenant_id', tenantId)
        .eq('winget_id', wingetId)
        .eq('intune_app_id', intuneAppId)
        .eq('status', 'deployed')
        .order('completed_at', { ascending: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
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
        phase = 'config-save';
        const { data: saved, error: saveError } = await supabase
          .from('packaging_jobs')
          .update({ package_config: updatedConfig })
          .eq('id', latestJob.id)
          .eq('updated_at', latestJob.updated_at)
          .eq('user_id', user.userId)
          .eq('tenant_id', tenantId)
          .eq('winget_id', wingetId)
          .eq('intune_app_id', intuneAppId)
          .eq('status', 'deployed')
          .select('id')
          .maybeSingle();
        if (saveError || !saved) {
          return NextResponse.json(
            { error: 'Intune settings were updated, but the deployment configuration could not be saved. Refresh before trying again.' },
            { status: 409 }
          );
        }
      } else {
        return NextResponse.json(
          { error: 'Intune settings were updated, but no matching deployment configuration was available to save. Refresh before trying again.' },
          { status: 409 }
        );
      }
    } else if (localDb && localJob && localConfig && typeof localConfig === 'object' && !Array.isArray(localConfig)) {
      phase = 'config-save';
      const { sqliteDeployedConfig } = await import('@/lib/db/sqlite');
      const saved = sqliteDeployedConfig.mergeFields(localJob.id, {
        userId: user.userId, tenantId, wingetId: wingetId!, intuneAppId,
      }, { assignments, categories });
      if (!saved) {
        return NextResponse.json(
          { error: 'Intune settings were updated, but the local deployment changed before they could be saved. Refresh the deployment before trying again.' },
          { status: 409 }
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof RelationshipUpdateError) {
      return NextResponse.json({ error: err.kind === 'approval_pending' ? 'Relationship update is awaiting administrator approval. Refresh before trying again.' : err.message, pending: err.kind === 'approval_pending', mayHaveApplied: err.mayHaveApplied, applied }, { status: err.kind === 'invalid' ? 400 : 409 });
    }
    if (applied.length) return NextResponse.json({ error: 'Relationships were applied, but the remaining settings or saved configuration could not be updated. Refresh before trying again.', applied }, { status: 409 });
    // Log only a fixed phase. Errors and request data may contain customer secrets.
    const errorKind = err instanceof Error && ['Error', 'TypeError', 'SyntaxError', 'AbortError'].includes(err.name)
      ? err.name : 'other';
    console.error('[intune-app-settings] Update failed', { phase, errorKind });
    return NextResponse.json(
      { error: 'Failed to update app settings' },
      { status: 500 }
    );
  }
}
