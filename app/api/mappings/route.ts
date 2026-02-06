/**
 * Manual App Mappings API Route
 * CRUD operations for user-created app-to-WinGet mappings
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import type { ManualAppMapping, CreateMappingRequest } from '@/types/unmanaged';
import type { Database } from '@/types/database';

// Database row types from the Database schema
type ManualMappingRow = Database['public']['Tables']['manual_app_mappings']['Row'];

/**
 * GET - List all manual mappings for the tenant
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const accessToken = authHeader.slice(7);
    let tenantId: string;

    try {
      const tokenPayload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      tenantId = tokenPayload.tid;

      if (!tenantId) {
        return NextResponse.json(
          { error: 'Invalid token: missing tenant identifier' },
          { status: 401 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid token format' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // Get mappings for this tenant and global mappings
    const { data: mappings, error } = await supabase
      .from('manual_app_mappings')
      .select('*')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch mappings' },
        { status: 500 }
      );
    }

    const formattedMappings: ManualAppMapping[] = (mappings || []).map(m => ({
      id: m.id,
      discoveredAppName: m.discovered_app_name,
      discoveredPublisher: m.discovered_publisher,
      wingetPackageId: m.winget_package_id,
      createdBy: m.created_by,
      tenantId: m.tenant_id,
      isVerified: m.is_verified,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
    }));

    return NextResponse.json({ mappings: formattedMappings });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch mappings' },
      { status: 500 }
    );
  }
}

/**
 * POST - Create a new manual mapping
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const accessToken = authHeader.slice(7);
    let userId: string;
    let tenantId: string;

    try {
      const tokenPayload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      userId = tokenPayload.oid || tokenPayload.sub;
      tenantId = tokenPayload.tid;

      if (!userId || !tenantId) {
        return NextResponse.json(
          { error: 'Invalid token: missing identifiers' },
          { status: 401 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid token format' },
        { status: 401 }
      );
    }

    const body: CreateMappingRequest = await request.json();

    if (!body.discoveredAppName || !body.wingetPackageId) {
      return NextResponse.json(
        { error: 'Missing required fields: discoveredAppName and wingetPackageId' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Check if mapping already exists
    const { data: existing } = await supabase
      .from('manual_app_mappings')
      .select('id')
      .eq('discovered_app_name', body.discoveredAppName.toLowerCase().trim())
      .eq('tenant_id', tenantId)
      .single();

    if (existing) {
      // Update existing mapping
      const { data: updated, error } = await supabase
        .from('manual_app_mappings')
        .update({
          winget_package_id: body.wingetPackageId,
          discovered_publisher: body.discoveredPublisher || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error || !updated) {
        return NextResponse.json(
          { error: 'Failed to update mapping' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        mapping: formatMapping(updated),
        updated: true,
      });
    }

    // Create new mapping
    const { data: created, error } = await supabase
      .from('manual_app_mappings')
      .insert({
        discovered_app_name: body.discoveredAppName.toLowerCase().trim(),
        discovered_publisher: body.discoveredPublisher || null,
        winget_package_id: body.wingetPackageId,
        created_by: userId,
        tenant_id: tenantId,
        is_verified: false,
      })
      .select()
      .single();

    if (error || !created) {
      return NextResponse.json(
        { error: 'Failed to create mapping' },
        { status: 500 }
      );
    }

    // Update the discovered apps cache to reflect the new mapping
    await supabase
      .from('discovered_apps_cache')
      .update({
        matched_package_id: body.wingetPackageId,
        match_status: 'matched',
        match_confidence: 1.0,
      })
      .eq('tenant_id', tenantId)
      .ilike('display_name', body.discoveredAppName);

    return NextResponse.json({
      mapping: formatMapping(created),
      updated: false,
    }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to create mapping' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - Remove a manual mapping
 */
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const accessToken = authHeader.slice(7);
    let tenantId: string;

    try {
      const tokenPayload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      tenantId = tokenPayload.tid;

      if (!tenantId) {
        return NextResponse.json(
          { error: 'Invalid token: missing tenant identifier' },
          { status: 401 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid token format' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const mappingId = searchParams.get('id');

    if (!mappingId) {
      return NextResponse.json(
        { error: 'Missing mapping ID' },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Get the mapping first to verify ownership
    const { data: mapping, error: fetchError } = await supabase
      .from('manual_app_mappings')
      .select('*')
      .eq('id', mappingId)
      .single();

    if (fetchError || !mapping) {
      return NextResponse.json(
        { error: 'Mapping not found' },
        { status: 404 }
      );
    }

    // Only allow deletion by creator or tenant members
    if (mapping.tenant_id !== tenantId) {
      return NextResponse.json(
        { error: 'Unauthorized to delete this mapping' },
        { status: 403 }
      );
    }

    // Delete the mapping
    const { error: deleteError } = await supabase
      .from('manual_app_mappings')
      .delete()
      .eq('id', mappingId);

    if (deleteError) {
      return NextResponse.json(
        { error: 'Failed to delete mapping' },
        { status: 500 }
      );
    }

    // Update the discovered apps cache to remove the mapping
    await supabase
      .from('discovered_apps_cache')
      .update({
        matched_package_id: null,
        match_status: 'unmatched',
        match_confidence: 0,
      })
      .eq('tenant_id', tenantId)
      .ilike('display_name', mapping.discovered_app_name);

    return NextResponse.json({
      success: true,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to delete mapping' },
      { status: 500 }
    );
  }
}

function formatMapping(m: ManualMappingRow): ManualAppMapping {
  return {
    id: m.id,
    discoveredAppName: m.discovered_app_name,
    discoveredPublisher: m.discovered_publisher,
    wingetPackageId: m.winget_package_id,
    createdBy: m.created_by,
    tenantId: m.tenant_id,
    isVerified: m.is_verified,
    createdAt: m.created_at,
    updatedAt: m.updated_at,
  };
}
