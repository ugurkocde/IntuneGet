/**
 * Detected App Devices API Route
 *
 * Drill-down for the discovered/unmanaged apps device count: lists the devices
 * a detected app is installed on. The displayed device count is summed across
 * all detected versions of an app, but the consolidated app only keeps the
 * newest version's id. So we read every merged version id from the cache and
 * fan out `detectedApps/{id}/managedDevices`, deduplicating by device id, to
 * return the complete distinct-device list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { resolveTargetTenantId } from '@/lib/msp/tenant-resolution';
import { parseAccessToken } from '@/lib/auth-utils';
import {
  GRAPH_API_BASE,
  fetchWithRetry,
  getServicePrincipalToken,
  invalidateServicePrincipalToken,
} from '@/lib/intune/graph-client';
import type { DeviceListItem, DetectedAppDevicesResponse } from '@/types/unmanaged';

export const maxDuration = 60;

// Cap the per-version fan-out for pathological churn (e.g. browsers with dozens
// of detected versions). Realistically never hit; guards latency/throttling.
const MAX_VERSIONS = 25;
// Concurrent managedDevices fetches across version ids (avoids tripping 429).
const CONCURRENCY = 4;
// Overall budget for the Graph fan-out. Must leave headroom under maxDuration
// so a throttled tenant gets a partial device list instead of a hung request.
const SCAN_BUDGET_MS = 40_000;

/** Thrown when the fan-out runs out of scan budget mid-flight. */
class ScanBudgetExceededError extends Error {
  constructor() {
    super('Device scan budget exhausted');
    this.name = 'ScanBudgetExceededError';
  }
}

interface GraphManagedDevice {
  id: string;
  deviceName?: string | null;
  operatingSystem?: string | null;
}

interface GraphFetchError extends Error {
  status: number;
  bodyText: string;
}

/**
 * Fetch all managed devices for a single detected-app id, following pagination.
 * A 404 (stale/removed version id) yields an empty list rather than failing the
 * whole request. Other non-OK responses throw a GraphFetchError.
 */
async function fetchDevicesForDetectedApp(
  detectedAppId: string,
  token: string,
  tenantId: string,
  deadlineAt: number
): Promise<GraphManagedDevice[]> {
  const devices: GraphManagedDevice[] = [];
  let nextUrl: string | null =
    `${GRAPH_API_BASE}/deviceManagement/detectedApps/${encodeURIComponent(detectedAppId)}/managedDevices` +
    `?$select=id,deviceName,operatingSystem`;

  while (nextUrl) {
    if (Date.now() >= deadlineAt) {
      throw new ScanBudgetExceededError();
    }

    const response: Response = await fetchWithRetry(
      nextUrl,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      },
      3,
      deadlineAt
    );

    if (!response.ok) {
      if (response.status === 401) {
        invalidateServicePrincipalToken(tenantId);
      }
      // Stale version id no longer present — treat as no devices.
      if (response.status === 404) {
        await response.text().catch(() => {});
        return devices;
      }
      const bodyText = await response.text().catch(() => '');
      const error = new Error(
        `Graph managedDevices ${response.status} for detectedApp ${detectedAppId}`
      ) as GraphFetchError;
      error.status = response.status;
      error.bodyText = bodyText;
      throw error;
    }

    const data: { value?: GraphManagedDevice[]; '@odata.nextLink'?: string } =
      await response.json();
    if (Array.isArray(data.value)) {
      devices.push(...data.value);
    }
    nextUrl = data['@odata.nextLink'] || null;
  }

  return devices;
}

export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const appId = searchParams.get('appId');
    if (!appId) {
      return NextResponse.json({ error: 'Missing appId parameter' }, { status: 400 });
    }

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

    // Verify admin consent (mirrors the unmanaged-apps route)
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

    // Resolve the full set of detected-app (version) ids for this app from the
    // sync cache; fall back to the single id for rows written before this field
    // existed or evicted rows.
    const { data: cacheRow } = await supabase
      .from('discovered_apps_cache')
      .select('app_data, device_count')
      .eq('tenant_id', tenantId)
      .eq('discovered_app_id', appId)
      .maybeSingle();

    const appData = (cacheRow?.app_data ?? null) as unknown as { mergedAppIds?: string[] } | null;
    const allVersionIds =
      appData?.mergedAppIds && appData.mergedAppIds.length > 0
        ? appData.mergedAppIds
        : [appId];
    const truncated = allVersionIds.length > MAX_VERSIONS;
    const versionIds = truncated ? allVersionIds.slice(0, MAX_VERSIONS) : allVersionIds;
    const summedDeviceCount = cacheRow?.device_count ?? undefined;

    const token = await getServicePrincipalToken(tenantId);
    if (!token) {
      return NextResponse.json({ error: 'Failed to get Graph API token' }, { status: 500 });
    }

    // Fan out across version ids with a small concurrency cap, deduplicating
    // devices by id (a device may run more than one version of the app). The
    // whole fan-out is bounded by SCAN_BUDGET_MS; running out of budget on a
    // throttled tenant degrades to a partial device list instead of a hang.
    const scanDeadline = Date.now() + SCAN_BUDGET_MS;
    const deviceMap = new Map<string, DeviceListItem>();
    let partial = false;
    try {
      for (let i = 0; i < versionIds.length; i += CONCURRENCY) {
        if (Date.now() >= scanDeadline) {
          partial = true;
          break;
        }
        const chunk = versionIds.slice(i, i + CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map((id) => fetchDevicesForDetectedApp(id, token, tenantId, scanDeadline))
        );
        for (const deviceList of chunkResults) {
          for (const device of deviceList) {
            if (!device.id || deviceMap.has(device.id)) continue;
            deviceMap.set(device.id, {
              id: device.id,
              deviceName: device.deviceName || 'Unknown device',
              operatingSystem: device.operatingSystem ?? null,
            });
          }
        }
      }
    } catch (err) {
      const graphError = err as GraphFetchError;
      const budgetExhausted =
        err instanceof ScanBudgetExceededError ||
        (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) ||
        Date.now() >= scanDeadline;
      if (budgetExhausted) {
        // Return whatever was collected before the budget ran out.
        partial = true;
      } else {
        if (
          graphError.status === 403 &&
          graphError.bodyText?.includes('DeviceManagementManagedDevices')
        ) {
          return NextResponse.json(
            {
              error:
                'Missing required permission: DeviceManagementManagedDevices.Read.All. Please add this permission to your Azure AD app registration and grant admin consent.',
              permissionRequired: 'DeviceManagementManagedDevices.Read.All',
            },
            { status: 403 }
          );
        }
        if (graphError.status === 429) {
          return NextResponse.json(
            {
              error:
                'Microsoft Graph is throttling requests for this tenant. Please wait a minute and try again.',
            },
            { status: 429 }
          );
        }
        console.error('Error fetching detected app devices:', err);
        return NextResponse.json(
          { error: 'Failed to fetch devices from Intune' },
          { status: graphError.status && graphError.status >= 400 ? graphError.status : 502 }
        );
      }
    }

    const devices = [...deviceMap.values()].sort((a, b) =>
      a.deviceName.localeCompare(b.deviceName)
    );

    return NextResponse.json({
      devices,
      total: devices.length,
      summedDeviceCount,
      truncated,
      partial,
    } as DetectedAppDevicesResponse);
  } catch (error) {
    console.error('Error in detected-app-devices route:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch devices' },
      { status: 500 }
    );
  }
}
