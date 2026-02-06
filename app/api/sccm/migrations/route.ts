/**
 * SCCM Migrations API Route
 * CRUD operations for SCCM migrations
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getAuthFromRequest } from '@/lib/auth/parse-token';
import { logMigrationHistoryAsync, createSuccessEntry } from '@/lib/sccm/history-logger';
import type {
  SccmMigration,
  SccmMigrationStats,
  SccmDashboardStats,
} from '@/types/sccm';

import type { Database } from '@/types/database';

// Database row type - use the type from the Database schema
type MigrationRow = Database['public']['Tables']['sccm_migrations']['Row'];

/**
 * Format migration row to API response format
 */
function formatMigration(row: MigrationRow): SccmMigration {
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description || undefined,
    sourceType: row.source_type as 'csv' | 'powershell' | 'json',
    sourceSiteCode: row.source_site_code || undefined,
    sourceSiteName: row.source_site_name || undefined,
    importedFileName: row.imported_file_name || undefined,
    totalApps: row.total_apps,
    matchedApps: row.matched_apps,
    partialMatchApps: row.partial_match_apps,
    unmatchedApps: row.unmatched_apps,
    excludedApps: row.excluded_apps,
    migratedApps: row.migrated_apps,
    failedApps: row.failed_apps,
    status: row.status as SccmMigration['status'],
    errorMessage: row.error_message || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMigrationAt: row.last_migration_at || undefined,
  };
}

/**
 * GET - List all migrations or get dashboard stats
 */
export async function GET(request: NextRequest) {
  try {
    const auth = getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const migrationId = searchParams.get('id');
    const statsOnly = searchParams.get('stats') === 'true';

    const supabase = createServerClient();

    // Get single migration by ID
    if (migrationId) {
      const { data: migration, error } = await supabase
        .from('sccm_migrations')
        .select('*')
        .eq('id', migrationId)
        .eq('tenant_id', auth.tenantId)
        .single();

      if (error || !migration) {
        return NextResponse.json(
          { error: 'Migration not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({ migration: formatMigration(migration) });
    }

    // Get dashboard stats
    if (statsOnly) {
      const { data: migrations, error } = await supabase
        .from('sccm_migrations')
        .select('*')
        .eq('tenant_id', auth.tenantId)
        .order('created_at', { ascending: false });

      if (error) {
        return NextResponse.json(
          { error: 'Failed to fetch migrations' },
          { status: 500 }
        );
      }

      const migrationList = migrations || [];

      // Calculate aggregated stats
      const stats: SccmDashboardStats = {
        totalMigrations: migrationList.length,
        totalApps: migrationList.reduce((sum, m) => sum + m.total_apps, 0),
        matchedApps: migrationList.reduce((sum, m) => sum + m.matched_apps, 0),
        migratedApps: migrationList.reduce((sum, m) => sum + m.migrated_apps, 0),
        pendingMigration: migrationList.reduce(
          (sum, m) => sum + (m.total_apps - m.migrated_apps - m.failed_apps - m.excluded_apps),
          0
        ),
        failedMigration: migrationList.reduce((sum, m) => sum + m.failed_apps, 0),
        recentMigrations: migrationList.slice(0, 5).map((m): SccmMigrationStats => ({
          id: m.id,
          name: m.name,
          status: m.status as SccmMigration['status'],
          totalApps: m.total_apps,
          matchedApps: m.matched_apps,
          partialMatchApps: m.partial_match_apps,
          unmatchedApps: m.unmatched_apps,
          migratedApps: m.migrated_apps,
          failedApps: m.failed_apps,
          createdAt: m.created_at,
          updatedAt: m.updated_at,
        })),
      };

      return NextResponse.json({ stats });
    }

    // List all migrations
    const { data: migrations, error } = await supabase
      .from('sccm_migrations')
      .select('*')
      .eq('tenant_id', auth.tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch migrations' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      migrations: (migrations || []).map(formatMigration),
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch migrations' },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a new migration
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

    if (!body.name) {
      return NextResponse.json(
        { error: 'Migration name is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Ensure user profile exists
    await supabase
      .from('user_profiles')
      .upsert({
        id: auth.userId,
        email: body.email || 'unknown@unknown.com',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    // Create migration
    const { data: migration, error } = await supabase
      .from('sccm_migrations')
      .insert({
        user_id: auth.userId,
        tenant_id: auth.tenantId,
        name: body.name,
        description: body.description || null,
        source_type: body.sourceType || 'csv',
        source_site_code: body.sourceSiteCode || null,
        source_site_name: body.sourceSiteName || null,
        imported_file_name: body.importedFileName || null,
        status: 'importing',
      })
      .select()
      .single();

    if (error || !migration) {
      return NextResponse.json(
        { error: 'Failed to create migration' },
        { status: 500 }
      );
    }

    // Log history (fire-and-forget, don't block the response)
    logMigrationHistoryAsync(
      supabase,
      createSuccessEntry(
        migration.id,
        auth.userId,
        auth.tenantId,
        'migration_created',
        { name: body.name, sourceType: body.sourceType }
      )
    );

    return NextResponse.json(
      { migration: formatMigration(migration) },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: 'Failed to create migration' },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update migration details
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

    if (!body.id) {
      return NextResponse.json(
        { error: 'Migration ID is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('sccm_migrations')
      .select('*')
      .eq('id', body.id)
      .eq('tenant_id', auth.tenantId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Migration not found' },
        { status: 404 }
      );
    }

    // Build update object
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status !== undefined) updates.status = body.status;
    if (body.errorMessage !== undefined) updates.error_message = body.errorMessage;

    const { data: updated, error } = await supabase
      .from('sccm_migrations')
      .update(updates)
      .eq('id', body.id)
      .select()
      .single();

    if (error || !updated) {
      return NextResponse.json(
        { error: 'Failed to update migration' },
        { status: 500 }
      );
    }

    return NextResponse.json({ migration: formatMigration(updated) });
  } catch {
    return NextResponse.json(
      { error: 'Failed to update migration' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Delete a migration and all its apps
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const migrationId = searchParams.get('id');

    if (!migrationId) {
      return NextResponse.json(
        { error: 'Migration ID is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('sccm_migrations')
      .select('id, name')
      .eq('id', migrationId)
      .eq('tenant_id', auth.tenantId)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: 'Migration not found' },
        { status: 404 }
      );
    }

    // Log deletion before deleting (cascade will delete apps and history)
    // Note: This is logged synchronously because cascade delete will remove history
    logMigrationHistoryAsync(
      supabase,
      {
        migration_id: migrationId,
        user_id: auth.userId,
        tenant_id: auth.tenantId,
        action: 'migration_deleted',
        previous_value: { name: existing.name },
        success: true,
      }
    );

    // Delete migration (cascade deletes apps and history)
    const { error } = await supabase
      .from('sccm_migrations')
      .delete()
      .eq('id', migrationId);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to delete migration' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Failed to delete migration' },
      { status: 500 }
    );
  }
}
