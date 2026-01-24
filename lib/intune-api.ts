/**
 * Microsoft Intune Graph API Client
 * Handles Win32 app creation, upload, and configuration
 */

import type {
  IntuneWin32App,
  DetectionRule,
  Win32LobAppAssignment,
  WindowsMinimumOperatingSystem,
  EntraIDGroup,
  GraphApiResponse,
} from '@/types/intune';
import type { PackageAssignment } from '@/types/upload';

const GRAPH_API_BASE = 'https://graph.microsoft.com/beta';

/**
 * Create a Win32 app in Intune
 */
export async function createWin32App(
  accessToken: string,
  app: Partial<IntuneWin32App>
): Promise<string> {
  const response = await fetch(
    `${GRAPH_API_BASE}/deviceAppManagement/mobileApps`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.win32LobApp',
        displayName: app.displayName,
        description: app.description || '',
        publisher: app.publisher || '',
        fileName: app.fileName,
        installCommandLine: app.installCommandLine,
        uninstallCommandLine: app.uninstallCommandLine,
        applicableArchitectures: app.applicableArchitectures || 'x64',
        minimumSupportedOperatingSystem: app.minimumSupportedOperatingSystem || {
          v10_1903: true,
        },
        installExperience: app.installExperience || {
          runAsAccount: 'system',
          deviceRestartBehavior: 'basedOnReturnCode',
        },
        returnCodes: app.returnCodes || getDefaultReturnCodes(),
        rules: [], // Rules are added after content upload
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to create Win32 app: ${error.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.id;
}

/**
 * Create a content version for the app
 */
export async function createContentVersion(
  accessToken: string,
  appId: string
): Promise<string> {
  const response = await fetch(
    `${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to create content version');
  }

  const data = await response.json();
  return data.id;
}

/**
 * Create a content file and get upload URL
 */
export async function createContentFile(
  accessToken: string,
  appId: string,
  contentVersionId: string,
  fileName: string,
  fileSize: number,
  encryptedFileSize: number
): Promise<{ fileId: string; uploadUrl: string }> {
  const response = await fetch(
    `${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${contentVersionId}/files`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.mobileAppContentFile',
        name: fileName,
        size: fileSize,
        sizeEncrypted: encryptedFileSize,
        isDependency: false,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to create content file');
  }

  const data = await response.json();

  // Wait for Azure Storage URI
  const uploadUrl = await waitForUploadUrl(accessToken, appId, contentVersionId, data.id);

  return {
    fileId: data.id,
    uploadUrl,
  };
}

/**
 * Wait for the Azure Storage upload URL to be ready
 */
async function waitForUploadUrl(
  accessToken: string,
  appId: string,
  contentVersionId: string,
  fileId: string,
  maxAttempts: number = 20
): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(
      `${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${contentVersionId}/files/${fileId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to check upload URL status');
    }

    const data = await response.json();

    if (data.azureStorageUri) {
      return data.azureStorageUri;
    }

    if (data.uploadState === 'azureStorageUriRequestFailed') {
      throw new Error('Failed to get Azure Storage URI');
    }

    // Wait before retrying
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error('Timeout waiting for upload URL');
}

/**
 * Commit the content file after upload
 */
export async function commitContentFile(
  accessToken: string,
  appId: string,
  contentVersionId: string,
  fileId: string,
  encryptionInfo: {
    encryptionKey: string;
    macKey: string;
    initializationVector: string;
    mac: string;
    profileIdentifier: string;
    fileDigest: string;
    fileDigestAlgorithm: string;
  }
): Promise<void> {
  const response = await fetch(
    `${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${contentVersionId}/files/${fileId}/commit`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileEncryptionInfo: {
          ...encryptionInfo,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to commit content file');
  }
}

/**
 * Wait for content file to be committed
 */
export async function waitForCommit(
  accessToken: string,
  appId: string,
  contentVersionId: string,
  fileId: string,
  maxAttempts: number = 30
): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetch(
      `${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${contentVersionId}/files/${fileId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error('Failed to check commit status');
    }

    const data = await response.json();

    if (data.uploadState === 'commitFileSuccess') {
      return;
    }

    if (data.uploadState === 'commitFileFailed') {
      throw new Error('Content file commit failed');
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error('Timeout waiting for commit');
}

/**
 * Update app with committed content version
 */
export async function updateAppWithContent(
  accessToken: string,
  appId: string,
  contentVersionId: string
): Promise<void> {
  const response = await fetch(
    `${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${appId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.win32LobApp',
        committedContentVersion: contentVersionId,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to update app with content');
  }
}

/**
 * Set detection rules for the app
 */
export async function setDetectionRules(
  accessToken: string,
  appId: string,
  rules: DetectionRule[]
): Promise<void> {
  const graphRules = rules.map(convertToGraphDetectionRule);

  const response = await fetch(
    `${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${appId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.win32LobApp',
        rules: graphRules,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to set detection rules');
  }
}

/**
 * Convert our detection rule format to Graph API format
 */
function convertToGraphDetectionRule(rule: DetectionRule): Record<string, unknown> {
  switch (rule.type) {
    case 'msi':
      return {
        '@odata.type': '#microsoft.graph.win32LobAppProductCodeRule',
        ruleType: 'detection',
        productCode: rule.productCode,
        productVersionOperator: rule.productVersionOperator || 'notConfigured',
        productVersion: rule.productVersion,
      };

    case 'file':
      return {
        '@odata.type': '#microsoft.graph.win32LobAppFileSystemRule',
        ruleType: 'detection',
        path: rule.path,
        fileOrFolderName: rule.fileOrFolderName,
        check32BitOn64System: rule.check32BitOn64System || false,
        operationType: mapFileDetectionType(rule.detectionType),
        operator: rule.operator || 'notConfigured',
        comparisonValue: rule.detectionValue,
      };

    case 'registry':
      return {
        '@odata.type': '#microsoft.graph.win32LobAppRegistryRule',
        ruleType: 'detection',
        keyPath: rule.keyPath,
        valueName: rule.valueName,
        check32BitOn64System: rule.check32BitOn64System || false,
        operationType: mapRegistryDetectionType(rule.detectionType),
        operator: rule.operator || 'notConfigured',
        comparisonValue: rule.detectionValue,
      };

    case 'script':
      return {
        '@odata.type': '#microsoft.graph.win32LobAppPowerShellScriptRule',
        ruleType: 'detection',
        scriptContent: Buffer.from(rule.scriptContent).toString('base64'),
        enforceSignatureCheck: rule.enforceSignatureCheck || false,
        runAs32Bit: rule.runAs32Bit || false,
        operationType: 'notConfigured',
      };

    default:
      throw new Error(`Unknown detection rule type: ${(rule as DetectionRule).type}`);
  }
}

function mapFileDetectionType(type: string): string {
  const mapping: Record<string, string> = {
    exists: 'exists',
    notExists: 'doesNotExist',
    version: 'version',
    dateModified: 'modifiedDate',
    dateCreated: 'createdDate',
    string: 'string',
    sizeInMB: 'sizeInMB',
  };
  return mapping[type] || 'exists';
}

function mapRegistryDetectionType(type: string): string {
  const mapping: Record<string, string> = {
    exists: 'exists',
    notExists: 'doesNotExist',
    string: 'string',
    integer: 'integer',
    version: 'version',
  };
  return mapping[type] || 'exists';
}

/**
 * Assign app to groups
 */
export async function assignToGroups(
  accessToken: string,
  appId: string,
  assignments: Win32LobAppAssignment[]
): Promise<void> {
  const response = await fetch(
    `${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${appId}/assign`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        mobileAppAssignments: assignments,
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to assign app to groups');
  }
}

/**
 * Get Entra ID groups for assignment
 */
export async function getEntraIDGroups(
  accessToken: string,
  search?: string
): Promise<EntraIDGroup[]> {
  const url = new URL(`${GRAPH_API_BASE}/groups`);
  url.searchParams.set('$select', 'id,displayName,description,securityEnabled');
  url.searchParams.set('$top', '50');

  if (search) {
    url.searchParams.set('$search', `"displayName:${search}"`);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ConsistencyLevel: 'eventual',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get Entra ID groups');
  }

  const data: GraphApiResponse<EntraIDGroup> = await response.json();
  return data.value || [];
}

/**
 * Get default return codes for Win32 apps
 */
function getDefaultReturnCodes() {
  return [
    { returnCode: 0, type: 'success' },
    { returnCode: 1707, type: 'success' },
    { returnCode: 3010, type: 'softReboot' },
    { returnCode: 1641, type: 'hardReboot' },
    { returnCode: 1618, type: 'retry' },
  ];
}

/**
 * Get app details
 */
export async function getApp(
  accessToken: string,
  appId: string
): Promise<IntuneWin32App | null> {
  const response = await fetch(
    `${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${appId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error('Failed to get app');
  }

  return response.json();
}

/**
 * Delete an app
 */
export async function deleteApp(
  accessToken: string,
  appId: string
): Promise<void> {
  const response = await fetch(
    `${GRAPH_API_BASE}/deviceAppManagement/mobileApps/${appId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!response.ok && response.status !== 404) {
    throw new Error('Failed to delete app');
  }
}

/**
 * Convert PackageAssignment array to Microsoft Graph API Win32LobAppAssignment format
 */
export function convertToGraphAssignments(
  assignments: PackageAssignment[]
): Win32LobAppAssignment[] {
  return assignments.map((assignment) => {
    let target: Win32LobAppAssignment['target'];

    switch (assignment.type) {
      case 'allUsers':
        target = {
          '@odata.type': '#microsoft.graph.allLicensedUsersAssignmentTarget',
        };
        break;
      case 'allDevices':
        target = {
          '@odata.type': '#microsoft.graph.allDevicesAssignmentTarget',
        };
        break;
      case 'group':
        target = {
          '@odata.type': '#microsoft.graph.groupAssignmentTarget',
          groupId: assignment.groupId,
        };
        break;
      default:
        throw new Error(`Unknown assignment type: ${(assignment as PackageAssignment).type}`);
    }

    return {
      '@odata.type': '#microsoft.graph.mobileAppAssignment',
      intent: assignment.intent,
      target,
      settings: {
        '@odata.type': '#microsoft.graph.win32LobAppAssignmentSettings',
        notifications: 'showAll',
        deliveryOptimizationPriority: 'notConfigured',
      },
    };
  });
}

/**
 * Get Intune portal URL for an app
 */
export function getIntunePortalUrl(appId: string): string {
  return `https://intune.microsoft.com/#view/Microsoft_Intune_Apps/SettingsBlade/appId/${appId}`;
}
