/**
 * SCCM Import API Route
 * Handles CSV/JSON file upload and parsing of SCCM application exports
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getAuthFromRequest } from '@/lib/auth/parse-token';
import { logMigrationHistoryAsync, createSuccessEntry } from '@/lib/sccm/history-logger';
import type {
  SccmApplication,
  SccmCsvRow,
  SccmImportFormat,
  SccmImportRequest,
  SccmImportResponse,
  SccmDeploymentTechnology,
} from '@/types/sccm';
import type { Json } from '@/types/database';

/**
 * Parse CSV content to array of rows
 */
function parseCsv(content: string): SccmCsvRow[] {
  const lines = content.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) {
    return [];
  }

  // Parse header row
  const headers = parseCSVLine(lines[0]);
  const rows: SccmCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) {
      continue; // Skip malformed rows
    }

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j];
    }
    rows.push(row as unknown as SccmCsvRow);
  }

  return rows;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Convert CSV row to SCCM application
 */
function csvRowToApp(row: SccmCsvRow): SccmApplication {
  // Determine technology from Technology field or infer from install command
  let technology: SccmDeploymentTechnology = 'Unknown';
  if (row.Technology) {
    const tech = row.Technology.toLowerCase();
    if (tech.includes('msi')) technology = 'MSI';
    else if (tech.includes('script')) technology = 'Script';
    else if (tech.includes('msix') || tech.includes('appx')) technology = 'MSIX';
    else if (tech.includes('appv') || tech.includes('app-v')) technology = 'AppV';
  } else if (row.InstallCommand) {
    const cmd = row.InstallCommand.toLowerCase();
    if (cmd.includes('msiexec')) technology = 'MSI';
    else if (cmd.includes('.ps1') || cmd.includes('powershell')) technology = 'Script';
  }

  return {
    ci_id: row.CI_ID,
    localizedDisplayName: row.LocalizedDisplayName,
    manufacturer: row.Manufacturer || null,
    softwareVersion: row.SoftwareVersion || null,
    deploymentTypes: [{
      name: 'Default',
      technology,
      installCommand: row.InstallCommand || null,
      uninstallCommand: row.UninstallCommand || null,
      installBehavior: (row.InstallBehavior as 'InstallForUser' | 'InstallForSystem') || 'InstallForSystem',
      rebootBehavior: 'BasedOnExitCode',
      detectionClauses: parseDetectionClause(row),
    }],
    adminCategories: row.AdminCategories ? row.AdminCategories.split(',').map(c => c.trim()) : [],
    isDeployed: row.IsDeployed?.toLowerCase() === 'true',
    deploymentCount: parseInt(row.DeploymentCount || '0', 10) || 0,
    contentSize: row.ContentSize ? parseInt(row.ContentSize, 10) : undefined,
    dateCreated: row.DateCreated,
    dateLastModified: row.DateLastModified,
    createdBy: row.CreatedBy,
    isSuperseded: row.IsSuperseded?.toLowerCase() === 'true',
    isExpired: row.IsExpired?.toLowerCase() === 'true',
    packageId: row.PackageID,
  };
}

/**
 * Parse detection clause from CSV row
 */
function parseDetectionClause(row: SccmCsvRow): SccmApplication['deploymentTypes'][0]['detectionClauses'] {
  if (!row.DetectionType || !row.DetectionValue) {
    return [];
  }

  const detectionType = row.DetectionType.toLowerCase();

  if (detectionType.includes('msi') || detectionType.includes('productcode')) {
    return [{
      type: 'MSI',
      productCode: row.DetectionValue,
      propertyType: 'Exists',
    }];
  }

  if (detectionType.includes('file')) {
    // Try to parse file path
    const lastSlash = row.DetectionValue.lastIndexOf('\\');
    if (lastSlash > 0) {
      return [{
        type: 'File',
        path: row.DetectionValue.substring(0, lastSlash),
        fileName: row.DetectionValue.substring(lastSlash + 1),
        expressionOperator: 'Exists',
      }];
    }
  }

  if (detectionType.includes('registry')) {
    return [{
      type: 'Registry',
      hive: 'LocalMachine',
      keyPath: row.DetectionValue,
      propertyType: 'Exists',
    }];
  }

  return [];
}

/**
 * Parse JSON import format
 */
function parseJsonImport(content: string): SccmImportFormat | null {
  try {
    const parsed = JSON.parse(content);

    // Check if it's our expected format
    if (parsed.version && parsed.applications && Array.isArray(parsed.applications)) {
      return parsed as SccmImportFormat;
    }

    // Check if it's a raw array of applications
    if (Array.isArray(parsed)) {
      return {
        version: '1.0',
        exportDate: new Date().toISOString(),
        source: 'json',
        applications: parsed,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * POST - Import SCCM applications from CSV or JSON
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

    const body: SccmImportRequest = await request.json();

    if (!body.migrationName || !body.fileContent || !body.fileType) {
      return NextResponse.json(
        { error: 'Missing required fields: migrationName, fileContent, fileType' },
        { status: 400 }
      );
    }

    // Decode file content if base64
    let content = body.fileContent;
    if (body.fileContent.includes('base64,')) {
      content = Buffer.from(body.fileContent.split('base64,')[1], 'base64').toString('utf-8');
    } else {
      try {
        // Try base64 decode
        const decoded = Buffer.from(body.fileContent, 'base64').toString('utf-8');
        if (decoded.includes('CI_ID') || decoded.includes('{')) {
          content = decoded;
        }
      } catch {
        // Use as-is if not base64
      }
    }

    // Parse content based on file type
    let applications: SccmApplication[] = [];
    const errors: SccmImportResponse['errors'] = [];

    if (body.fileType === 'csv') {
      const rows = parseCsv(content);
      if (rows.length === 0) {
        return NextResponse.json(
          { error: 'No valid data found in CSV file' },
          { status: 400 }
        );
      }

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.CI_ID || !row.LocalizedDisplayName) {
          errors.push({
            row: i + 2, // 1-indexed, plus header
            message: 'Missing required fields: CI_ID or LocalizedDisplayName',
          });
          continue;
        }
        applications.push(csvRowToApp(row));
      }
    } else if (body.fileType === 'json') {
      const parsed = parseJsonImport(content);
      if (!parsed) {
        return NextResponse.json(
          { error: 'Invalid JSON format' },
          { status: 400 }
        );
      }
      applications = parsed.applications;

      // Validate required fields
      applications = applications.filter((app, i) => {
        if (!app.ci_id || !app.localizedDisplayName) {
          errors.push({
            row: i + 1,
            ciId: app.ci_id,
            message: 'Missing required fields: ci_id or localizedDisplayName',
          });
          return false;
        }
        return true;
      });
    } else {
      return NextResponse.json(
        { error: 'Unsupported file type. Use csv or json.' },
        { status: 400 }
      );
    }

    if (applications.length === 0) {
      return NextResponse.json(
        {
          error: 'No valid applications found in file',
          errors,
        },
        { status: 400 }
      );
    }

    const supabase = createServerClient();

    // Ensure user profile exists
    await supabase
      .from('user_profiles')
      .upsert({
        id: auth.userId,
        email: 'import@intuneget.com',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    // Create migration
    const { data: migration, error: migrationError } = await supabase
      .from('sccm_migrations')
      .insert({
        user_id: auth.userId,
        tenant_id: auth.tenantId,
        name: body.migrationName,
        description: body.migrationDescription,
        source_type: body.fileType,
        imported_file_name: body.fileName,
        status: 'importing',
        total_apps: applications.length,
      })
      .select()
      .single();

    if (migrationError || !migration) {
      return NextResponse.json(
        { error: 'Failed to create migration' },
        { status: 500 }
      );
    }

    // Insert applications in batches
    const batchSize = 100;
    let insertedCount = 0;

    for (let i = 0; i < applications.length; i += batchSize) {
      const batch = applications.slice(i, i + batchSize);

      const appRecords = batch.map(app => {
        const primaryDT = app.deploymentTypes[0];
        return {
          migration_id: migration.id,
          user_id: auth.userId,
          tenant_id: auth.tenantId,
          sccm_ci_id: app.ci_id,
          display_name: app.localizedDisplayName,
          manufacturer: app.manufacturer,
          version: app.softwareVersion,
          technology: primaryDT?.technology || 'Unknown',
          is_deployed: app.isDeployed,
          deployment_count: app.deploymentCount || 0,
          sccm_app_data: app as unknown as Json,
          sccm_detection_rules: (primaryDT?.detectionClauses || []) as unknown as Json,
          sccm_install_command: primaryDT?.installCommand,
          sccm_uninstall_command: primaryDT?.uninstallCommand,
          sccm_install_behavior: primaryDT?.installBehavior,
          sccm_admin_categories: app.adminCategories || [],
          match_status: 'pending',
          migration_status: 'pending',
        };
      });

      const { error: insertError, data: inserted } = await supabase
        .from('sccm_apps')
        .insert(appRecords)
        .select('id');

      if (insertError) {
        errors.push({
          row: i,
          message: `Failed to insert batch starting at row ${i + 1}: ${insertError.message}`,
        });
      } else {
        insertedCount += inserted?.length || batch.length;
      }
    }

    // Update migration status
    await supabase
      .from('sccm_migrations')
      .update({
        status: 'ready',
        total_apps: insertedCount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', migration.id);

    // Log history (fire-and-forget, don't block the response)
    logMigrationHistoryAsync(
      supabase,
      createSuccessEntry(
        migration.id,
        auth.userId,
        auth.tenantId,
        'apps_imported',
        {
          totalApps: applications.length,
          validApps: insertedCount,
          skippedApps: errors.length,
          fileName: body.fileName,
        },
        insertedCount
      )
    );

    const response: SccmImportResponse = {
      success: true,
      migrationId: migration.id,
      totalApps: applications.length,
      validApps: insertedCount,
      skippedApps: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    };

    return NextResponse.json(response, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: 'Failed to import SCCM applications' },
      { status: 500 }
    );
  }
}
