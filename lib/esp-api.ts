/**
 * Enrollment Status Page (ESP) Profile API
 * Manages ESP profiles via Microsoft Graph API (beta)
 */

import type { EspProfileSummary } from '@/types/esp';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

interface DeviceEnrollmentConfiguration {
  id: string;
  displayName: string;
  description?: string;
  '@odata.type': string;
  selectedMobileAppIds?: string[];
}

interface GraphApiListResponse<T> {
  value: T[];
}

/**
 * List all ESP profiles (windows10EnrollmentCompletionPageConfiguration) in the tenant.
 * Note: selectedMobileAppIds is not requested in the list call because the Graph beta
 * API does not reliably return it via $select on the collection endpoint. The count
 * shown in the UI is an approximation; the individual GET (used at PATCH time) is
 * the authoritative source.
 */
export async function listEspProfiles(
  accessToken: string
): Promise<EspProfileSummary[]> {
  const url = new URL(
    `${GRAPH_API_BASE}/deviceManagement/deviceEnrollmentConfigurations`
  );
  url.searchParams.set('$select', 'id,displayName,description');

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const graphMsg = (errorBody as Record<string, Record<string, string>>)?.error?.message || response.statusText;
    throw new Error(`Failed to list device enrollment configurations (${response.status}): ${graphMsg}`);
  }

  const data: GraphApiListResponse<DeviceEnrollmentConfiguration> =
    await response.json();

  return (data.value || [])
    .filter(
      (config) =>
        config['@odata.type'] ===
        '#microsoft.graph.windows10EnrollmentCompletionPageConfiguration'
    )
    .map((config) => ({
      id: config.id,
      displayName: config.displayName,
      description: config.description,
      selectedAppCount: config.selectedMobileAppIds?.length || 0,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Get a single ESP profile with its selectedMobileAppIds.
 */
export async function getEspProfile(
  accessToken: string,
  profileId: string
): Promise<{ id: string; selectedMobileAppIds: string[] }> {
  const response = await fetch(
    `${GRAPH_API_BASE}/deviceManagement/deviceEnrollmentConfigurations/${profileId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to get ESP profile ${profileId}`);
  }

  const data: DeviceEnrollmentConfiguration = await response.json();
  return {
    id: data.id,
    selectedMobileAppIds: data.selectedMobileAppIds || [],
  };
}

/**
 * Add an app to an ESP profile's selectedMobileAppIds.
 * Reads current IDs first to avoid overwriting, then PATCHes the appended list.
 * Returns { alreadyAdded: true } if the app was already present.
 *
 * Known limitation: The Graph API has no atomic append for selectedMobileAppIds.
 * Concurrent calls targeting the same profile can race (read-modify-write).
 * Callers that deploy multiple apps to the same ESP profile should serialize
 * their calls to this function per profile ID.
 */
export async function addAppToEspProfile(
  accessToken: string,
  profileId: string,
  appId: string
): Promise<{ alreadyAdded: boolean }> {
  // Get current selected apps
  const profile = await getEspProfile(accessToken, profileId);

  if (profile.selectedMobileAppIds.includes(appId)) {
    return { alreadyAdded: true };
  }

  // Append the new app ID
  const updatedIds = [...profile.selectedMobileAppIds, appId];

  const patchResponse = await fetch(
    `${GRAPH_API_BASE}/deviceManagement/deviceEnrollmentConfigurations/${profileId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        '@odata.type':
          '#microsoft.graph.windows10EnrollmentCompletionPageConfiguration',
        selectedMobileAppIds: updatedIds,
      }),
    }
  );

  if (!patchResponse.ok) {
    const errorBody = await patchResponse.text().catch(() => '');
    if (patchResponse.status === 403) {
      throw new Error(
        `Missing permission to update ESP profiles. Ensure the app registration has the DeviceManagementServiceConfig.ReadWrite.All permission with admin consent granted.`
      );
    }
    throw new Error(
      `Failed to update ESP profile ${profileId} (${patchResponse.status}): ${errorBody}`
    );
  }

  return { alreadyAdded: false };
}
