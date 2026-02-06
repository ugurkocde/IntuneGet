/**
 * SCCM Migration API Route
 * Execute migration of SCCM apps to Intune via cart workflow
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getAuthFromRequest } from '@/lib/auth/parse-token';
import { logMigrationHistoryAsync, createSuccessEntry } from '@/lib/sccm/history-logger';
import {
  prepareMigrations,
  executeMigrationBatch,
  calculateMigrationStats,
} from '@/lib/migration/migration-orchestrator';
import { convertDetectionRules, mapInstallBehavior } from '@/lib/migration/settings-converter';
import type {
  SccmApplication,
  SccmAppRecord,
  SccmMigrationOptions,
  SccmMigrationPreviewResponse,
  SccmMigrationResult,
} from '@/types/sccm';
import type {
  NormalizedPackage,
  NormalizedInstaller,
  WingetArchitecture,
  WingetInstallerType,
  WingetScope,
} from '@/types/winget';
import type { Database } from '@/types/database';

// Type aliases for database rows
type SccmAppRow = Database['public']['Tables']['sccm_apps']['Row'];
type CuratedAppRow = Pick<
  Database['public']['Tables']['curated_apps']['Row'],
  'winget_id' | 'name' | 'publisher' | 'latest_version' | 'description' | 'homepage' | 'license' | 'tags' | 'category' | 'icon_path'
>;
type VersionHistoryRow = Pick<
  Database['public']['Tables']['version_history']['Row'],
  'installers' | 'installer_url' | 'installer_sha256' | 'installer_type' | 'installer_scope'
>;

// Installer data from JSON field
interface InstallerData {
  architecture?: string;
  Architecture?: string;
  InstallerUrl?: string;
  url?: string;
  InstallerSha256?: string;
  sha256?: string;
  InstallerType?: string;
  type?: string;
  Scope?: string;
  scope?: string;
  InstallerSwitches?: { Silent?: string };
  silentArgs?: string;
  ProductCode?: string;
  productCode?: string;
}

/**
 * Convert database row to SccmAppRecord
 */
function rowToAppRecord(row: SccmAppRow): SccmAppRecord {
  return {
    id: row.id,
    migrationId: row.migration_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    sccmCiId: row.sccm_ci_id,
    displayName: row.display_name,
    manufacturer: row.manufacturer,
    version: row.version,
    technology: row.technology as SccmAppRecord['technology'],
    isDeployed: row.is_deployed,
    deploymentCount: row.deployment_count,
    sccmAppData: row.sccm_app_data as unknown as SccmApplication,
    sccmDetectionRules: row.sccm_detection_rules as unknown as SccmAppRecord['sccmDetectionRules'],
    sccmInstallCommand: row.sccm_install_command,
    sccmUninstallCommand: row.sccm_uninstall_command,
    sccmInstallBehavior: row.sccm_install_behavior,
    matchStatus: row.match_status as SccmAppRecord['matchStatus'],
    matchConfidence: row.match_confidence,
    matchedWingetId: row.matched_winget_id,
    matchedWingetName: row.matched_winget_name,
    partialMatches: row.partial_matches as unknown as SccmAppRecord['partialMatches'],
    matchedBy: row.matched_by as SccmAppRecord['matchedBy'],
    preserveDetectionRules: row.preserve_detection_rules,
    preserveInstallCommands: row.preserve_install_commands,
    useWingetDefaults: row.use_winget_defaults,
    customSettings: row.custom_settings as unknown as SccmAppRecord['customSettings'],
    convertedDetectionRules: row.converted_detection_rules as unknown as SccmAppRecord['convertedDetectionRules'],
    convertedInstallBehavior: row.converted_install_behavior as SccmAppRecord['convertedInstallBehavior'],
    migrationStatus: row.migration_status as SccmAppRecord['migrationStatus'],
    migrationError: row.migration_error || undefined,
    intuneAppId: row.intune_app_id || undefined,
    migratedAt: row.migrated_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetch WinGet package from curated_apps
 */
async function fetchWingetPackage(
  wingetId: string,
  supabase: ReturnType<typeof createServerClient>
): Promise<NormalizedPackage | null> {
  const { data, error } = (await supabase
    .from('curated_apps')
    .select('winget_id, name, publisher, latest_version, description, homepage, license, tags, category, icon_path')
    .eq('winget_id', wingetId)
    .single()) as { data: CuratedAppRow | null; error: Error | null };

  if (error || !data) {
    return null;
  }

  return {
    id: data.winget_id,
    name: data.name,
    publisher: data.publisher,
    version: data.latest_version ?? '',
    description: data.description ?? undefined,
    homepage: data.homepage ?? undefined,
    license: data.license ?? undefined,
    tags: data.tags ?? undefined,
    category: data.category ?? undefined,
    iconPath: data.icon_path ?? undefined,
  };
}

/**
 * Fetch best installer for a package from version_history
 */
async function fetchBestInstaller(
  pkg: NormalizedPackage,
  supabase: ReturnType<typeof createServerClient>
): Promise<NormalizedInstaller | null> {
  const { data, error } = (await supabase
    .from('version_history')
    .select('installers, installer_url, installer_sha256, installer_type, installer_scope')
    .eq('winget_id', pkg.id)
    .eq('version', pkg.version)
    .single()) as { data: VersionHistoryRow | null; error: Error | null };

  if (error || !data) {
    return null;
  }

  // Try to find x64 installer from installers array
  const installers = data.installers as InstallerData[] | null;
  if (installers && Array.isArray(installers)) {
    const x64 = installers.find(
      (i: InstallerData) => i.architecture === 'x64' || i.Architecture === 'x64'
    );
    if (x64) {
      return {
        architecture: 'x64' as WingetArchitecture,
        url: x64.InstallerUrl || x64.url || '',
        sha256: x64.InstallerSha256 || x64.sha256 || '',
        type: (x64.InstallerType || x64.type || 'exe').toLowerCase() as WingetInstallerType,
        scope: (x64.Scope || x64.scope) as WingetScope | undefined,
        silentArgs: x64.InstallerSwitches?.Silent || x64.silentArgs,
        productCode: x64.ProductCode || x64.productCode,
      };
    }

    // Fall back to first installer
    const first = installers[0];
    if (first) {
      return {
        architecture: (first.Architecture || first.architecture || 'x64') as WingetArchitecture,
        url: first.InstallerUrl || first.url || '',
        sha256: first.InstallerSha256 || first.sha256 || '',
        type: (first.InstallerType || first.type || 'exe').toLowerCase() as WingetInstallerType,
        scope: (first.Scope || first.scope) as WingetScope | undefined,
        silentArgs: first.InstallerSwitches?.Silent || first.silentArgs,
        productCode: first.ProductCode || first.productCode,
      };
    }
  }

  // Fall back to single installer columns
  if (data.installer_url && data.installer_sha256) {
    return {
      architecture: 'x64' as WingetArchitecture,
      url: data.installer_url,
      sha256: data.installer_sha256,
      type: (data.installer_type || 'exe') as WingetInstallerType,
      scope: data.installer_scope as WingetScope | undefined,
    };
  }

  return null;
}

/**
 * POST - Preview or execute migration
 */
export async function POST(request: NextRequest) {
  try {
    const auth = getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'preview';

    if (!body.migrationId || !body.appIds || !Array.isArray(body.appIds)) {
      return NextResponse.json(
        { error: 'Migration ID and app IDs array are required' },
        { status: 400 }
      );
    }

    const options: SccmMigrationOptions = {
      preserveDetection: body.options?.preserveDetection ?? true,
      preserveInstallCommands: body.options?.preserveInstallCommands ?? false,
      useWingetDefaults: body.options?.useWingetDefaults ?? true,
      batchSize: body.options?.batchSize ?? 10,
      dryRun: action === 'preview',
    };

    const supabase = createServerClient();

    // Verify migration ownership
    const { data: migration, error: migrationError } = (await supabase
      .from('sccm_migrations')
      .select('id, status')
      .eq('id', body.migrationId)
      .eq('tenant_id', auth.tenantId)
      .single()) as { data: { id: string; status: string } | null; error: Error | null };

    if (migrationError || !migration) {
      return NextResponse.json(
        { error: 'Migration not found' },
        { status: 404 }
      );
    }

    // Fetch apps
    const { data: appRows, error: appsError } = (await supabase
      .from('sccm_apps')
      .select('*')
      .eq('migration_id', body.migrationId)
      .in('id', body.appIds)) as { data: SccmAppRow[] | null; error: Error | null };

    if (appsError || !appRows || appRows.length === 0) {
      return NextResponse.json(
        { error: 'No apps found with the provided IDs' },
        { status: 404 }
      );
    }

    const apps = appRows.map(rowToAppRecord);

    // Pre-convert SCCM settings for apps that need it
    for (const app of apps) {
      if (options.preserveDetection && !app.convertedDetectionRules) {
        app.convertedDetectionRules = convertDetectionRules(app.sccmDetectionRules);
      }
      if (!app.convertedInstallBehavior) {
        app.convertedInstallBehavior = mapInstallBehavior(app.sccmInstallBehavior);
      }
    }

    // Prepare migrations
    const preparations = await prepareMigrations(
      apps,
      options,
      (wingetId) => fetchWingetPackage(wingetId, supabase),
      (pkg) => fetchBestInstaller(pkg, supabase)
    );

    // Preview mode - return what would be migrated
    if (action === 'preview') {
      const stats = calculateMigrationStats(preparations);

      const response: SccmMigrationPreviewResponse = {
        success: true,
        migrationId: body.migrationId,
        totalApps: preparations.length,
        migratable: stats.migratable,
        blocked: stats.blocked,
        items: preparations.map(p => p.preview),
        warnings: preparations.flatMap(p => p.preview.warnings),
      };

      return NextResponse.json(response);
    }

    // Execute mode - create cart items and update app status
    // Using type-safe update helpers - cast to unknown first to avoid TypeScript inference issues
    type SccmMigrationUpdate = Database['public']['Tables']['sccm_migrations']['Update'];
    type SccmAppUpdate = Database['public']['Tables']['sccm_apps']['Update'];
    type SupabaseClientUntyped = { from: (table: string) => { update: (data: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<unknown> } } };

    const untypedClient = supabase as unknown as SupabaseClientUntyped;

    const updateMigration = async (id: string, data: Partial<SccmMigrationUpdate>) => {
      return untypedClient.from('sccm_migrations').update(data as Record<string, unknown>).eq('id', id);
    };

    const updateApp = async (id: string, data: Partial<SccmAppUpdate>) => {
      return untypedClient.from('sccm_apps').update(data as Record<string, unknown>).eq('id', id);
    };

    await updateMigration(body.migrationId, { status: 'migrating', updated_at: new Date().toISOString() });

    // Log migration started (fire-and-forget)
    logMigrationHistoryAsync(
      supabase,
      createSuccessEntry(
        body.migrationId,
        auth.userId,
        auth.tenantId,
        'migration_started',
        { totalApps: preparations.length, options }
      )
    );

    const { cartItems, successful, failed } = executeMigrationBatch(preparations);

    // Update app statuses
    for (const appId of successful) {
      await updateApp(appId, {
        migration_status: 'queued',
        updated_at: new Date().toISOString(),
      });
    }

    for (const { appId, error } of failed) {
      await updateApp(appId, {
        migration_status: 'failed',
        migration_error: error,
        updated_at: new Date().toISOString(),
      });
    }

    // Update migration status
    await updateMigration(body.migrationId, {
      status: 'ready',
      last_migration_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Log migration result (fire-and-forget)
    logMigrationHistoryAsync(
      supabase,
      {
        migration_id: body.migrationId,
        user_id: auth.userId,
        tenant_id: auth.tenantId,
        action: 'migration_completed',
        new_value: {
          successful: successful.length,
          failed: failed.length,
        },
        success: failed.length === 0,
        affected_count: successful.length,
      }
    );

    const response: SccmMigrationResult = {
      success: true,
      migrationId: body.migrationId,
      totalAttempted: preparations.length,
      successful: successful.length,
      failed: failed.length,
      skipped: preparations.length - successful.length - failed.length,
      results: [
        ...successful.map(appId => {
          const prep = preparations.find(p => p.appId === appId);
          return {
            appId,
            sccmName: prep?.sccmApp.displayName || '',
            success: true,
          };
        }),
        ...failed.map(f => {
          const prep = preparations.find(p => p.appId === f.appId);
          return {
            appId: f.appId,
            sccmName: prep?.sccmApp.displayName || '',
            success: false,
            error: f.error,
          };
        }),
      ],
    };

    // Return cart items to be added by the client
    return NextResponse.json({
      ...response,
      cartItems,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to process migration' },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update migration settings for an app
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json();

    if (!body.appId) {
      return NextResponse.json(
        { error: 'App ID is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Verify app ownership
    const { data: app, error: appError } = (await supabase
      .from('sccm_apps')
      .select('id, migration_id')
      .eq('id', body.appId)
      .eq('tenant_id', auth.tenantId)
      .single()) as { data: { id: string; migration_id: string } | null; error: Error | null };

    if (appError || !app) {
      return NextResponse.json(
        { error: 'App not found' },
        { status: 404 }
      );
    }

    // Build update object
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.preserveDetectionRules !== undefined) {
      updates.preserve_detection_rules = body.preserveDetectionRules;
    }
    if (body.preserveInstallCommands !== undefined) {
      updates.preserve_install_commands = body.preserveInstallCommands;
    }
    if (body.useWingetDefaults !== undefined) {
      updates.use_winget_defaults = body.useWingetDefaults;
    }
    if (body.customSettings !== undefined) {
      updates.custom_settings = body.customSettings;
    }
    if (body.migrationStatus !== undefined) {
      updates.migration_status = body.migrationStatus;
    }

    // Cast to untyped client for update operation on dynamically typed tables
    type SupabaseUpdateClient = {
      from: (table: string) => {
        update: (data: Record<string, unknown>) => {
          eq: (col: string, val: string) => {
            select: () => {
              single: () => Promise<{ data: SccmAppRow | null; error: Error | null }>;
            };
          };
        };
      };
    };
    const updateClient = supabase as unknown as SupabaseUpdateClient;

    const { data: updated, error: updateError } = await updateClient
      .from('sccm_apps')
      .update(updates as Record<string, unknown>)
      .eq('id', body.appId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update app settings' },
        { status: 500 }
      );
    }

    // Log settings update (fire-and-forget)
    logMigrationHistoryAsync(
      supabase,
      {
        migration_id: app.migration_id,
        user_id: auth.userId,
        tenant_id: auth.tenantId,
        action: 'settings_updated',
        app_id: body.appId,
        new_value: updates,
        success: true,
      }
    );

    return NextResponse.json({ app: updated });
  } catch {
    return NextResponse.json(
      { error: 'Failed to update migration settings' },
      { status: 500 }
    );
  }
}
