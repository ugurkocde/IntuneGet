/**
 * Microsoft Store App Deployment
 * Deploys Store apps to Intune via Graph API winGetApp resource type.
 * Single API call - no packaging, no .intunewin, no GitHub Actions.
 */

import type { StoreCartItem, PackageAssignment, IntuneAppCategorySelection } from '@/types/upload';
import type { EspProfileSelection } from '@/types/esp';
import { addAppToEspProfile } from '@/lib/esp-api';
import { fetchIconAsBase64 } from '@/lib/intune-icon';

const GRAPH_BETA = 'https://graph.microsoft.com/beta';

export interface StoreDeployResult {
  intuneAppId: string;
  intuneAppUrl: string;
}

/**
 * Deploy a Microsoft Store app to Intune via Graph API.
 * Creates a winGetApp, then applies assignments and categories.
 */
export async function deployStoreApp(
  item: StoreCartItem,
  accessToken: string
): Promise<StoreDeployResult> {
  // Fetch icon as base64 if we have a Store CDN URL
  const largeIcon = await fetchIconAsBase64(item.iconPath);

  // Step 1: Create the winGetApp
  const appBody: Record<string, unknown> = {
    '@odata.type': '#microsoft.graph.winGetApp',
    displayName: item.displayName,
    description: item.description || `Deployed via IntuneGet from Microsoft Store: ${item.packageIdentifier}\nSource: IntuneGet.com`,
    publisher: item.publisher,
    packageIdentifier: item.packageIdentifier,
    installExperience: {
      runAsAccount: item.installExperience,
    },
  };

  if (largeIcon) {
    appBody.largeIcon = largeIcon;
  }

  const createResponse = await graphPost(
    '/deviceAppManagement/mobileApps',
    appBody,
    accessToken
  );

  if (!createResponse.ok) {
    const errorBody = await createResponse.text().catch(() => '');
    throw new Error(`Failed to create Store app (${createResponse.status}): ${errorBody}`);
  }

  const appData = await createResponse.json();
  const intuneAppId: string = appData.id;
  const intuneAppUrl = `https://intune.microsoft.com/#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/${intuneAppId}`;

  // Step 2: Wait for the app to finish publishing before assigning
  // Intune winGetApp goes through a publishing phase after creation
  const needsWait = (item.assignments && item.assignments.length > 0) ||
                    (item.categories && item.categories.length > 0) ||
                    (item.espProfiles && item.espProfiles.length > 0);
  if (needsWait) {
    await waitForPublished(intuneAppId, accessToken);
  }

  // Step 3: Apply assignments (if any)
  if (item.assignments && item.assignments.length > 0) {
    await applyStoreAssignments(intuneAppId, item.assignments, accessToken);
  }

  // Step 4: Apply categories (if any)
  if (item.categories && item.categories.length > 0) {
    await applyStoreCategories(intuneAppId, item.categories, accessToken);
  }

  // Step 5: Apply ESP profiles (if any) -- non-fatal to avoid orphaning the already-created app
  if (item.espProfiles && item.espProfiles.length > 0) {
    try {
      await applyEspProfiles(intuneAppId, item.espProfiles, accessToken);
    } catch (err) {
      console.error(`[Store deploy] ESP profile application failed for ${intuneAppId}:`, err);
    }
  }

  return { intuneAppId, intuneAppUrl };
}

/**
 * Apply assignments to a Store app using winGetAppAssignmentSettings.
 */
async function applyStoreAssignments(
  appId: string,
  assignments: PackageAssignment[],
  accessToken: string
): Promise<void> {
  const graphAssignments = assignments
    .map((assignment) => {
      let target: Record<string, unknown>;

      switch (assignment.type) {
        case 'allUsers':
          target = { '@odata.type': '#microsoft.graph.allLicensedUsersAssignmentTarget' };
          break;
        case 'allDevices':
          target = { '@odata.type': '#microsoft.graph.allDevicesAssignmentTarget' };
          break;
        case 'group':
          if (!assignment.groupId) return null;
          target = { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId: assignment.groupId };
          break;
        case 'exclusionGroup':
          if (!assignment.groupId) return null;
          target = { '@odata.type': '#microsoft.graph.exclusionGroupAssignmentTarget', groupId: assignment.groupId };
          break;
        default:
          return null;
      }

      // Add filter if configured
      if (assignment.filterId) {
        target.deviceAndAppManagementAssignmentFilterId = assignment.filterId;
        target.deviceAndAppManagementAssignmentFilterType = assignment.filterType || 'include';
      }

      // Map updateOnly to required (same as Win32 path)
      const intent = assignment.intent === 'updateOnly' ? 'required' : assignment.intent;

      const graphAssignment: Record<string, unknown> = {
        '@odata.type': '#microsoft.graph.mobileAppAssignment',
        intent,
        target,
        settings: {
          '@odata.type': '#microsoft.graph.winGetAppAssignmentSettings',
          notifications: 'showAll',
          installTimeSettings: null,
          restartSettings: null,
        },
      };

      // Exclusion assignments do not support settings
      if (assignment.type === 'exclusionGroup') {
        delete graphAssignment.settings;
      }

      return graphAssignment;
    })
    .filter(Boolean);

  if (graphAssignments.length === 0) return;

  const response = await graphPost(
    `/deviceAppManagement/mobileApps/${appId}/assign`,
    { mobileAppAssignments: graphAssignments },
    accessToken
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Failed to assign Store app (${response.status}): ${errorBody}`);
  }
}

/**
 * Apply categories to a Store app.
 */
async function applyStoreCategories(
  appId: string,
  categories: IntuneAppCategorySelection[],
  accessToken: string
): Promise<void> {
  for (const category of categories) {
    const response = await graphPost(
      `/deviceAppManagement/mobileApps/${appId}/categories/$ref`,
      {
        '@odata.id': `${GRAPH_BETA}/deviceAppManagement/mobileAppCategories/${category.id}`,
      },
      accessToken
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Failed to apply category ${category.id} (${response.status}): ${errorBody}`);
    }
  }
}

/**
 * Poll until the winGetApp's publishingState becomes 'published'.
 * Intune needs a few seconds after creation before the app is ready for assignments.
 */
async function waitForPublished(
  appId: string,
  accessToken: string,
  maxAttempts: number = 15,
  intervalMs: number = 2000
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await graphGet(
      `/deviceAppManagement/mobileApps/${appId}?$select=id,publishingState`,
      accessToken
    );

    if (response.ok) {
      const data = await response.json();
      if (data.publishingState === 'published') {
        return;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  // Continue anyway after timeout - assignment might still work or fail with a clear error
  console.warn(`Store app ${appId} did not reach 'published' state after ${maxAttempts} attempts`);
}

/**
 * Add the deployed app to selected ESP profiles.
 */
async function applyEspProfiles(
  appId: string,
  espProfiles: EspProfileSelection[],
  accessToken: string
): Promise<void> {
  for (const profile of espProfiles) {
    await addAppToEspProfile(accessToken, profile.id, appId);
  }
}

async function graphGet(
  path: string,
  accessToken: string
): Promise<Response> {
  return fetch(`${GRAPH_BETA}${path}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
}

async function graphPost(
  path: string,
  body: Record<string, unknown>,
  accessToken: string
): Promise<Response> {
  return fetch(`${GRAPH_BETA}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}
