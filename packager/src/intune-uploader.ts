/**
 * Intune Uploader - Uploads .intunewin packages to Microsoft Intune
 */

import * as fs from 'fs';
import * as path from 'path';
import { PackagerConfig } from './config.js';
import { PackagingJob } from './job-poller.js';
import { GraphClient } from './graph-client.js';
import { createLogger, Logger } from './logger.js';

export interface IntuneAppResult {
  id: string;
  displayName: string;
  url: string;
}

export interface EncryptionInfo {
  encryptionKey: string;
  macKey: string;
  initializationVector: string;
  mac: string;
  profileIdentifier: string;
  fileDigest: string;
  fileDigestAlgorithm: string;
}

type ProgressCallback = (percent: number, message: string) => Promise<void>;

type AssignmentIntent = 'required' | 'available' | 'uninstall' | 'updateOnly';
type GraphAssignmentIntent = 'required' | 'available' | 'uninstall';

interface PackageAssignment {
  type: 'allUsers' | 'allDevices' | 'group' | 'exclusionGroup';
  intent: AssignmentIntent;
  groupId?: string;
  groupName?: string;
  filterId?: string;
  filterName?: string;
  filterType?: 'include' | 'exclude';
}

interface IntuneAppCategorySelection {
  id: string;
  displayName?: string;
}

interface AssignmentMigrationConfig {
  carryOverAssignments: boolean;
  removeAssignmentsFromPreviousApp: boolean;
  sourceIntuneAppId?: string;
}

interface GraphAssignmentTarget {
  '@odata.type': string;
  groupId?: string;
  deviceAndAppManagementAssignmentFilterId?: string;
  deviceAndAppManagementAssignmentFilterType?: 'include' | 'exclude';
}

interface GraphMobileAppAssignment {
  '@odata.type': '#microsoft.graph.mobileAppAssignment';
  intent: GraphAssignmentIntent;
  target: GraphAssignmentTarget;
  settings: {
    '@odata.type': '#microsoft.graph.win32LobAppAssignmentSettings';
    notifications: 'showAll';
    deliveryOptimizationPriority: 'notConfigured';
  };
}

interface GraphAssignmentResponse {
  value?: Array<{
    intent?: string;
    target?: {
      '@odata.type'?: string;
      groupId?: string;
      deviceAndAppManagementAssignmentFilterId?: string;
      deviceAndAppManagementAssignmentFilterType?: string;
    };
  }>;
}

export class IntuneUploader {
  private config: PackagerConfig;
  private logger: Logger;

  constructor(config: PackagerConfig) {
    this.config = config;
    this.logger = createLogger('IntuneUploader');
  }

  /**
   * Upload .intunewin package to Intune
   */
  async uploadToIntune(
    job: PackagingJob,
    intunewinPath: string,
    encryptionInfo: EncryptionInfo,
    onProgress?: ProgressCallback
  ): Promise<IntuneAppResult> {
    const graphClient = new GraphClient(this.config, job.tenant_id);

    // Step 1: Create Win32 LOB App (5%)
    await onProgress?.(5, 'Creating app in Intune...');
    const app = await this.createWin32App(graphClient, job);
    this.logger.info('Created Win32 LOB App', { appId: app.id });

    // Step 2: Create content version (10%)
    await onProgress?.(10, 'Creating content version...');
    const contentVersion = await this.createContentVersion(graphClient, app.id);
    this.logger.info('Created content version', { contentVersionId: contentVersion.id });

    // Step 3: Create content file (15%)
    await onProgress?.(15, 'Preparing file upload...');
    const fileInfo = await fs.promises.stat(intunewinPath);
    const encryptedSize = fileInfo.size;

    const contentFile = await this.createContentFile(
      graphClient,
      app.id,
      contentVersion.id,
      path.basename(intunewinPath),
      encryptedSize
    );
    this.logger.info('Created content file', { contentFileId: contentFile.id });

    // Step 4: Wait for Azure Storage URI (20%)
    await onProgress?.(20, 'Waiting for upload location...');
    const uploadInfo = await this.waitForAzureStorageUri(
      graphClient,
      app.id,
      contentVersion.id,
      contentFile.id
    );
    this.logger.info('Got Azure Storage URI');

    // Step 5: Upload file chunks (25-80%)
    await onProgress?.(25, 'Uploading package...');
    await this.uploadFileChunks(
      intunewinPath,
      uploadInfo.azureStorageUri,
      async (percent) => {
        // Map chunk upload progress (0-100) to overall (25-80)
        const mappedPercent = 25 + Math.floor(percent * 0.55);
        await onProgress?.(mappedPercent, `Uploading package (${percent}%)...`);
      }
    );
    this.logger.info('File chunks uploaded');

    // Step 6: Commit file (85%)
    await onProgress?.(85, 'Committing file...');
    await this.commitFile(
      graphClient,
      app.id,
      contentVersion.id,
      contentFile.id,
      encryptionInfo
    );
    this.logger.info('File committed');

    // Step 7: Wait for processing (90%)
    await onProgress?.(90, 'Processing package...');
    await this.waitForFileProcessing(
      graphClient,
      app.id,
      contentVersion.id,
      contentFile.id
    );
    this.logger.info('File processing complete');

    // Step 8: Commit content version (95%)
    await onProgress?.(95, 'Finalizing deployment...');
    await this.commitContentVersion(graphClient, app.id, contentVersion.id);
    this.logger.info('Content version committed');

    // Step 9: Add detection rules (98%)
    await onProgress?.(98, 'Adding detection rules...');
    await this.addDetectionRules(graphClient, app.id, job);
    this.logger.info('Detection rules added');

    // Step 10: Apply assignment configuration (99%)
    await onProgress?.(99, 'Applying assignments...');
    await this.applyAssignments(graphClient, app.id, job);

    // Step 11: Apply category configuration (99%)
    await onProgress?.(99, 'Applying categories...');
    await this.applyCategories(graphClient, app.id, job);

    await onProgress?.(100, 'Upload complete');

    const appUrl = `https://intune.microsoft.com/#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/${app.id}`;

    return {
      id: app.id,
      displayName: job.display_name,
      url: appUrl,
    };
  }

  /**
   * Create Win32 LOB App in Intune
   */
  private async createWin32App(
    graphClient: GraphClient,
    job: PackagingJob
  ): Promise<{ id: string }> {
    const appBody = {
      '@odata.type': '#microsoft.graph.win32LobApp',
      displayName: job.display_name,
      description: `${job.display_name} ${job.version} - Deployed via IntuneGet`,
      publisher: job.publisher,
      displayVersion: job.version,
      installCommandLine: 'Invoke-AppDeployToolkit.exe',
      uninstallCommandLine: 'Invoke-AppDeployToolkit.exe -DeploymentType Uninstall',
      applicableArchitectures: this.mapArchitecture(job.architecture),
      minimumSupportedWindowsRelease: 'v10_1903',
      runAs32Bit: false,
      setupFilePath: 'Invoke-AppDeployToolkit.exe',
      installExperience: {
        runAsAccount: job.install_scope === 'user' ? 'user' : 'system',
        deviceRestartBehavior: 'suppress',
      },
      returnCodes: [
        { returnCode: 0, type: 'success' },
        { returnCode: 1707, type: 'success' },
        { returnCode: 3010, type: 'softReboot' },
        { returnCode: 1641, type: 'hardReboot' },
        { returnCode: 1618, type: 'retry' },
      ],
      rules: [], // Will add detection/requirement rules later
    };

    const response = await graphClient.post<{ id: string }>('/deviceAppManagement/mobileApps', appBody);
    return { id: response.id };
  }

  /**
   * Create content version
   */
  private async createContentVersion(
    graphClient: GraphClient,
    appId: string
  ): Promise<{ id: string }> {
    const response = await graphClient.post<{ id: string }>(
      `/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions`,
      {}
    );
    return { id: response.id };
  }

  /**
   * Create content file
   */
  private async createContentFile(
    graphClient: GraphClient,
    appId: string,
    contentVersionId: string,
    fileName: string,
    size: number
  ): Promise<{ id: string }> {
    const response = await graphClient.post<{ id: string }>(
      `/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${contentVersionId}/files`,
      {
        '@odata.type': '#microsoft.graph.mobileAppContentFile',
        name: fileName,
        size: size,
        sizeEncrypted: size,
        isDependency: false,
      }
    );
    return { id: response.id };
  }

  /**
   * Wait for Azure Storage URI to be available
   */
  private async waitForAzureStorageUri(
    graphClient: GraphClient,
    appId: string,
    contentVersionId: string,
    contentFileId: string
  ): Promise<{ azureStorageUri: string }> {
    const maxAttempts = 60;
    const delayMs = 2000;

    interface ContentFileResponse {
      azureStorageUri?: string;
      uploadState?: string;
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const file = await graphClient.get<ContentFileResponse>(
        `/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${contentVersionId}/files/${contentFileId}`
      );

      if (file.azureStorageUri) {
        return { azureStorageUri: file.azureStorageUri };
      }

      if (file.uploadState === 'azureStorageUriRequestFailed') {
        throw new Error('Azure Storage URI request failed');
      }

      await this.sleep(delayMs);
    }

    throw new Error('Timeout waiting for Azure Storage URI');
  }

  /**
   * Upload file in chunks to Azure Storage
   */
  private async uploadFileChunks(
    filePath: string,
    azureStorageUri: string,
    onProgress?: (percent: number) => Promise<void>
  ): Promise<void> {
    const fetch = (await import('node-fetch')).default;
    const fileHandle = await fs.promises.open(filePath, 'r');
    const stats = await fileHandle.stat();
    const fileSize = stats.size;

    const chunkSize = 6 * 1024 * 1024; // 6 MB chunks
    const totalChunks = Math.ceil(fileSize / chunkSize);
    const blockIds: string[] = [];

    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, fileSize);
        const chunk = Buffer.alloc(end - start);

        await fileHandle.read(chunk, 0, chunk.length, start);

        // Create block ID (must be base64 encoded and same length)
        const blockId = Buffer.from(String(chunkIndex).padStart(6, '0')).toString('base64');
        blockIds.push(blockId);

        // Upload block
        const blockUrl = `${azureStorageUri}&comp=block&blockid=${encodeURIComponent(blockId)}`;
        const response = await fetch(blockUrl, {
          method: 'PUT',
          headers: {
            'Content-Length': chunk.length.toString(),
            'x-ms-blob-type': 'BlockBlob',
          },
          body: chunk,
        });

        if (!response.ok) {
          throw new Error(`Failed to upload block ${chunkIndex}: ${response.statusText}`);
        }

        const percent = Math.floor(((chunkIndex + 1) / totalChunks) * 100);
        await onProgress?.(percent);
      }

      // Commit blocks
      const blockListXml = this.createBlockListXml(blockIds);
      const commitUrl = `${azureStorageUri}&comp=blocklist`;
      const commitResponse = await fetch(commitUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/xml',
        },
        body: blockListXml,
      });

      if (!commitResponse.ok) {
        throw new Error(`Failed to commit blocks: ${commitResponse.statusText}`);
      }
    } finally {
      await fileHandle.close();
    }
  }

  /**
   * Create block list XML for Azure Storage
   */
  private createBlockListXml(blockIds: string[]): string {
    const blocks = blockIds.map((id) => `<Latest>${id}</Latest>`).join('');
    return `<?xml version="1.0" encoding="utf-8"?><BlockList>${blocks}</BlockList>`;
  }

  /**
   * Commit the content file with encryption info
   */
  private async commitFile(
    graphClient: GraphClient,
    appId: string,
    contentVersionId: string,
    contentFileId: string,
    encryptionInfo: EncryptionInfo
  ): Promise<void> {
    await graphClient.post(
      `/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${contentVersionId}/files/${contentFileId}/commit`,
      {
        fileEncryptionInfo: {
          encryptionKey: encryptionInfo.encryptionKey,
          macKey: encryptionInfo.macKey,
          initializationVector: encryptionInfo.initializationVector,
          mac: encryptionInfo.mac,
          profileIdentifier: encryptionInfo.profileIdentifier,
          fileDigest: encryptionInfo.fileDigest,
          fileDigestAlgorithm: encryptionInfo.fileDigestAlgorithm,
        },
      }
    );
  }

  /**
   * Wait for file processing to complete
   */
  private async waitForFileProcessing(
    graphClient: GraphClient,
    appId: string,
    contentVersionId: string,
    contentFileId: string
  ): Promise<void> {
    const maxAttempts = 120;
    const delayMs = 5000;

    interface ContentFileResponse {
      uploadState?: string;
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const file = await graphClient.get<ContentFileResponse>(
        `/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${contentVersionId}/files/${contentFileId}`
      );

      if (file.uploadState === 'commitFileSuccess') {
        return;
      }

      if (file.uploadState === 'commitFileFailed') {
        throw new Error('File commit failed');
      }

      await this.sleep(delayMs);
    }

    throw new Error('Timeout waiting for file processing');
  }

  /**
   * Commit the content version
   */
  private async commitContentVersion(
    graphClient: GraphClient,
    appId: string,
    contentVersionId: string
  ): Promise<void> {
    await graphClient.patch(`/deviceAppManagement/mobileApps/${appId}`, {
      '@odata.type': '#microsoft.graph.win32LobApp',
      committedContentVersion: contentVersionId,
    });
  }

  /**
   * Add detection rules (and requirement rules if present) to the app
   */
  private async addDetectionRules(
    graphClient: GraphClient,
    appId: string,
    job: PackagingJob
  ): Promise<void> {
    const detectionRules = this.buildDetectionRules(job);
    const requirementRules = this.extractRequirementRules(job);

    // Set detection rules using the detectionRules property (old format,
    // compatible with the win32LobAppDetection type names used by buildDetectionRules)
    if (detectionRules.length > 0) {
      await graphClient.patch(`/deviceAppManagement/mobileApps/${appId}`, {
        '@odata.type': '#microsoft.graph.win32LobApp',
        detectionRules: detectionRules,
      });
    }

    // If requirement rules exist (for "Update Only" mode), read the current
    // unified rules array (which now includes the detection rules set above,
    // converted to win32LobAppRule format by Graph internally), append the
    // requirement rules, and PATCH back the complete set.
    if (requirementRules.length > 0) {
      const app = await graphClient.get<{ rules?: unknown[] }>(
        `/deviceAppManagement/mobileApps/${appId}`
      );
      const currentRules = app.rules || [];
      await graphClient.patch(`/deviceAppManagement/mobileApps/${appId}`, {
        '@odata.type': '#microsoft.graph.win32LobApp',
        rules: [...currentRules, ...requirementRules],
      });
      this.logger.info('Added requirement rules for Update Only mode', {
        appId,
        requirementRuleCount: requirementRules.length,
      });
    }
  }

  /**
   * Apply assignments to the new app and optionally remove assignments from the previous app.
   */
  private async applyAssignments(
    graphClient: GraphClient,
    newAppId: string,
    job: PackagingJob
  ): Promise<void> {
    const explicitAssignments = this.extractExplicitAssignments(job);
    const migrationConfig = this.extractAssignmentMigrationConfig(job);
    let graphAssignments = this.toGraphAssignments(explicitAssignments);

    if (
      graphAssignments.length === 0 &&
      migrationConfig.carryOverAssignments &&
      migrationConfig.sourceIntuneAppId
    ) {
      graphAssignments = await this.getGraphAssignmentsForApp(
        graphClient,
        migrationConfig.sourceIntuneAppId
      );
      this.logger.info('Carried over assignments from previous app', {
        sourceAppId: migrationConfig.sourceIntuneAppId,
        assignmentCount: graphAssignments.length,
      });
    }

    if (graphAssignments.length > 0) {
      await this.assignApp(graphClient, newAppId, graphAssignments);
      this.logger.info('Applied assignments to new app', {
        newAppId,
        assignmentCount: graphAssignments.length,
      });
    } else {
      this.logger.debug('No assignments to apply', { newAppId });
    }

    if (
      migrationConfig.carryOverAssignments &&
      migrationConfig.removeAssignmentsFromPreviousApp &&
      migrationConfig.sourceIntuneAppId
    ) {
      try {
        await this.assignApp(graphClient, migrationConfig.sourceIntuneAppId, []);
        this.logger.info('Removed assignments from previous app', {
          sourceAppId: migrationConfig.sourceIntuneAppId,
        });
      } catch (error) {
        this.logger.warn('Failed to remove assignments from previous app', {
          sourceAppId: migrationConfig.sourceIntuneAppId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private extractCategories(job: PackagingJob): IntuneAppCategorySelection[] {
    const packageConfig = this.asRecord(job.package_config);
    if (!packageConfig) {
      return [];
    }

    const parsed: IntuneAppCategorySelection[] = [];

    if (Array.isArray(packageConfig.categories)) {
      for (const item of packageConfig.categories) {
        const category = this.asRecord(item);
        if (!category || typeof category.id !== 'string' || category.id.length === 0) {
          continue;
        }

        parsed.push({
          id: category.id,
          displayName: typeof category.displayName === 'string' ? category.displayName : undefined,
        });
      }
    }

    // Backward compatibility for payloads that only include IDs
    if (parsed.length === 0 && Array.isArray(packageConfig.categoryIds)) {
      for (const categoryId of packageConfig.categoryIds) {
        if (typeof categoryId !== 'string' || categoryId.length === 0) {
          continue;
        }
        parsed.push({ id: categoryId });
      }
    }

    const seen = new Set<string>();
    return parsed.filter((category) => {
      if (seen.has(category.id)) {
        return false;
      }
      seen.add(category.id);
      return true;
    });
  }

  private async applyCategories(
    graphClient: GraphClient,
    appId: string,
    job: PackagingJob
  ): Promise<void> {
    const categories = this.extractCategories(job);
    if (categories.length === 0) {
      this.logger.debug('No categories to apply', { appId });
      return;
    }

    for (const category of categories) {
      await graphClient.post(`/deviceAppManagement/mobileApps/${appId}/categories/$ref`, {
        '@odata.id': `https://graph.microsoft.com/beta/deviceAppManagement/mobileAppCategories/${category.id}`,
      });
    }

    this.logger.info('Applied categories to app', {
      appId,
      categoryCount: categories.length,
      categoryIds: categories.map((category) => category.id),
    });
  }

  private extractExplicitAssignments(job: PackagingJob): PackageAssignment[] {
    const packageConfig = this.asRecord(job.package_config);
    if (!packageConfig) {
      return [];
    }

    const assignments = packageConfig.assignments;
    if (Array.isArray(assignments)) {
      return assignments
        .filter((item): item is PackageAssignment => {
          const assignment = this.asRecord(item);
          if (!assignment) return false;

          const type = assignment.type;
          const intent = assignment.intent;
          if (
            type !== 'allUsers' &&
            type !== 'allDevices' &&
            type !== 'group' &&
            type !== 'exclusionGroup'
          ) {
            return false;
          }

          if (
            intent !== 'required' &&
            intent !== 'available' &&
            intent !== 'uninstall' &&
            intent !== 'updateOnly'
          ) {
            return false;
          }

          if (type === 'group' || type === 'exclusionGroup') {
            return typeof assignment.groupId === 'string' && assignment.groupId.length > 0;
          }

          return true;
        })
        .map((assignment) => ({
          type: assignment.type,
          intent: assignment.intent,
          groupId: assignment.groupId,
          groupName: assignment.groupName,
          filterId: typeof assignment.filterId === 'string' ? assignment.filterId : undefined,
          filterName: typeof assignment.filterName === 'string' ? assignment.filterName : undefined,
          filterType: assignment.filterType === 'include' || assignment.filterType === 'exclude'
            ? assignment.filterType
            : undefined,
        }));
    }

    const assignedGroups = packageConfig.assignedGroups;
    if (!Array.isArray(assignedGroups)) {
      return [];
    }

    return assignedGroups
      .map((item) => this.asRecord(item))
      .filter((group): group is Record<string, unknown> => Boolean(group))
      .filter((group) => typeof group.groupId === 'string' && group.groupId.length > 0)
      .map((group) => ({
        type: 'group' as const,
        intent: (group.assignmentType as AssignmentIntent) || 'required',
        groupId: group.groupId as string,
        groupName: typeof group.groupName === 'string' ? group.groupName : undefined,
      }));
  }

  private extractAssignmentMigrationConfig(job: PackagingJob): AssignmentMigrationConfig {
    const packageConfig = this.asRecord(job.package_config);
    if (!packageConfig) {
      return {
        carryOverAssignments: false,
        removeAssignmentsFromPreviousApp: false,
      };
    }

    const nested = this.asRecord(packageConfig.assignmentMigration);
    const sourceIntuneAppId = typeof packageConfig.sourceIntuneAppId === 'string'
      ? packageConfig.sourceIntuneAppId
      : undefined;

    const carryOverAssignments = Boolean(
      (nested?.carryOverAssignments as boolean | undefined) ??
        packageConfig.carryOverAssignments
    );
    const removeAssignmentsFromPreviousApp = Boolean(
      (nested?.removeAssignmentsFromPreviousApp as boolean | undefined) ??
        packageConfig.removeAssignmentsFromPreviousApp
    );

    return {
      carryOverAssignments,
      removeAssignmentsFromPreviousApp,
      sourceIntuneAppId,
    };
  }

  private toGraphAssignments(assignments: PackageAssignment[]): GraphMobileAppAssignment[] {
    const graphAssignments: GraphMobileAppAssignment[] = [];

    for (const assignment of assignments) {
      let target: GraphAssignmentTarget;

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
          if (!assignment.groupId) {
            continue;
          }
          target = {
            '@odata.type': '#microsoft.graph.groupAssignmentTarget',
            groupId: assignment.groupId,
          };
          break;
        case 'exclusionGroup':
          if (!assignment.groupId) {
            continue;
          }
          target = {
            '@odata.type': '#microsoft.graph.exclusionGroupAssignmentTarget',
            groupId: assignment.groupId,
          };
          break;
        default:
          continue;
      }

      // Add filter properties if configured
      if (assignment.filterId) {
        target.deviceAndAppManagementAssignmentFilterId = assignment.filterId;
        target.deviceAndAppManagementAssignmentFilterType = assignment.filterType || 'include';
      }

      // Map 'updateOnly' to 'required' for Graph API (requirement rules handle the gating)
      const graphIntent: GraphAssignmentIntent =
        assignment.intent === 'updateOnly' ? 'required' : assignment.intent;

      graphAssignments.push({
        '@odata.type': '#microsoft.graph.mobileAppAssignment',
        intent: graphIntent,
        target,
        settings: {
          '@odata.type': '#microsoft.graph.win32LobAppAssignmentSettings',
          notifications: 'showAll',
          deliveryOptimizationPriority: 'notConfigured',
        },
      });
    }

    return graphAssignments;
  }

  private async getGraphAssignmentsForApp(
    graphClient: GraphClient,
    appId: string
  ): Promise<GraphMobileAppAssignment[]> {
    const response = await graphClient.get<GraphAssignmentResponse>(
      `/deviceAppManagement/mobileApps/${appId}/assignments`
    );

    const assignments = response.value || [];
    const mapped: GraphMobileAppAssignment[] = [];

    for (const assignment of assignments) {
      const targetType = assignment.target?.['@odata.type'];
      if (!targetType) {
        continue;
      }

      let intent: GraphAssignmentIntent;
      if (assignment.intent === 'required') {
        intent = 'required';
      } else if (assignment.intent === 'uninstall') {
        intent = 'uninstall';
      } else {
        intent = 'available';
      }

      const target: GraphAssignmentTarget = {
        '@odata.type': targetType,
      };
      if (assignment.target?.groupId) {
        target.groupId = assignment.target.groupId;
      }
      if (assignment.target?.deviceAndAppManagementAssignmentFilterId) {
        target.deviceAndAppManagementAssignmentFilterId =
          assignment.target.deviceAndAppManagementAssignmentFilterId;
        target.deviceAndAppManagementAssignmentFilterType =
          (assignment.target.deviceAndAppManagementAssignmentFilterType as 'include' | 'exclude') || 'include';
      }

      mapped.push({
        '@odata.type': '#microsoft.graph.mobileAppAssignment',
        intent,
        target,
        settings: {
          '@odata.type': '#microsoft.graph.win32LobAppAssignmentSettings',
          notifications: 'showAll',
          deliveryOptimizationPriority: 'notConfigured',
        },
      });
    }

    return mapped;
  }

  private async assignApp(
    graphClient: GraphClient,
    appId: string,
    assignments: GraphMobileAppAssignment[]
  ): Promise<void> {
    await graphClient.post(`/deviceAppManagement/mobileApps/${appId}/assign`, {
      mobileAppAssignments: assignments,
    });
  }

  /**
   * Extract requirement rules from job configuration.
   * Requirement rules are already in Graph API format (ruleType: 'requirement').
   */
  private extractRequirementRules(job: PackagingJob): unknown[] {
    const packageConfig = this.asRecord(job.package_config);
    if (!packageConfig) {
      return [];
    }

    const requirementRules = packageConfig.requirementRules;
    if (!Array.isArray(requirementRules) || requirementRules.length === 0) {
      return [];
    }

    // Requirement rules are already in Graph API format, pass through directly
    return requirementRules;
  }

  /**
   * Build detection rules from job configuration
   */
  private buildDetectionRules(job: PackagingJob): unknown[] {
    const rules: unknown[] = [];

    if (Array.isArray(job.detection_rules)) {
      for (const rule of job.detection_rules) {
        const ruleObj = rule as Record<string, unknown>;

        if (ruleObj.type === 'file') {
          rules.push({
            '@odata.type': '#microsoft.graph.win32LobAppFileSystemDetectionRule',
            path: ruleObj.path,
            fileOrFolderName: ruleObj.fileOrFolderName,
            check32BitOn64System: ruleObj.check32BitOn64System || false,
            detectionType: ruleObj.detectionType || 'exists',
            operator: ruleObj.operator,
            detectionValue: ruleObj.detectionValue,
          });
        } else if (ruleObj.type === 'registry') {
          rules.push({
            '@odata.type': '#microsoft.graph.win32LobAppRegistryDetectionRule',
            keyPath: ruleObj.keyPath,
            valueName: ruleObj.valueName,
            check32BitOn64System: ruleObj.check32BitOn64System || false,
            detectionType: ruleObj.detectionType || 'exists',
            operator: ruleObj.operator,
            detectionValue: ruleObj.detectionValue,
          });
        } else if (ruleObj.type === 'msi') {
          rules.push({
            '@odata.type': '#microsoft.graph.win32LobAppProductCodeDetectionRule',
            productCode: ruleObj.productCode,
            productVersionOperator: ruleObj.productVersionOperator || 'notConfigured',
            productVersion: ruleObj.productVersion,
          });
        } else if (ruleObj.type === 'script') {
          rules.push({
            '@odata.type': '#microsoft.graph.win32LobAppPowerShellScriptDetectionRule',
            scriptContent: Buffer.from(ruleObj.scriptContent as string).toString('base64'),
            enforceSignatureCheck: ruleObj.enforceSignatureCheck || false,
            runAs32Bit: ruleObj.runAs32Bit || false,
          });
        }
      }
    }

    // Add default detection rule if none specified
    if (rules.length === 0) {
      rules.push({
        '@odata.type': '#microsoft.graph.win32LobAppFileSystemDetectionRule',
        path: '%ProgramFiles%',
        fileOrFolderName: job.display_name.replace(/[^a-zA-Z0-9]/g, ''),
        check32BitOn64System: false,
        detectionType: 'exists',
      });
    }

    return rules;
  }

  /**
   * Map architecture string to Intune format
   */
  private mapArchitecture(arch: string): string {
    const archMap: Record<string, string> = {
      x64: 'x64',
      x86: 'x86',
      arm64: 'arm64',
      arm: 'arm',
    };
    return archMap[arch?.toLowerCase()] || 'x64';
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    return value as Record<string, unknown>;
  }
}
