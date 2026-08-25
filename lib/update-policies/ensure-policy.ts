/**
 * Deploy-time update policy creation.
 *
 * When a user picks an update policy in the cart (PackageConfig /
 * CartItemConfig), the choice travels on the cart item into
 * packaging_jobs.package_config and is materialized here once the deployment
 * completes, i.e. the moment an upload_history row exists. That row is what
 * makes an auto_update policy usable by the cron trigger (the
 * requirePriorDeployment gate needs original_upload_history_id).
 *
 * "Notify" is the implicit default and never writes a row, so redeploying
 * without an explicit choice preserves any policy set earlier on the Updates
 * page.
 */

import { createServerClient, isSupabaseServerConfigured } from '@/lib/supabase';
import { buildDeploymentConfigForApp } from '@/lib/update-policies/build-deployment-config';
import type { Json } from '@/types/database';

export type CartUpdatePolicyChoice = 'auto_update' | 'ignore';

export function parseCartUpdatePolicy(packageConfig: unknown): CartUpdatePolicyChoice | null {
  if (typeof packageConfig !== 'object' || packageConfig === null || Array.isArray(packageConfig)) {
    return null;
  }
  const value = (packageConfig as Record<string, unknown>).updatePolicy;
  return value === 'auto_update' || value === 'ignore' ? value : null;
}

export type EnsureUpdatePolicyResult =
  | { status: 'saved' }
  | { status: 'skipped'; reason: 'not_configured' | 'config_unavailable' }
  | { status: 'error'; error: unknown };

/**
 * Upsert an app_update_policies row for a just-deployed app. Never throws;
 * callers run this as a post-deployment side effect that must not affect the
 * callback response.
 */
export async function ensureUpdatePolicy(args: {
  userId: string;
  tenantId: string;
  wingetId: string;
  policyType: CartUpdatePolicyChoice;
  deployedVersion: string;
}): Promise<EnsureUpdatePolicyResult> {
  if (!isSupabaseServerConfigured()) {
    return { status: 'skipped', reason: 'not_configured' };
  }

  try {
    const { userId, tenantId, wingetId, policyType, deployedVersion } = args;
    const supabase = createServerClient();

    let deploymentConfig: Json | null = null;
    let originalUploadHistoryId: string | null = null;

    if (policyType === 'auto_update') {
      const { data: userSettingsRow } = await (supabase as any)
        .from('user_settings')
        .select('settings')
        .eq('user_id', userId)
        .maybeSingle();
      const userSettings = (userSettingsRow?.settings as Record<string, unknown> | null) || null;
      const globalCarryOver = Boolean(userSettings?.carryOverAssignments);

      const built = await buildDeploymentConfigForApp(supabase, {
        userId,
        tenantId,
        wingetId,
        latestVersion: deployedVersion,
        globalCarryOver,
      });

      // A null-config auto_update policy is worse than no policy: nothing
      // backfills it and it blocks the trigger route's rebuild branch.
      if (built.status !== 'ok') {
        return { status: 'skipped', reason: 'config_unavailable' };
      }

      deploymentConfig = built.deploymentConfig as unknown as Json;
      originalUploadHistoryId = built.originalUploadHistoryId;
    }

    const { error } = await supabase
      .from('app_update_policies')
      .upsert(
        {
          user_id: userId,
          tenant_id: tenantId,
          winget_id: wingetId,
          policy_type: policyType,
          pinned_version: null,
          deployment_config: deploymentConfig,
          original_upload_history_id: originalUploadHistoryId,
          is_enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,tenant_id,winget_id' }
      );

    if (error) {
      return { status: 'error', error };
    }

    return { status: 'saved' };
  } catch (error) {
    return { status: 'error', error };
  }
}
