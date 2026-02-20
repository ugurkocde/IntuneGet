/**
 * SCCM Match API Route
 * Batch matching of SCCM applications to WinGet packages
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getAuthFromRequest } from '@/lib/auth/parse-token';
import { logMigrationHistoryAsync, createSuccessEntry, createAppEntry } from '@/lib/sccm/history-logger';
import { matchSccmApp, type SccmMatchResult } from '@/lib/matching/sccm-matcher';
import type {
  SccmApplication,
  SccmMatchRequest,
  SccmMatchProgress,
} from '@/types/sccm';

// Database row type
interface SccmAppRow {
  id: string;
  migration_id: string;
  sccm_ci_id: string;
  display_name: string;
  manufacturer: string | null;
  version: string | null;
  technology: string;
  is_deployed: boolean;
  deployment_count: number;
  sccm_app_data: SccmApplication;
  match_status: string;
}

/**
 * POST - Match SCCM apps to WinGet packages
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const body: SccmMatchRequest = await request.json();

    if (!body.migrationId) {
      return NextResponse.json(
        { error: 'Migration ID is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Verify migration ownership
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: migration, error: migrationError } = await (supabase as any)
      .from('sccm_migrations')
      .select('id, status')
      .eq('id', body.migrationId)
      .eq('tenant_id', auth.tenantId)
      .single() as { data: { id: string; status: string } | null; error: Error | null };

    if (migrationError || !migration) {
      return NextResponse.json(
        { error: 'Migration not found' },
        { status: 404 }
      );
    }

    // Update migration status to matching
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('sccm_migrations')
      .update({ status: 'matching', updated_at: new Date().toISOString() })
      .eq('id', body.migrationId);

    // Build query for apps to match
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('sccm_apps')
      .select('*')
      .eq('migration_id', body.migrationId);

    // Filter by specific app IDs if provided
    if (body.appIds && body.appIds.length > 0) {
      query = query.in('id', body.appIds);
    } else if (!body.forceRematch) {
      // Only match pending apps unless force rematch
      query = query.eq('match_status', 'pending');
    }

    const { data: apps, error: appsError } = await query as { data: SccmAppRow[] | null; error: Error | null };

    if (appsError) {
      console.error('Error fetching apps:', appsError);
      return NextResponse.json(
        { error: 'Failed to fetch apps for matching' },
        { status: 500 }
      );
    }

    if (!apps || apps.length === 0) {
      // Update migration status back to ready
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('sccm_migrations')
        .update({ status: 'ready', updated_at: new Date().toISOString() })
        .eq('id', body.migrationId);

      return NextResponse.json({
        progress: {
          migrationId: body.migrationId,
          total: 0,
          processed: 0,
          matched: 0,
          partial: 0,
          unmatched: 0,
          isComplete: true,
        } as SccmMatchProgress,
      });
    }

    // Log matching started (fire-and-forget)
    logMigrationHistoryAsync(
      supabase,
      createSuccessEntry(
        body.migrationId,
        auth.userId,
        auth.tenantId,
        'matching_started',
        { totalApps: apps.length, forceRematch: body.forceRematch }
      )
    );

    // Match apps in batches
    const results: {
      matched: number;
      partial: number;
      unmatched: number;
    } = { matched: 0, partial: 0, unmatched: 0 };

    const batchSize = 50;

    for (let i = 0; i < apps.length; i += batchSize) {
      const batch = apps.slice(i, i + batchSize);

      // Match each app
      const matchPromises = batch.map(async (app) => {
        const sccmApp = app.sccm_app_data;
        const matchResult = await matchSccmApp(sccmApp, auth.tenantId, supabase);
        return { app, matchResult };
      });

      const batchResults = await Promise.all(matchPromises);

      // Prepare updates
      const updates = batchResults.map(({ app, matchResult }) => ({
        id: app.id,
        match_status: matchResult.status,
        match_confidence: matchResult.confidence,
        matched_winget_id: matchResult.wingetId,
        matched_winget_name: matchResult.wingetName,
        partial_matches: matchResult.partialMatches,
        matched_at: new Date().toISOString(),
        matched_by: matchResult.matchedBy || 'auto',
        updated_at: new Date().toISOString(),
      }));

      // Update each app
      for (const update of updates) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from('sccm_apps')
          .update(update)
          .eq('id', update.id);

        // Count results
        if (update.match_status === 'matched') results.matched++;
        else if (update.match_status === 'partial') results.partial++;
        else results.unmatched++;
      }
    }

    // Log matching completed (fire-and-forget)
    logMigrationHistoryAsync(
      supabase,
      createSuccessEntry(
        body.migrationId,
        auth.userId,
        auth.tenantId,
        'matching_completed',
        results,
        apps.length
      )
    );

    // Update migration status
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('sccm_migrations')
      .update({
        status: 'ready',
        matched_apps: results.matched,
        partial_match_apps: results.partial,
        unmatched_apps: results.unmatched,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.migrationId);

    const progress: SccmMatchProgress = {
      migrationId: body.migrationId,
      total: apps.length,
      processed: apps.length,
      matched: results.matched,
      partial: results.partial,
      unmatched: results.unmatched,
      isComplete: true,
    };

    return NextResponse.json({ progress });
  } catch (error) {
    console.error('Match POST error:', error);
    return NextResponse.json(
      { error: 'Failed to match SCCM applications' },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update match for a single app (manual match)
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: app, error: appError } = await (supabase as any)
      .from('sccm_apps')
      .select('id, migration_id, display_name, match_status, matched_winget_id')
      .eq('id', body.appId)
      .eq('tenant_id', auth.tenantId)
      .single() as { data: { id: string; migration_id: string; display_name: string; match_status: string; matched_winget_id: string | null } | null; error: Error | null };

    if (appError || !app) {
      return NextResponse.json(
        { error: 'App not found' },
        { status: 404 }
      );
    }

    const previousValue = {
      matchStatus: app.match_status,
      matchedWingetId: app.matched_winget_id,
    };

    // Update match
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      matched_at: new Date().toISOString(),
      matched_by: 'manual',
    };

    if (body.wingetPackageId !== undefined) {
      updates.matched_winget_id = body.wingetPackageId;
      updates.matched_winget_name = body.wingetPackageName || body.wingetPackageId.split('.').pop();
      updates.match_status = body.wingetPackageId ? 'matched' : 'unmatched';
      updates.match_confidence = body.wingetPackageId ? 1.0 : 0;
      updates.partial_matches = [];
    }

    if (body.matchStatus === 'excluded') {
      updates.match_status = 'excluded';
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: updated, error: updateError } = await (supabase as any)
      .from('sccm_apps')
      .update(updates)
      .eq('id', body.appId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating app match:', updateError);
      return NextResponse.json(
        { error: 'Failed to update app match' },
        { status: 500 }
      );
    }

    // Log history (fire-and-forget)
    logMigrationHistoryAsync(
      supabase,
      createAppEntry(
        app.migration_id,
        auth.userId,
        auth.tenantId,
        body.matchStatus === 'excluded' ? 'app_excluded' : 'app_matched_manual',
        app.id,
        app.display_name,
        previousValue,
        {
          matchStatus: updates.match_status,
          matchedWingetId: updates.matched_winget_id,
        }
      )
    );

    return NextResponse.json({ app: updated });
  } catch (error) {
    console.error('Match PATCH error:', error);
    return NextResponse.json(
      { error: 'Failed to update app match' },
      { status: 500 }
    );
  }
}

/**
 * GET - Get apps for a migration with filtering
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthFromRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const migrationId = searchParams.get('migrationId');
    const matchStatus = searchParams.get('matchStatus');
    const migrationStatus = searchParams.get('migrationStatus');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    if (!migrationId) {
      return NextResponse.json(
        { error: 'Migration ID is required' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Build query
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('sccm_apps')
      .select('*', { count: 'exact' })
      .eq('migration_id', migrationId)
      .eq('tenant_id', auth.tenantId);

    if (matchStatus && matchStatus !== 'all') {
      query = query.eq('match_status', matchStatus);
    }

    if (migrationStatus && migrationStatus !== 'all') {
      query = query.eq('migration_status', migrationStatus);
    }

    if (search) {
      query = query.or(`display_name.ilike.%${search}%,manufacturer.ilike.%${search}%`);
    }

    query = query
      .order('deployment_count', { ascending: false })
      .order('display_name', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data: apps, count, error } = await query;

    if (error) {
      console.error('Error fetching apps:', error);
      return NextResponse.json(
        { error: 'Failed to fetch apps' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      apps: apps || [],
      total: count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('Match GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch apps' },
      { status: 500 }
    );
  }
}
