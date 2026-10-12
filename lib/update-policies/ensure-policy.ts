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
import { getDatabase, isSqliteMode } from '@/lib/db';
import {
  buildDeploymentConfigForApp,
  buildDeploymentConfigFromAdapter,
} from '@/lib/update-policies/build-deployment-config';
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
  const { userId, tenantId, wingetId, policyType, deployedVersion } = args;

  try {
    // Self-hosted SQLite mode: no Supabase client, so build the config and
    // write the policy through the database adapter.
    if (isSqliteMode()) {
      const database = getDatabase();
      let deploymentConfig = null;
      let originalUploadHistoryId = null;

      if (policyType === 'auto_update') {
        const built = await buildDeploymentConfigFromAdapter(database, {
          userId,
          tenantId,
          wingetId,
          latestVersion: deployedVersion,
        });
        if (built.status !== 'ok') {
          return { status: 'skipped', reason: 'config_unavailable' };
        }
        deploymentConfig = built.deploymentConfig;
        originalUploadHistoryId = built.originalUploadHistoryId;
      }

      await database.updatePolicies.upsert({
        user_id: userId,
        tenant_id: tenantId,
        winget_id: wingetId,
        policy_type: policyType,
        pinned_version: null,
        deployment_config: deploymentConfig,
        original_upload_history_id: originalUploadHistoryId,
        is_enabled: true,
        updated_at: new Date().toISOString(),
      });

      return { status: 'saved' };
    }

    if (!isSupabaseServerConfigured()) {
      return { status: 'skipped', reason: 'not_configured' };
    }

    const supabase = createServerClient();

    let deploymentConfig: Json | null = null;
    let originalUploadHistoryId: string | null = null;

    if (policyType === 'auto_update') {
      const built = await buildDeploymentConfigForApp(supabase, {
        userId,
        tenantId,
        wingetId,
        latestVersion: deployedVersion,
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
