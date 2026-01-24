/**
 * Package API Route
 * Queues packaging jobs by triggering GitHub Actions workflows
 * or leaving them in queued state for local packager pickup
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getDatabase, isSqliteMode } from '@/lib/db';
import {
  isGitHubActionsConfigured,
  triggerPackagingWorkflow,
  type WorkflowInputs,
} from '@/lib/github-actions';
import { getAppConfig } from '@/lib/config';
import { getFeatureFlags } from '@/lib/features';
import type { CartItem } from '@/types/upload';

interface PackageRequestBody {
  items: CartItem[];
}

interface PackagingJobRecord {
  id: string;
  user_id: string;
  tenant_id: string;
  winget_id: string;
  version: string;
  display_name: string;
  publisher: string;
  status: string;
  package_config: CartItem;
  github_run_id?: string;
  github_run_url?: string;
  created_at: string;
}

/**
 * Verify that admin consent has been granted for the tenant
 * Uses client credentials grant to test if the service principal exists
 */
async function verifyTenantConsent(tenantId: string): Promise<boolean> {
  const clientId = process.env.AZURE_AD_CLIENT_ID || process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  // If credentials not configured, skip check (allows local/dev mode)
  if (!clientId || !clientSecret) {
    console.warn('Consent verification skipped: credentials not configured');
    return true;
  }

  try {
    const response = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }).toString(),
      }
    );
    return response.ok;
  } catch (error) {
    console.error('Error verifying tenant consent:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get the authorization header (Microsoft access token from MSAL)
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Authentication required. Please sign in with Microsoft.' },
        { status: 401 }
      );
    }

    // Decode the token to get user info
    const accessToken = authHeader.slice(7);
    let userId: string;
    let userEmail: string;
    let tokenTenantId: string;

    try {
      const tokenPayload = JSON.parse(
        Buffer.from(accessToken.split('.')[1], 'base64').toString()
      );
      userId = tokenPayload.oid || tokenPayload.sub;
      userEmail = tokenPayload.preferred_username || tokenPayload.email || 'unknown';
      tokenTenantId = tokenPayload.tid;

      if (!userId) {
        return NextResponse.json(
          { error: 'Invalid token: missing user identifier' },
          { status: 401 }
        );
      }

      if (!tokenTenantId) {
        return NextResponse.json(
          { error: 'Invalid token: missing tenant identifier. Please sign in with a Microsoft work account.' },
          { status: 401 }
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid token format' },
        { status: 401 }
      );
    }

    // Check for MSP tenant override header
    const mspTenantId = request.headers.get('X-MSP-Tenant-Id');
    let tenantId = tokenTenantId;

    // If MSP tenant ID is provided, validate that user has access to it
    if (mspTenantId && mspTenantId !== tokenTenantId) {
      const supabaseValidation = createServerClient();

      // Check if user is a member of an MSP organization
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: membership } = await (supabaseValidation as any)
        .from('msp_user_memberships')
        .select('msp_organization_id')
        .eq('user_id', userId)
        .single();

      if (!membership) {
        return NextResponse.json(
          { error: 'Not authorized to deploy to other tenants' },
          { status: 403 }
        );
      }

      // Check if the target tenant is managed by this MSP organization
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: managedTenant } = await (supabaseValidation as any)
        .from('msp_managed_tenants')
        .select('id')
        .eq('msp_organization_id', membership.msp_organization_id)
        .eq('tenant_id', mspTenantId)
        .eq('consent_status', 'granted')
        .eq('is_active', true)
        .single();

      if (!managedTenant) {
        return NextResponse.json(
          { error: 'Target tenant is not managed by your MSP organization or has not granted consent' },
          { status: 403 }
        );
      }

      // Use the MSP-specified tenant
      tenantId = mspTenantId;
    }

    // Verify admin consent for the target tenant before accepting jobs
    // This prevents jobs from being queued when uploads will ultimately fail
    const consentVerified = await verifyTenantConsent(tenantId);
    if (!consentVerified) {
      return NextResponse.json(
        {
          error: 'Admin consent required',
          message: 'Admin consent has not been granted for your organization. Please complete the onboarding process.',
          consentRequired: true,
        },
        { status: 403 }
      );
    }

    // Parse request body
    const body: PackageRequestBody = await request.json();
    const { items } = body;

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'No items provided for packaging' },
        { status: 400 }
      );
    }

    // Limit batch size
    if (items.length > 10) {
      return NextResponse.json(
        { error: 'Maximum 10 items per batch' },
        { status: 400 }
      );
    }

    // Check if packaging pipeline is configured
    const config = getAppConfig();
    const features = getFeatureFlags();
    const isLocalPackagerMode = features.localPackager;

    if (!features.pipeline) {
      return NextResponse.json(
        { error: 'Packaging pipeline not configured. Set PACKAGER_MODE=local or configure GitHub Actions.' },
        { status: 503 }
      );
    }

    // For GitHub mode, verify GitHub Actions is configured
    if (!isLocalPackagerMode && !isGitHubActionsConfigured()) {
      return NextResponse.json(
        { error: 'GitHub Actions packaging service not configured' },
        { status: 503 }
      );
    }

    // Get callback URL from environment (only used in GitHub mode)
    const baseUrl = config.app.url || (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000');
    const callbackUrl = `${baseUrl}/api/package/callback`;

    // Get database adapter (SQLite or Supabase)
    const db = getDatabase();

    // Process each item
    const jobs: PackagingJobRecord[] = [];
    const errors: { wingetId: string; error: string }[] = [];

    for (const item of items) {
      try {
        // Generate a unique job ID
        const jobId = crypto.randomUUID();

        // Create job record in database
        const jobRecord = await db.jobs.create({
          id: jobId,
          user_id: userId,
          user_email: userEmail,
          tenant_id: tenantId,
          winget_id: item.wingetId,
          version: item.version,
          display_name: item.displayName,
          publisher: item.publisher,
          architecture: item.architecture,
          installer_type: item.installerType,
          installer_url: item.installerUrl,
          installer_sha256: item.installerSha256,
          install_command: item.installCommand,
          uninstall_command: item.uninstallCommand,
          install_scope: item.installScope,
          detection_rules: item.detectionRules as unknown as import('@/types/database').Json,
          package_config: item as unknown as import('@/types/database').Json,
          status: 'queued',
          progress_percent: 0,
        });

        if (!jobRecord) {
          console.error('Failed to create job record');
          errors.push({ wingetId: item.wingetId, error: 'Failed to create job record' });
          continue;
        }

        // Local packager mode: leave job in queued state for pickup
        if (isLocalPackagerMode) {
          jobs.push({
            id: jobId,
            user_id: userId,
            tenant_id: tenantId,
            winget_id: item.wingetId,
            version: item.version,
            display_name: item.displayName,
            publisher: item.publisher,
            status: 'queued',
            package_config: item,
            created_at: jobRecord?.created_at || new Date().toISOString(),
          });

          console.log(`Job queued for local packager: ${item.wingetId}`);
          continue;
        }

        // GitHub Actions mode: trigger workflow
        // Prepare workflow inputs
        const workflowInputs: WorkflowInputs = {
          jobId,
          tenantId,
          wingetId: item.wingetId,
          displayName: item.displayName,
          publisher: item.publisher,
          version: item.version,
          installerUrl: item.installerUrl,
          installerSha256: item.installerSha256 || '',
          installerType: item.installerType,
          silentSwitches: extractSilentSwitches(item.installCommand, item.installerType),
          uninstallCommand: item.uninstallCommand,
          callbackUrl,
          psadtConfig: item.psadtConfig ? JSON.stringify(item.psadtConfig) : undefined,
          detectionRules: item.detectionRules ? JSON.stringify(item.detectionRules) : undefined,
          assignments: item.assignments ? JSON.stringify(item.assignments) : undefined,
          installScope: item.installScope,
        };

        // Trigger the GitHub Actions workflow and capture run ID
        const triggerResult = await triggerPackagingWorkflow(workflowInputs);

        // Update job status to packaging with run info if available
        const updateData: Record<string, unknown> = {
          status: 'packaging',
          packaging_started_at: new Date().toISOString(),
        };

        if (triggerResult.runId) {
          updateData.github_run_id = triggerResult.runId.toString();
          updateData.github_run_url = triggerResult.runUrl;
        }

        await db.jobs.update(jobId, updateData);

        jobs.push({
          id: jobId,
          user_id: userId,
          tenant_id: tenantId,
          winget_id: item.wingetId,
          version: item.version,
          display_name: item.displayName,
          publisher: item.publisher,
          status: 'packaging',
          package_config: item,
          created_at: jobRecord?.created_at || new Date().toISOString(),
        });

        console.log(`GitHub Actions workflow triggered for ${item.wingetId}`);
      } catch (error) {
        console.error(`Failed to process ${item.wingetId}:`, error);
        errors.push({
          wingetId: item.wingetId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Return results
    return NextResponse.json({
      success: jobs.length > 0,
      jobs,
      errors: errors.length > 0 ? errors : undefined,
      message: errors.length > 0
        ? `${jobs.length} job(s) queued, ${errors.length} failed`
        : `${jobs.length} job(s) queued successfully`,
    });
  } catch (error) {
    console.error('Package API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Extract silent switches from the install command
 */
function extractSilentSwitches(installCommand: string, installerType: string): string {
  // Common silent switches by installer type
  const defaultSwitches: Record<string, string> = {
    msi: '/qn /norestart',
    exe: '/S',
    inno: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
    nullsoft: '/S',
    wix: '/qn /norestart',
    burn: '/q /norestart',
    msix: '', // MSIX doesn't need switches
  };

  // Strip executable path first (handles paths with hyphens like "7z2501-x64.exe")
  // This removes everything up to and including common installer extensions
  let cleaned = installCommand
    .replace(/^"[^"]+"\s*/, '') // Remove quoted paths like "C:\path\installer.exe"
    .replace(/^\S+\.(exe|msi|msix|appx)\s*/i, ''); // Remove unquoted paths ending in installer extensions

  // Strip msiexec action switches and their targets:
  // /i filename.msi, /x {GUID}, /p patch.msp, etc.
  cleaned = cleaned
    .replace(/\/[ixp]\s+"[^"]+"\s*/gi, '') // /i "quoted path.msi"
    .replace(/\/[ixp]\s+\{[^}]+\}\s*/gi, '') // /x {GUID}
    .replace(/\/[ixp]\s+\S+\.(msi|msp)\s*/gi, '') // /i filename.msi
    .replace(/\/[ixp]\s+/gi, ''); // /i alone (leftover)

  // Extract switches from remaining string (starts with / or -)
  const switchMatch = cleaned.match(/(?:\/\S+|-{1,2}\S+)(?:\s+(?:\/\S+|-{1,2}\S+))*/);
  if (switchMatch && switchMatch[0] !== '-DeploymentType') {
    return switchMatch[0];
  }

  return defaultSwitches[installerType] || '/S';
}

/**
 * GET handler for checking job status
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');
  const userId = searchParams.get('userId');

  if (!jobId && !userId) {
    return NextResponse.json(
      { error: 'jobId or userId parameter required' },
      { status: 400 }
    );
  }

  const db = getDatabase();

  try {
    if (jobId) {
      const job = await db.jobs.getById(jobId);

      if (!job) {
        return NextResponse.json(
          { error: 'Job not found' },
          { status: 404 }
        );
      }

      return NextResponse.json({ job });
    }

    // Get all jobs for a user
    const jobs = await db.jobs.getByUserId(userId!, 50);

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}
