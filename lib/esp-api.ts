/**
 * Enrollment Status Page (ESP) Profile API
 * Manages ESP profiles via Microsoft Graph API (beta)
 *
 * Important: The Intune backend requires the FULL profile object in PATCH
 * requests, not just the changed fields. We GET the complete profile first,
 * modify the needed fields, and send everything back.
 */

import type { EspProfileSummary } from '@/types/esp';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

export class EspProfileListError extends Error {
  constructor(public readonly status: number, message = `Failed to list device enrollment configurations (${status})`) {
    super(message);
    this.name = 'EspProfileListError';
  }
}

export class EspProfilePermissionError extends EspProfileListError {
  constructor() {
    super(403, "Intune denied access to Enrollment Status Page profiles. Check that IntuneGet's existing DeviceManagementServiceConfig.ReadWrite.All admin consent is still in place and that the tenant has an active Intune license.");
    this.name = 'EspProfilePermissionError';
  }
}

interface EspProfileConfig {
  '@odata.type': string;
  id: string;
  displayName: string;
  description: string;
  showInstallationProgress: boolean;
  blockDeviceSetupRetryByUser: boolean;
  allowDeviceResetOnInstallFailure: boolean;
  allowLogCollectionOnInstallFailure: boolean;
  customErrorMessage: string;
  installProgressTimeoutInMinutes: number;
  allowDeviceUseOnInstallFailure: boolean;
  selectedMobileAppIds: string[];
  allowNonBlockingAppInstallation: boolean;
  installQualityUpdates: boolean;
  trackInstallProgressForAutopilotOnly: boolean;
  disableUserStatusTrackingAfterFirstUser: boolean;
  roleScopeTagIds: string[];
  [key: string]: unknown;
}

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
    if (response.status === 403) throw new EspProfilePermissionError();
    throw new EspProfileListError(response.status);
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
 * Get a single ESP profile with its full configuration.
 * Returns the raw profile object so it can be modified and sent back
 * in a PATCH (Intune requires the full object, not partial updates).
 */
export async function getEspProfile(
  accessToken: string,
  profileId: string
): Promise<EspProfileConfig> {
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

  return await response.json();
}

/**
 * Fields that should not be sent back in PATCH requests.
 * These are read-only or server-managed properties.
 */
const READ_ONLY_FIELDS = [
  'id',
  'createdDateTime',
  'lastModifiedDateTime',
  'version',
  'priority',
  'deviceEnrollmentConfigurationType',
  '@odata.context',
];

/**
 * Add an app to an ESP profile's selectedMobileAppIds.
 * Reads the full profile, modifies selectedMobileAppIds (and enables
 * showInstallationProgress if needed), then PATCHes the complete object.
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
  // Get full profile configuration
  const profile = await getEspProfile(accessToken, profileId);
  const currentAppIds = profile.selectedMobileAppIds || [];

  if (currentAppIds.includes(appId)) {
    return { alreadyAdded: true };
  }

  // Build the full PATCH body from the current profile
  const patchBody: Record<string, unknown> = { ...profile };

  // Remove read-only fields
  for (const field of READ_ONLY_FIELDS) {
    delete patchBody[field];
  }

  // Update selectedMobileAppIds with the new app
  patchBody.selectedMobileAppIds = [...currentAppIds, appId];

  // Enable showInstallationProgress if it's off (required for blocking apps)
  if (!profile.showInstallationProgress) {
    patchBody.showInstallationProgress = true;
  }

  const patchResponse = await fetch(
    `${GRAPH_API_BASE}/deviceManagement/deviceEnrollmentConfigurations/${profileId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patchBody),
    }
  );

  if (!patchResponse.ok) {
    const errorBody = await patchResponse.text().catch(() => '');
    if (patchResponse.status === 403) {
      throw new Error(
        `Missing permission to update ESP profiles. Ensure the app registration has the DeviceManagementServiceConfig.ReadWrite.All permission with admin consent granted.`
      );
    }
    if (patchResponse.status === 400) {
      throw new Error(
        `Failed to add app to ESP profile (400 Bad Request). Details: ${errorBody}`
      );
    }
    throw new Error(
      `Failed to update ESP profile ${profileId} (${patchResponse.status}): ${errorBody}`
    );
  }

  return { alreadyAdded: false };
}
