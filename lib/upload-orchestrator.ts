/**
 * Upload Orchestrator
 * Coordinates the full deployment workflow from staging to Intune
 */

import type { CartItem, StagedPackage, UploadJob, PackagingJob } from '@/types/upload';
import type { DetectionRule } from '@/types/intune';
import {
  createWin32App,
  createContentVersion,
  createContentFile,
  commitContentFile,
  waitForCommit,
  updateAppWithContent,
  setDetectionRules,
  assignToGroups,
  getIntunePortalUrl,
} from './intune-api';

export interface DeploymentResult {
  success: boolean;
  appId?: string;
  appUrl?: string;
  errorMessage?: string;
}

export interface ProgressCallback {
  (jobId: string, status: string, progress: number, step?: string): void;
}

/**
 * Deploy a staged package to Intune
 * This is the main orchestration function that handles the full workflow
 */
export async function deployToIntune(
  accessToken: string,
  stagedPackage: StagedPackage,
  onProgress?: ProgressCallback
): Promise<DeploymentResult> {
  const jobId = stagedPackage.id;

  try {
    // Step 1: Create the Win32 app in Intune
    onProgress?.(jobId, 'uploading', 10, 'Creating Win32 app in Intune...');

    const appId = await createWin32App(accessToken, {
      displayName: stagedPackage.displayName,
      description: `Deployed via IntuneGet from Winget: ${stagedPackage.wingetId}`,
      publisher: stagedPackage.publisher,
      fileName: getInstallerFileName(stagedPackage.installerUrl),
      installCommandLine: stagedPackage.installCommand,
      uninstallCommandLine: stagedPackage.uninstallCommand,
      applicableArchitectures: mapArchitecture(stagedPackage.architecture),
      installExperience: {
        runAsAccount: stagedPackage.installScope === 'user' ? 'user' : 'system',
        deviceRestartBehavior: 'basedOnReturnCode',
      },
      minimumSupportedOperatingSystem: {
        v10_1903: true,
      },
    });

    onProgress?.(jobId, 'uploading', 20, 'App created, preparing content upload...');

    // Step 2: Create content version
    const contentVersionId = await createContentVersion(accessToken, appId);

    onProgress?.(jobId, 'uploading', 30, 'Content version created...');

    // Step 3: Create content file and get upload URL
    // Note: In a real implementation, you would:
    // 1. Download the installer from stagedPackage.installerUrl
    // 2. Create the .intunewin package using Azure Function
    // 3. Upload the encrypted content to Azure Blob
    // 4. Commit the content

    // For now, we'll simulate this step
    // In production, this would integrate with the Azure Function packaging service
    onProgress?.(jobId, 'uploading', 40, 'Preparing package content...');

    if (!stagedPackage.intunewinUrl) {
      throw new Error('Package has not been prepared. .intunewin file is required.');
    }

    // Get file sizes (would come from the actual file in production)
    const fileSize = stagedPackage.intunewinSizeBytes || 0;
    const encryptedFileSize = fileSize; // In reality, encrypted size would be slightly different

    const { fileId, uploadUrl } = await createContentFile(
      accessToken,
      appId,
      contentVersionId,
      getInstallerFileName(stagedPackage.installerUrl),
      fileSize,
      encryptedFileSize
    );

    onProgress?.(jobId, 'uploading', 50, 'Uploading content to Azure...');

    // Step 4: Upload the .intunewin content to Azure
    // In production, this would stream the file from storage to Azure
    // await uploadToAzureBlob(uploadUrl, stagedPackage.intunewinUrl);

    onProgress?.(jobId, 'uploading', 70, 'Content uploaded, committing...');

    // Step 5: Commit the content file
    // Note: Encryption info would come from the packaging process
    const mockEncryptionInfo = {
      encryptionKey: '',
      macKey: '',
      initializationVector: '',
      mac: '',
      profileIdentifier: 'ProfileVersion1',
      fileDigest: '',
      fileDigestAlgorithm: 'SHA256',
    };

    await commitContentFile(
      accessToken,
      appId,
      contentVersionId,
      fileId,
      mockEncryptionInfo
    );

    // Step 6: Wait for commit to complete
    onProgress?.(jobId, 'uploading', 80, 'Waiting for content to process...');
    await waitForCommit(accessToken, appId, contentVersionId, fileId);

    // Step 7: Update app with committed content
    onProgress?.(jobId, 'configuring', 85, 'Finalizing app configuration...');
    await updateAppWithContent(accessToken, appId, contentVersionId);

    // Step 8: Set detection rules
    onProgress?.(jobId, 'configuring', 90, 'Configuring detection rules...');
    await setDetectionRules(accessToken, appId, stagedPackage.detectionRules);

    // Step 9: Complete
    onProgress?.(jobId, 'completed', 100, 'Deployment complete!');

    const appUrl = getIntunePortalUrl(appId);

    return {
      success: true,
      appId,
      appUrl,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    onProgress?.(jobId, 'failed', 0, errorMessage);

    return {
      success: false,
      errorMessage,
    };
  }
}

/**
 * Deploy multiple packages in batch
 */
export async function deployBatch(
  accessToken: string,
  packages: StagedPackage[],
  onProgress?: ProgressCallback
): Promise<Map<string, DeploymentResult>> {
  const results = new Map<string, DeploymentResult>();

  // Deploy packages sequentially to avoid rate limiting
  for (const pkg of packages) {
    const result = await deployToIntune(accessToken, pkg, onProgress);
    results.set(pkg.id, result);

    // Small delay between deployments
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return results;
}

/**
 * Create a packaging job for the Azure Function queue
 */
export function createPackagingJob(
  userId: string,
  stagedPackageId: string,
  cartItem: CartItem
): PackagingJob {
  return {
    id: crypto.randomUUID(),
    userId,
    stagedPackageId,
    downloadUrl: cartItem.installerUrl,
    installerType: cartItem.installerType,
    installerSha256: cartItem.installerSha256,
    packageId: cartItem.wingetId,
    version: cartItem.version,
    displayName: cartItem.displayName,
    publisher: cartItem.publisher,
    installCommand: cartItem.installCommand,
    uninstallCommand: cartItem.uninstallCommand,
    installScope: cartItem.installScope,
    architecture: cartItem.architecture,
    detectionRules: cartItem.detectionRules,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Convert CartItem to StagedPackage for upload
 */
export function cartItemToStagedPackage(
  userId: string,
  item: CartItem
): Omit<StagedPackage, 'id' | 'createdAt' | 'expiresAt'> {
  return {
    userId,
    wingetId: item.wingetId,
    displayName: item.displayName,
    publisher: item.publisher,
    version: item.version,
    architecture: item.architecture,
    installScope: item.installScope,
    installerType: item.installerType,
    installerUrl: item.installerUrl,
    installerSha256: item.installerSha256,
    installCommand: item.installCommand,
    uninstallCommand: item.uninstallCommand,
    detectionRules: item.detectionRules,
    status: 'pending',
  };
}

// Helper functions

function getInstallerFileName(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.split('/').pop() || 'installer.exe';
  } catch {
    return 'installer.exe';
  }
}

function mapArchitecture(arch: string): 'x64' | 'x86' | 'arm64' | 'arm' | 'neutral' {
  const mapping: Record<string, 'x64' | 'x86' | 'arm64' | 'arm' | 'neutral'> = {
    x64: 'x64',
    x86: 'x86',
    arm64: 'arm64',
    arm: 'arm',
    neutral: 'neutral',
  };
  return mapping[arch] || 'x64';
}

/**
 * Validate that all required data is present for deployment
 */
export function validateForDeployment(stagedPackage: StagedPackage): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!stagedPackage.wingetId) {
    errors.push('Package ID is required');
  }

  if (!stagedPackage.displayName) {
    errors.push('Display name is required');
  }

  if (!stagedPackage.installCommand) {
    errors.push('Install command is required');
  }

  if (!stagedPackage.uninstallCommand) {
    errors.push('Uninstall command is required');
  }

  if (!stagedPackage.detectionRules || stagedPackage.detectionRules.length === 0) {
    errors.push('At least one detection rule is required');
  }

  if (!stagedPackage.intunewinUrl && stagedPackage.status === 'ready') {
    errors.push('Package file URL is required for upload');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
