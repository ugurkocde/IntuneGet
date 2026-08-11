/**
 * Job Processor - Orchestrates the packaging and upload steps
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { PackagerConfig } from './config.js';
import { PackagingJob, JobPoller } from './job-poller.js';
import { IntuneUploader, IntuneAppResult, DuplicateAppError } from './intune-uploader.js';
import { createLogger, Logger } from './logger.js';

interface PackagingResult {
  intunewinPath: string;
  // Path to the inner AES-encrypted payload extracted from the .intunewin zip.
  // This (not the outer .intunewin) is what must be uploaded to Azure Storage.
  encryptedContentPath: string;
  // Size of the original unencrypted content (from Detection.xml); Intune's
  // mobileAppContentFile.size must be this value, not the encrypted size.
  unencryptedContentSize: number;
  // Size of the inner encrypted payload file (mobileAppContentFile.sizeEncrypted).
  encryptedContentSize: number;
  encryptionInfo: {
    encryptionKey: string;
    macKey: string;
    initializationVector: string;
    mac: string;
    profileIdentifier: string;
    fileDigest: string;
    fileDigestAlgorithm: string;
  };
}

export class JobProcessor {
  private config: PackagerConfig;
  private poller: JobPoller | null;
  private uploader: IntuneUploader;
  private logger: Logger;

  constructor(config: PackagerConfig, poller: JobPoller | null) {
    this.config = config;
    this.poller = poller;
    this.uploader = new IntuneUploader(config);
    this.logger = createLogger('JobProcessor');
  }

  /**
   * Process a packaging job
   * @throws Error if poller is not provided (null)
   */
  async processJob(job: PackagingJob): Promise<void> {
    if (!this.poller) {
      throw new Error('JobProcessor requires a JobPoller instance to process jobs');
    }
    const poller = this.poller;
    const jobWorkDir = path.join(this.config.paths.work, job.id);

    try {
      // Create job work directory
      await fs.promises.mkdir(jobWorkDir, { recursive: true });

      // Step 1: Download tools if needed (5%)
      await poller.updateJobProgress(job.id, 5, 'Checking tools...');
      await this.ensureToolsAvailable();

      // Step 2: Download installer (10-25%)
      await poller.updateJobProgress(job.id, 10, 'Downloading installer...');
      const installerPath = await this.downloadInstaller(job, jobWorkDir);
      await poller.updateJobProgress(job.id, 25, 'Installer downloaded');

      // Step 3: Verify SHA256 (25-30%)
      if (job.installer_sha256) {
        await poller.updateJobProgress(job.id, 25, 'Verifying checksum...');
        await this.verifyChecksum(installerPath, job.installer_sha256);
        await poller.updateJobProgress(job.id, 30, 'Checksum verified');
      }

      // Step 4: Create PSADT package (30-50%)
      await poller.updateJobProgress(job.id, 30, 'Creating PSADT package...');
      const packageDir = await this.createPsadtPackage(job, installerPath, jobWorkDir);
      await poller.updateJobProgress(job.id, 50, 'PSADT package created');

      // Step 5: Create .intunewin package (50-70%)
      await poller.updateJobProgress(job.id, 50, 'Creating .intunewin package...');
      const result = await this.createIntunewinPackage(packageDir, jobWorkDir);
      await poller.updateJobProgress(job.id, 70, '.intunewin package created');

      // Step 6: Update status to uploading
      await poller.updateJobStatus(job.id, 'uploading');

      // Step 7: Upload to Intune (70-95%)
      await poller.updateJobProgress(job.id, 75, 'Uploading to Intune...');
      let intuneApp;
      try {
        intuneApp = await this.uploader.uploadToIntune(
          job,
          result.encryptedContentPath,
          result.encryptionInfo,
          {
            unencryptedSize: result.unencryptedContentSize,
            encryptedSize: result.encryptedContentSize,
          },
          async (percent, message) => {
            // Map upload progress (0-100) to overall progress (75-95)
            const overallPercent = 75 + Math.floor(percent * 0.2);
            await poller.updateJobProgress(job.id, overallPercent, message);
          }
        );
      } catch (error) {
        if (error instanceof DuplicateAppError) {
          // Same app already deployed to this tenant via IntuneGet (by any
          // user): finish as duplicate_skipped instead of failing the job.
          await poller.updateJobStatus(job.id, 'duplicate_skipped', {
            intune_app_id: error.duplicateInfo.existingAppId,
            intune_app_url: error.duplicateInfo.existingAppUrl,
            duplicate_info: error.duplicateInfo,
            progress_percent: 100,
            progress_message: 'Duplicate app already exists in Intune',
          });
          this.logger.info('Job skipped as duplicate', {
            jobId: job.id,
            existingAppId: error.duplicateInfo.existingAppId,
            displayName: job.display_name,
          });
          return;
        }
        throw error;
      }

      // Step 8: Mark as deployed (100%)
      await poller.updateJobStatus(job.id, 'deployed', {
        intune_app_id: intuneApp.id,
        intune_app_url: intuneApp.url,
        progress_percent: 100,
        progress_message: 'Deployment complete',
      });

      this.logger.info('Job completed successfully', {
        jobId: job.id,
        intuneAppId: intuneApp.id,
        displayName: job.display_name,
      });
    } finally {
      // Cleanup job work directory
      try {
        await fs.promises.rm(jobWorkDir, { recursive: true, force: true });
        this.logger.debug('Cleaned up job work directory', { path: jobWorkDir });
      } catch {
        this.logger.warn('Failed to cleanup job work directory', { path: jobWorkDir });
      }
    }
  }

  /**
   * Ensure required tools are downloaded
   * This method is public to allow standalone tool setup without processing jobs
   */
  async ensureToolsAvailable(): Promise<void> {
    const toolsDir = this.config.paths.tools;
    await fs.promises.mkdir(toolsDir, { recursive: true });

    const intuneWinUtil = path.join(toolsDir, 'IntuneWinAppUtil.exe');
    const psadtDir = path.join(toolsDir, 'PSAppDeployToolkit');

    // A valid PSADT v4 template has Invoke-AppDeployToolkit.exe and the
    // PSAppDeployToolkit module folder at its root. Packager versions before
    // 1.2.0 extracted a v3-era layout (Toolkit/Deploy-Application.exe), so an
    // existing folder is not enough - treat anything else as stale.
    const isPsadtValid = () =>
      fs.existsSync(path.join(psadtDir, 'Invoke-AppDeployToolkit.exe')) &&
      fs.existsSync(path.join(psadtDir, 'PSAppDeployToolkit'));

    if (fs.existsSync(psadtDir) && !isPsadtValid()) {
      this.logger.warn('PSAppDeployToolkit folder has an outdated layout, re-downloading', {
        psadtDir,
      });
      await fs.promises.rm(psadtDir, { recursive: true, force: true });
    }

    // Check if tools exist
    const intuneWinExists = fs.existsSync(intuneWinUtil);

    if (!intuneWinExists || !fs.existsSync(psadtDir)) {
      this.logger.info('Downloading required tools...');

      // Run the download script
      const scriptPath = path.join(__dirname, '..', 'scripts', 'download-tools.ps1');

      // Check if script exists, if not use inline commands
      if (!fs.existsSync(scriptPath)) {
        await this.downloadToolsInline(toolsDir);
      } else {
        await this.runPowerShell(scriptPath, ['-ToolsDir', toolsDir]);
      }
    }

    // Verify tools are now available
    if (!fs.existsSync(intuneWinUtil)) {
      throw new Error('IntuneWinAppUtil.exe not found after download');
    }
    if (!isPsadtValid()) {
      throw new Error(
        `PSAppDeployToolkit template is missing or incomplete at ${psadtDir}. ` +
          'Delete the folder and run "intuneget-packager setup" to download it again.'
      );
    }

    this.logger.debug('Tools verified', { toolsDir });
  }

  /**
   * Download tools without external script
   */
  private async downloadToolsInline(toolsDir: string): Promise<void> {
    // Download IntuneWinAppUtil
    const intuneWinUrl = 'https://github.com/microsoft/Microsoft-Win32-Content-Prep-Tool/raw/master/IntuneWinAppUtil.exe';
    const intuneWinPath = path.join(toolsDir, 'IntuneWinAppUtil.exe');

    this.logger.info('Downloading IntuneWinAppUtil.exe...');
    await this.downloadFile(intuneWinUrl, intuneWinPath);

    // Download and extract PSAppDeployToolkit
    const psadtUrl = 'https://github.com/PSAppDeployToolkit/PSAppDeployToolkit/releases/download/4.1.8/PSAppDeployToolkit_Template_v4.zip';
    const psadtZipPath = path.join(toolsDir, 'psadt.zip');
    const psadtDir = path.join(toolsDir, 'PSAppDeployToolkit');

    this.logger.info('Downloading PSAppDeployToolkit...');
    await this.downloadFile(psadtUrl, psadtZipPath);

    // Extract using PowerShell
    await this.runPowerShell(`Expand-Archive -Path '${psadtZipPath}' -DestinationPath '${psadtDir}' -Force`);

    // Cleanup zip
    await fs.promises.unlink(psadtZipPath);
  }

  /**
   * Download a file
   * Some vendor CDNs reject the default client identity while accepting a
   * browser User-Agent (and vice versa), so retry once with a browser UA
   * when the server refuses the request outright.
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const fetch = (await import('node-fetch')).default;
    let response = await fetch(url);

    if (response.status === 403 || response.status === 406) {
      this.logger.warn('Download refused, retrying with browser User-Agent', {
        url,
        status: response.status,
      });
      response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
    }

    if (!response.ok) {
      throw new Error(`Failed to download ${url}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await fs.promises.writeFile(destPath, Buffer.from(buffer));
  }

  /**
   * Download the installer
   */
  private async downloadInstaller(job: PackagingJob, workDir: string): Promise<string> {
    const installerFileName = this.getInstallerFileName(job);
    const installerPath = path.join(workDir, installerFileName);

    this.logger.info('Downloading installer', {
      url: job.installer_url,
      destPath: installerPath,
    });

    await this.downloadFile(job.installer_url, installerPath);

    return installerPath;
  }

  /**
   * Get the installer file name from job
   */
  private getInstallerFileName(job: PackagingJob): string {
    // Try to extract filename from URL
    const urlPath = new URL(job.installer_url).pathname;
    let urlFileName = path.basename(urlPath);

    // Store URL-encoded names decoded (Firefox%20Setup.exe -> Firefox Setup.exe),
    // stripping any separators a decoded name could smuggle in
    try {
      urlFileName = path.basename(decodeURIComponent(urlFileName)).replace(/[\\/]/g, '');
    } catch {
      // Malformed escape sequence: keep the encoded name
    }

    if (urlFileName && urlFileName.includes('.')) {
      return urlFileName;
    }

    // Fall back to generating a name based on installer type
    const extension = this.getInstallerExtension(job.installer_type);
    return `installer${extension}`;
  }

  /**
   * Get file extension for installer type
   */
  private getInstallerExtension(installerType: string): string {
    const extensions: Record<string, string> = {
      msi: '.msi',
      exe: '.exe',
      msix: '.msix',
      appx: '.appx',
      inno: '.exe',
      nullsoft: '.exe',
      wix: '.msi',
      burn: '.exe',
      zip: '.zip',
    };
    return extensions[installerType] || '.exe';
  }

  /**
   * Verify file checksum
   */
  private async verifyChecksum(filePath: string, expectedSha256: string): Promise<void> {
    const fileBuffer = await fs.promises.readFile(filePath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    if (hash.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error(`Checksum mismatch: expected ${expectedSha256}, got ${hash}`);
    }

    this.logger.debug('Checksum verified', { sha256: hash });
  }

  /**
   * Create PSADT package structure
   */
  private async createPsadtPackage(
    job: PackagingJob,
    installerPath: string,
    workDir: string
  ): Promise<string> {
    const packageDir = path.join(workDir, 'Package');
    const filesDir = path.join(packageDir, 'Files');
    const toolkitDir = path.join(packageDir, 'PSAppDeployToolkit');

    // Create directory structure
    await fs.promises.mkdir(filesDir, { recursive: true });
    await fs.promises.mkdir(toolkitDir, { recursive: true });

    // Copy PSADT v4.1 toolkit files
    const psadtSource = path.join(this.config.paths.tools, 'PSAppDeployToolkit', 'PSAppDeployToolkit');
    if (!fs.existsSync(psadtSource)) {
      throw new Error(
        `PSAppDeployToolkit module not found at ${psadtSource}. ` +
          'Run "intuneget-packager setup" to download the required tools.'
      );
    }
    await this.copyDirectory(psadtSource, toolkitDir);

    // Copy Config, Strings, and Assets directories for PSADT v4.1
    const configSource = path.join(this.config.paths.tools, 'PSAppDeployToolkit', 'Config');
    if (fs.existsSync(configSource)) {
      await this.copyDirectory(configSource, path.join(packageDir, 'Config'));
    }
    const stringsSource = path.join(this.config.paths.tools, 'PSAppDeployToolkit', 'Strings');
    if (fs.existsSync(stringsSource)) {
      await this.copyDirectory(stringsSource, path.join(packageDir, 'Strings'));
    }
    const assetsSource = path.join(this.config.paths.tools, 'PSAppDeployToolkit', 'Assets');
    if (fs.existsSync(assetsSource)) {
      await this.copyDirectory(assetsSource, path.join(packageDir, 'Assets'));
    }

    // Copy Invoke-AppDeployToolkit.exe for PSADT v4.1
    const deployExeSource = path.join(
      this.config.paths.tools,
      'PSAppDeployToolkit',
      'Invoke-AppDeployToolkit.exe'
    );
    if (!fs.existsSync(deployExeSource)) {
      throw new Error(
        `Invoke-AppDeployToolkit.exe not found at ${deployExeSource}. ` +
          'Run "intuneget-packager setup" to download the required tools.'
      );
    }
    await fs.promises.copyFile(deployExeSource, path.join(packageDir, 'Invoke-AppDeployToolkit.exe'));

    // Copy installer to Files directory
    const installerFileName = path.basename(installerPath);
    await fs.promises.copyFile(installerPath, path.join(filesDir, installerFileName));

    // Generate Invoke-AppDeployToolkit.ps1
    const deployScript = this.generateDeployScript(job, installerFileName);
    await fs.promises.writeFile(path.join(packageDir, 'Invoke-AppDeployToolkit.ps1'), deployScript);

    this.logger.debug('PSADT package created', { packageDir });
    return packageDir;
  }

  /**
   * Generate Invoke-AppDeployToolkit.ps1 script (PSADT v4)
   */
  private generateDeployScript(job: PackagingJob, installerFileName: string): string {
    const silentSwitches = this.extractSilentSwitches(job.install_command, job.installer_type).replace(/'/g, "''");
    const successExitCodes = this.getInstallerSuccessCodes(job);
    const psadtVersion = '4.1.8';
    const appVendor = job.publisher.replace(/'/g, "''");
    const appName = job.display_name.replace(/'/g, "''");
    const appArch = job.architecture ?? '';
    const processLifecycle = this.getProcessLifecycle(job);

    return `<#
.SYNOPSIS
    ${appName} Deployment Script
.DESCRIPTION
    Deploys ${appName} ${job.version} using PSAppDeployToolkit v4
    Generated by IntuneGet self-hosted packager
#>

[CmdletBinding()]
param
(
    [Parameter(Mandatory = $false)]
    [ValidateSet('Install', 'Uninstall', 'Repair')]
    [System.String]$DeploymentType = 'Install',

    [Parameter(Mandatory = $false)]
    [ValidateSet('Auto', 'Interactive', 'NonInteractive', 'Silent')]
    [System.String]$DeployMode = 'Silent',

    [Parameter(Mandatory = $false)]
    [System.Management.Automation.SwitchParameter]$SuppressRebootPassThru,

    [Parameter(Mandatory = $false)]
    [System.Management.Automation.SwitchParameter]$TerminalServerMode,

    [Parameter(Mandatory = $false)]
    [System.Management.Automation.SwitchParameter]$DisableLogging
)

##================================================
## MARK: Variables
##================================================

$adtSession = @{
    AppVendor = '${appVendor}'
    AppName = '${appName}'
    AppVersion = '${job.version}'
    AppArch = '${appArch}'
    AppLang = 'EN'
    AppRevision = '01'
    AppSuccessExitCodes = @(${successExitCodes.join(', ')})
    AppRebootExitCodes = @(1641, 3010)
    AppProcessesToClose = ${processLifecycle.sessionLiteral}
    AppScriptVersion = '1.0.0'
    AppScriptDate = (Get-Date -Format 'yyyy-MM-dd')
    AppScriptAuthor = 'IntuneGet'
    RequireAdmin = $${job.install_scope === 'user' ? 'false' : 'true'}
    InstallName = ''
    InstallTitle = ''
    DeployAppScriptFriendlyName = $MyInvocation.MyCommand.Name
    DeployAppScriptParameters = $PSBoundParameters
    DeployAppScriptVersion = '${psadtVersion}'
}

function Install-ADTDeployment
{
    [CmdletBinding()]
    param ()
${processLifecycle.installBlock}
${this.getRegistryInstallSnapshotBlock(job, appName)}
${this.getPreInstallRemovalBlock(job, appName)}
    ## Install the application
    ${this.getInstallCommand(job, installerFileName, silentSwitches)}
${this.getPostInstallVerificationBlock(job, appName)}
${this.getPostCommandsBlock(job, 'postInstallCommands', 'Install-ADTDeployment')}
    ## Create IntuneGet detection marker for Intune detection rules
    ${this.getRegistryMarkerCreation(job)}
}

function Uninstall-ADTDeployment
{
    [CmdletBinding()]
    param ()
${processLifecycle.uninstallBlock}

    ## Uninstall the application
    ${this.getUninstallCommand(job, installerFileName)}
${this.getPostCommandsBlock(job, 'postUninstallCommands', 'Uninstall-ADTDeployment')}
    ## Remove IntuneGet detection marker
    ${this.getRegistryMarkerRemoval(job)}
}

function Repair-ADTDeployment
{
    [CmdletBinding()]
    param ()

    Write-ADTLogEntry -Message 'Repair operation is not implemented for this package' -Severity 'Warning' -Source 'Repair-ADTDeployment'
}

##================================================
## MARK: Initialization
##================================================

$ErrorActionPreference = [System.Management.Automation.ActionPreference]::Stop
$ProgressPreference = [System.Management.Automation.ActionPreference]::SilentlyContinue
$script:UninstallRebootExitCode = $null
Set-StrictMode -Version 1

try
{
    if (Test-Path -LiteralPath "$PSScriptRoot\\PSAppDeployToolkit\\PSAppDeployToolkit.psd1" -PathType Leaf)
    {
        Get-ChildItem -LiteralPath "$PSScriptRoot\\PSAppDeployToolkit" -Recurse -File | Unblock-File -ErrorAction Ignore
        Import-Module -FullyQualifiedName @{ ModuleName = "$PSScriptRoot\\PSAppDeployToolkit\\PSAppDeployToolkit.psd1"; Guid = '8c3c366b-8606-4576-9f2d-4051144f7ca2'; ModuleVersion = '${psadtVersion}' } -Force
    }
    else
    {
        Import-Module -FullyQualifiedName @{ ModuleName = 'PSAppDeployToolkit'; Guid = '8c3c366b-8606-4576-9f2d-4051144f7ca2'; ModuleVersion = '${psadtVersion}' } -Force
    }

    $iadtParams = Get-ADTBoundParametersAndDefaultValues -Invocation $MyInvocation
    $adtSession = Remove-ADTHashtableNullOrEmptyValues -Hashtable $adtSession
    $adtSession = Open-ADTSession @adtSession @iadtParams -PassThru
}
catch
{
    $Host.UI.WriteErrorLine((Out-String -InputObject $_ -Width ([System.Int32]::MaxValue)))
    exit 60008
}

##================================================
## MARK: Invocation
##================================================

try
{
    & "$($adtSession.DeploymentType)-ADTDeployment"
    if ($script:UninstallRebootExitCode) {
        Close-ADTSession -ExitCode $script:UninstallRebootExitCode
    } else {
        Close-ADTSession
    }
}
catch
{
    Write-ADTLogEntry -Message "An error occurred: $(Resolve-ADTErrorRecord -ErrorRecord $_)" -Severity 'Error' -Source 'Main'
    Close-ADTSession -ExitCode 60001
}
`;
  }

  /**
   * Get the psadtConfig object from package_config
   * Returns null when package_config or psadtConfig is absent or not an object
   */
  private getPsadtConfig(job: PackagingJob): Record<string, unknown> | null {
    const packageConfig = job.package_config;
    if (typeof packageConfig !== 'object' || packageConfig === null) {
      return null;
    }
    const psadtConfig = (packageConfig as Record<string, unknown>).psadtConfig;
    if (typeof psadtConfig !== 'object' || psadtConfig === null) {
      return null;
    }
    return psadtConfig as Record<string, unknown>;
  }

  private getProcessLifecycle(job: PackagingJob): {
    sessionLiteral: string;
    installBlock: string;
    uninstallBlock: string;
  } {
    const config = this.getPsadtConfig(job);
    const configuredProcesses = config?.processesToClose;
    if (configuredProcesses !== undefined && configuredProcesses !== null &&
        !Array.isArray(configuredProcesses)) {
      throw new Error('PSADT processesToClose must be an array');
    }
    const rawProcesses = Array.isArray(configuredProcesses) ? configuredProcesses : [];
    if (rawProcesses.length > 50) {
      throw new Error('PSADT processesToClose cannot contain more than 50 entries');
    }

    const configuredNames = new Set<string>();
    const processes: Array<{ name: string; description: string }> = [];
    for (const raw of rawProcesses) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('Each PSADT process entry must be an object');
      }
      const process = raw as Record<string, unknown>;
      if (typeof process.name !== 'string') {
        throw new Error('Each PSADT process entry must contain a string name');
      }
      const name = process.name.trim().replace(/\.exe$/i, '');
      if (!name || name.length > 260 || /[\x00-\x1F\x7F\\/:*?"<>|]/.test(name)) {
        throw new Error(
          `Invalid PSADT process name [${process.name}]; use an executable name without a path or .exe suffix`
        );
      }
      if (process.description !== undefined && process.description !== null &&
          typeof process.description !== 'string') {
        throw new Error(`The PSADT process description for [${name}] must be a string`);
      }
      const description = typeof process.description === 'string' && process.description.trim()
        ? process.description.replace(/[\x00-\x1F\x7F]+/g, ' ').trim()
        : name;
      if (description.length > 260) {
        throw new Error(`The PSADT process description for [${name}] cannot exceed 260 characters`);
      }
      const normalizedName = name.toLowerCase();
      if (!configuredNames.has(normalizedName)) {
        processes.push({ name, description });
        configuredNames.add(normalizedName);
      }
    }

    const sessionLiteral = processes.length === 0 ? '@()' : `@(${processes
      .map(({ name, description }) =>
        `@{ Name = '${name.replace(/'/g, "''")}'; Description = '${description.replace(/'/g, "''")}' }`
      )
      .join(', ')})`;

    const boundedInteger = (
      value: unknown,
      setting: string,
      fallback: number | null,
      maximum: number
    ): number | null => {
      if (value === undefined || value === null) return fallback;
      if (typeof value === 'string' && !value.trim()) {
        throw new Error(`PSADT ${setting} must be an integer from 0 through ${maximum}`);
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) {
        throw new Error(`PSADT ${setting} must be an integer from 0 through ${maximum}`);
      }
      return parsed;
    };

    const strictBoolean = (setting: string, fallback = false): boolean => {
      const value = config?.[setting];
      if (value === undefined || value === null) return fallback;
      if (typeof value !== 'boolean') {
        throw new Error(`PSADT ${setting} must be a boolean`);
      }
      return value;
    };

    const showClosePrompt = strictBoolean('showClosePrompt');
    const closeCountdown = boundedInteger(config?.closeCountdown, 'closeCountdown', 60, 86_400)!;
    const forceCloseCountdown = boundedInteger(
      config?.forceCloseProcessesCountdown,
      'forceCloseProcessesCountdown',
      null,
      86_400
    );
    const allowDefer = strictBoolean('allowDefer');
    const deferTimes = boundedInteger(config?.deferTimes, 'deferTimes', 3, 1_000)!;
    const blockExecution = strictBoolean('blockExecution');
    const promptToSave = strictBoolean('promptToSave');
    const persistPrompt = strictBoolean('persistPrompt');
    const minimizeWindows = strictBoolean('minimizeWindows');
    const allowedWindowLocations = new Set([
      'Default', 'Center', 'Top', 'Bottom', 'TopLeft', 'TopRight', 'BottomLeft', 'BottomRight',
    ]);
    const windowLocation = typeof config?.windowLocation === 'string' && config.windowLocation
      ? config.windowLocation
      : 'Default';
    if (!allowedWindowLocations.has(windowLocation)) {
      throw new Error(`Unsupported PSADT windowLocation [${windowLocation}]`);
    }

    let deferDays: number | null = null;
    if (config?.deferDays !== undefined && config.deferDays !== null) {
      deferDays = Number(config.deferDays);
      if (!Number.isFinite(deferDays) || deferDays < 0 || deferDays > 3_650) {
        throw new Error('PSADT deferDays must be a number from 0 through 3650');
      }
      // Zero is IntuneGet's UI/API sentinel for no day-based limit. PSADT
      // v4.1 rejects an explicitly supplied -DeferDays 0 value.
      if (deferDays === 0) deferDays = null;
    }
    let deferDeadline: string | null = null;
    if (config?.deferDeadline !== undefined && config.deferDeadline !== null) {
      if (typeof config.deferDeadline !== 'string') {
        throw new Error('PSADT deferDeadline must be a valid ISO date or date-time string');
      }
      const candidateDeferDeadline = config.deferDeadline.trim();
      if (candidateDeferDeadline && (
          candidateDeferDeadline.length > 64 ||
          !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(
            candidateDeferDeadline
          ) ||
          Number.isNaN(Date.parse(candidateDeferDeadline)))) {
        throw new Error('PSADT deferDeadline must be a valid ISO date or date-time string');
      }
      deferDeadline = candidateDeferDeadline || null;
    }
    const checkDiskSpace = strictBoolean('checkDiskSpace');
    const requiredDiskSpace = boundedInteger(
      config?.requiredDiskSpace,
      'requiredDiskSpace',
      null,
      0xFFFF_FFFF
    );

    const addInteractiveOptions = (parameters: string[]): void => {
      if (promptToSave && processes.length > 0) parameters.push('-PromptToSave');
      if (persistPrompt) parameters.push('-PersistPrompt');
      if (minimizeWindows) parameters.push('-MinimizeWindows');
      if (windowLocation !== 'Default') parameters.push(`-WindowLocation '${windowLocation}'`);
    };

    const installParameters: string[] = [];
    const interactiveInstall = allowDefer || (processes.length > 0 && showClosePrompt);
    if (processes.length > 0) {
      installParameters.push('-CloseProcesses $adtSession.AppProcessesToClose');
      if (allowDefer) {
        installParameters.push('-AllowDeferCloseProcesses');
        installParameters.push(forceCloseCountdown !== null
          ? `-ForceCloseProcessesCountdown ${forceCloseCountdown}`
          : `-CloseProcessesCountdown ${closeCountdown}`);
        installParameters.push(`-DeferTimes ${deferTimes}`);
        if (deferDeadline) installParameters.push(`-DeferDeadline '${deferDeadline}'`);
        if (deferDays !== null) installParameters.push(`-DeferDays ${deferDays}`);
      } else if (showClosePrompt) {
        installParameters.push(forceCloseCountdown !== null
          ? `-ForceCloseProcessesCountdown ${forceCloseCountdown}`
          : `-CloseProcessesCountdown ${closeCountdown}`);
      } else {
        installParameters.push('-Silent');
      }
      if (blockExecution) installParameters.push('-BlockExecution');
    } else if (allowDefer) {
      installParameters.push('-AllowDefer', `-DeferTimes ${deferTimes}`);
      if (deferDeadline) installParameters.push(`-DeferDeadline '${deferDeadline}'`);
      if (deferDays !== null) installParameters.push(`-DeferDays ${deferDays}`);
    }
    if (interactiveInstall) addInteractiveOptions(installParameters);
    if (checkDiskSpace) {
      installParameters.push('-CheckDiskSpace');
      if (requiredDiskSpace !== null) {
        installParameters.push(`-RequiredDiskSpace ${requiredDiskSpace}`);
      }
    }

    const uninstallParameters: string[] = [];
    if (processes.length > 0) {
      uninstallParameters.push('-CloseProcesses $adtSession.AppProcessesToClose');
      if (showClosePrompt) {
        uninstallParameters.push(forceCloseCountdown !== null
          ? `-ForceCloseProcessesCountdown ${forceCloseCountdown}`
          : `-CloseProcessesCountdown ${closeCountdown}`);
        addInteractiveOptions(uninstallParameters);
      } else {
        uninstallParameters.push('-Silent');
      }
      if (blockExecution) uninstallParameters.push('-BlockExecution');
    }

    const welcomeBlock = (parameters: string[], phase: string): string =>
      parameters.length === 0 ? '' : `
    ## Apply the PSADT v4.1 application process lifecycle for ${phase}
    Show-ADTInstallationWelcome ${parameters.join(' ')}
`;

    return {
      sessionLiteral,
      installBlock: welcomeBlock(installParameters, 'installation'),
      uninstallBlock: welcomeBlock(uninstallParameters, 'uninstallation'),
    };
  }

  /**
   * Get the nested installer metadata from package_config
   * These fields live top-level on the cart item (not inside psadtConfig)
   * Returns null entries when absent, not a string, or empty/whitespace
   */
  private getNestedInstaller(job: PackagingJob): { type: string | null; path: string | null } {
    const packageConfig = job.package_config;
    if (typeof packageConfig !== 'object' || packageConfig === null) {
      return { type: null, path: null };
    }
    const config = packageConfig as Record<string, unknown>;
    const readString = (value: unknown): string | null =>
      typeof value === 'string' && value.trim() ? value.trim() : null;
    return {
      type: readString(config.nestedInstallerType),
      path: readString(config.nestedInstallerPath),
    };
  }

  private isPortableInstaller(job: PackagingJob): boolean {
    if (job.installer_type.toLowerCase() === 'portable') {
      return true;
    }
    const nested = this.getNestedInstaller(job);
    return job.installer_type.toLowerCase() === 'zip' && nested.type?.toLowerCase() === 'portable';
  }

  private normalizeNestedInstallerPath(nestedPath: string): string {
    const normalized = nestedPath.trim().replace(/\//g, '\\');
    const segments = normalized.split('\\');
    if (
      !normalized ||
      /[\x00-\x1f]/.test(normalized) ||
      normalized.includes(':') ||
      path.win32.isAbsolute(normalized) ||
      normalized.startsWith('\\') ||
      segments.includes('..')
    ) {
      throw new Error(`Unsafe nested installer path: ${nestedPath}`);
    }
    return normalized;
  }

  private getPortableFolderName(job: PackagingJob): string {
    const sanitized = job.display_name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().replace(/\.+$/, '');
    if (
      !sanitized ||
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(sanitized)
    ) {
      return this.sanitizeWingetId(job.winget_id);
    }
    return sanitized;
  }

  private getPortableInstallPathLine(job: PackagingJob): string {
    const folderName = this.getPortableFolderName(job).replace(/'/g, "''");
    return job.install_scope === 'user'
      ? `$installPath = Join-Path $env:LOCALAPPDATA 'Programs\\${folderName}'`
      : `$installPath = Join-Path $env:ProgramFiles '${folderName}'`;
  }

  /**
   * Get custom install/uninstall command override from package_config.psadtConfig
   * Returns null when the override is absent, not a string, or empty/whitespace
   */
  private getCommandOverride(job: PackagingJob, key: 'installCommand' | 'uninstallCommand'): string | null {
    const psadtConfig = this.getPsadtConfig(job);
    if (!psadtConfig) {
      return null;
    }
    const value = psadtConfig[key];
    if (typeof value !== 'string' || !value.trim()) {
      return null;
    }
    return value.trim();
  }

  /**
   * Generate PowerShell for additional post-install / post-uninstall commands
   * (issue #118). Each entry runs as its own Start-ADTProcess (cmd.exe /c) step,
   * in order, mirroring the custom-override pattern. Returns '' when none.
   * Kept in sync with .github/scripts/Create-PSADTPackage.ps1.
   */
  private getPostCommandsBlock(
    job: PackagingJob,
    key: 'postInstallCommands' | 'postUninstallCommands',
    source: 'Install-ADTDeployment' | 'Uninstall-ADTDeployment'
  ): string {
    const psadtConfig = this.getPsadtConfig(job);
    const raw = psadtConfig?.[key];
    if (!Array.isArray(raw)) {
      return '';
    }
    const commands = raw
      .filter((c): c is string => typeof c === 'string')
      // Collapse embedded newlines to spaces so a command can never break out of
      // the single-quoted string it is embedded in within the generated script.
      .map((c) => c.replace(/[\r\n]+/g, ' ').trim())
      .filter((c) => c.length > 0);
    if (commands.length === 0) {
      return '';
    }

    const phase = source === 'Install-ADTDeployment' ? 'post-install' : 'post-uninstall';
    const steps = commands
      .map((cmd) => {
        const escaped = cmd.replace(/'/g, "''");
        return `    Write-ADTLogEntry -Message 'Executing ${phase} command: ${escaped}' -Severity 'Info' -Source '${source}'
    Start-ADTProcess -FilePath "$env:SystemRoot\\System32\\cmd.exe" -ArgumentList '/c ${escaped}' -WorkingDirectory $adtSession.DirFiles -WindowStyle Hidden`;
      })
      .join('\n');

    return `
    ## Custom ${phase} commands (user-specified)
${steps}
`;
  }

  /**
   * Generate PowerShell code to remove any existing installation before installing
   * Opt-in via package_config.psadtConfig.removeExistingInstall; returns '' when disabled
   */
  private getPreInstallRemovalBlock(job: PackagingJob, escapedAppName: string): string {
    const psadtConfig = this.getPsadtConfig(job);
    if (psadtConfig?.removeExistingInstall !== true) {
      return '';
    }
    return `
    ## Remove any existing installation before installing
    try {
        $existingApps = Get-ADTApplication -Name '${escapedAppName}' -NameMatch 'Contains' -ErrorAction SilentlyContinue
        if ($existingApps) {
            Write-ADTLogEntry -Message "Found $($existingApps.Count) existing installation(s), removing before install" -Source 'Install-ADTDeployment'
            Uninstall-ADTApplication -InstalledApplication $existingApps -ErrorAction SilentlyContinue
        }
    }
    catch {
        Write-ADTLogEntry -Message "Pre-install removal failed: $($_.Exception.Message)" -Severity 'Warning' -Source 'Install-ADTDeployment'
    }
`;
  }

  private getRegistryUninstallIdentity(job: PackagingJob): {
    productCode: string;
    displayName: string;
  } | null {
    const exactProductMatch = job.uninstall_command?.match(
      /^REGISTRY_UNINSTALL_PRODUCT:(\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}):(.+)$/
    );
    if (exactProductMatch) {
      return {
        productCode: exactProductMatch[1],
        displayName: exactProductMatch[2].replace(/'/g, "''"),
      };
    }

    const displayNameMatch = job.uninstall_command?.match(/^REGISTRY_UNINSTALL:(.+)$/);
    if (displayNameMatch) {
      return {
        productCode: '',
        displayName: displayNameMatch[1].replace(/'/g, "''"),
      };
    }

    return null;
  }

  /**
   * Snapshot ARP before install so the exact entry created or version-updated by
   * an EXE-family installer can be persisted and reused during uninstall.
   */
  private getRegistryInstallSnapshotBlock(job: PackagingJob, escapedAppName: string): string {
    const identity = this.getRegistryUninstallIdentity(job);
    if (!identity) {
      return '';
    }

    return `
    # Snapshot uninstall entries before install. Manifest identity is a preference,
    # while the observed registry delta remains authoritative when metadata is stale.
    $preInstallApplications = @(Get-ADTApplication -ErrorAction SilentlyContinue)
    $configuredUninstallProductCode = '${identity.productCode}'
    $configuredUninstallDisplayName = '${identity.displayName || escapedAppName}'
    $capturedUninstallKey = $null
    $capturedUninstallName = $null
`;
  }

  /**
   * Generate PowerShell code to verify the application appears in Add/Remove
   * Programs after install, failing the deployment before the detection
   * marker is written when it does not
   * Opt-in via package_config.psadtConfig.verifyInstall; returns '' when disabled
   */
  private getPostInstallVerificationBlock(job: PackagingJob, escapedAppName: string): string {
    const identity = this.getRegistryUninstallIdentity(job);
    if (identity) {
      return `
    ## Capture and verify the exact uninstall identity observed for this installation.
    $selectedApplications = @()
    $changedApplications = @()
    $configuredUninstallComparableName = (($configuredUninstallDisplayName -replace '(?i)(?<![A-Za-z0-9])(x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)(?![A-Za-z0-9])', '' -replace '\(\s*\)', '' -replace '\(\s+', '(' -replace '\s+\)', ')' -replace '\s{2,}', ' ')).Trim()
    foreach ($verificationAttempt in 1..30) {
        $postInstallApplications = @(Get-ADTApplication -ErrorAction SilentlyContinue)
        $changedApplications = @($postInstallApplications | Where-Object {
            $candidateApplication = $_
            $previousApplication = $preInstallApplications | Where-Object { $_.PSPath -eq $candidateApplication.PSPath } | Select-Object -First 1
            (-not $previousApplication) -or ($previousApplication.DisplayVersion -ne $candidateApplication.DisplayVersion)
        })
        $selectedApplications = @()
        if ($configuredUninstallProductCode) {
            $selectedApplications = @($changedApplications | Where-Object { [string]$_.PSChildName -eq $configuredUninstallProductCode })
        }
        if ($selectedApplications.Count -eq 0) {
            $selectedApplications = @($changedApplications | Where-Object { [string]$_.DisplayName -eq $configuredUninstallDisplayName })
        }
        if ($selectedApplications.Count -eq 0 -and $configuredUninstallComparableName) {
            $architectureAgnosticMatches = @($changedApplications | Where-Object {
                $candidateDisplayName = [string]$_.DisplayName
                $candidateComparableName = (($candidateDisplayName -replace '(?i)(?<![A-Za-z0-9])(x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)(?![A-Za-z0-9])', '' -replace '\(\s*\)', '' -replace '\(\s+', '(' -replace '\s+\)', ')' -replace '\s{2,}', ' ')).Trim()
                $candidateComparableName -eq $configuredUninstallComparableName
            })
            if ($architectureAgnosticMatches.Count -eq 1) { $selectedApplications = $architectureAgnosticMatches }
        }
        if ($selectedApplications.Count -eq 0) {
            $bundleCandidates = @($changedApplications | Where-Object {
                -not $_.WindowsInstaller -and [string]$_.DisplayName -like "$configuredUninstallDisplayName*"
            })
            if ($bundleCandidates.Count -eq 1) { $selectedApplications = $bundleCandidates }
        }
        if ($selectedApplications.Count -gt 1 -and '${job.installer_type.toLowerCase()}' -eq 'burn') {
            # A Burn bundle and its chained MSI can intentionally share the same ARP display name.
            # Narrow only the already identity-matched set to its single non-MSI bundle entry.
            $bundleCandidates = @($selectedApplications | Where-Object {
                $systemComponentProperty = $_.PSObject.Properties['SystemComponent']
                $isVisibleApplication = -not $systemComponentProperty -or -not [bool]$systemComponentProperty.Value
                $isVisibleApplication -and -not $_.WindowsInstaller
            })
            if ($bundleCandidates.Count -eq 1) { $selectedApplications = $bundleCandidates }
        }
        if ($selectedApplications.Count -eq 0 -and '${job.installer_type.toLowerCase()}' -eq 'burn') {
            $bundleCandidates = @($changedApplications | Where-Object { -not $_.WindowsInstaller })
            if ($bundleCandidates.Count -eq 1) { $selectedApplications = $bundleCandidates }
        }
        if ($selectedApplications.Count -eq 0 -and $configuredUninstallProductCode) {
            $configuredMatches = @($postInstallApplications | Where-Object { [string]$_.PSChildName -eq $configuredUninstallProductCode })
            if ($configuredMatches.Count -eq 1) { $selectedApplications = $configuredMatches }
        }
        if ($selectedApplications.Count -eq 0 -and $changedApplications.Count -eq 1) {
            $selectedApplications = @($changedApplications[0])
        }
        if ($selectedApplications.Count -eq 1) { break }
        if ($verificationAttempt -lt 30) { Start-Sleep -Seconds 2 }
    }
    if ($selectedApplications.Count -ne 1) {
        throw "Post-install verification failed: the installer changed $($changedApplications.Count) uninstall entries and $($selectedApplications.Count) could be selected unambiguously."
    }
    $capturedUninstallKey = [string]$selectedApplications[0].PSChildName
    $capturedUninstallName = [string]$selectedApplications[0].DisplayName
    Write-ADTLogEntry -Message "Captured and verified vendor uninstall entry [$capturedUninstallName] ($capturedUninstallKey)." -Source 'Install-ADTDeployment'
`;
    }
    const psadtConfig = this.getPsadtConfig(job);
    if (psadtConfig?.verifyInstall !== true) {
      return '';
    }
    return `
    ## Verify the application actually installed before writing the detection marker
    $verifyApps = Get-ADTApplication -Name '${escapedAppName}' -NameMatch 'Contains' -ErrorAction SilentlyContinue
    if (-not $verifyApps) {
        throw "Post-install verification failed: '${escapedAppName}' was not found in the installed applications list. The installer exited without error but the application does not appear to be installed."
    }
    Write-ADTLogEntry -Message "Post-install verification passed" -Source 'Install-ADTDeployment'
`;
  }

  /**
   * Get install command based on installer type (PSADT v4 cmdlets)
   * A custom install command override from psadtConfig takes precedence
   */
  private getInstallCommand(job: PackagingJob, fileName: string, silentSwitches: string): string {
    const installOverride = this.getCommandOverride(job, 'installCommand');
    if (installOverride) {
      const overrideEscaped = installOverride.replace(/'/g, "''");
      return `Start-ADTProcess -FilePath "$env:SystemRoot\\System32\\cmd.exe" -ArgumentList '/c ${overrideEscaped}' -WorkingDirectory $adtSession.DirFiles -WindowStyle Hidden`;
    }

    const installerType = job.installer_type;
    const ext = path.extname(fileName).toLowerCase();

    // Zip archives carry a nested installer - never execute the .zip itself
    // (a zip-declared installer that is actually an .exe or .msi still runs natively)
    if (ext === '.zip' || (installerType === 'zip' && ext !== '.exe' && ext !== '.msi')) {
      return this.getZipInstallCommand(job, fileName, silentSwitches);
    }

    if (ext === '.msi' || installerType === 'msi' || installerType === 'wix') {
      const msiProperties = this.extractMsiProperties(silentSwitches);
      if (msiProperties) {
        return `Start-ADTMsiProcess -Action 'Install' -FilePath '${fileName}' -AdditionalArgumentList '${msiProperties}'`;
      }
      return `Start-ADTMsiProcess -Action 'Install' -FilePath '${fileName}'`;
    }

    if (
      ['.msix', '.msixbundle', '.appx', '.appxbundle'].includes(ext) ||
      installerType === 'msix' ||
      installerType === 'appx'
    ) {
      return this.getMsixInstallCommand(job, fileName);
    }

    if (installerType === 'portable') {
      const fileNameEscaped = fileName.replace(/'/g, "''");
      return `${this.getPortableInstallPathLine(job)}
    $sourcePath = Join-Path $adtSession.DirFiles '${fileNameEscaped}'
    $null = New-Item -Path $installPath -ItemType Directory -Force
    $targetPath = Join-Path $installPath '${fileNameEscaped}'
    Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force
    Write-ADTLogEntry -Message "Portable app installed to: $installPath" -Severity 'Success' -Source 'Install-ADTDeployment'`;
    }

    if (installerType === 'inno') {
      const innoSwitches = /(^|\s)\/SP-(\s|$)/i.test(silentSwitches)
        ? silentSwitches
        : `${silentSwitches} /SP-`.trim();
      const escapedSwitches = innoSwitches.replace(/'/g, "''");
      return `$innoLogPath = Join-Path $env:TEMP 'IntuneGet-Inno-Install.log'
    $innoArguments = '${escapedSwitches} /LOG="{0}"' -f $innoLogPath
    Write-ADTLogEntry -Message "Inno Setup verbose logging enabled" -Severity 'Info' -Source 'Install-ADTDeployment'
    Start-ADTProcess -FilePath "$($adtSession.DirFiles)\\${fileName}" -ArgumentList $innoArguments -WindowStyle Hidden -WaitForMsiExec`;
    }

    return `Start-ADTProcess -FilePath "$($adtSession.DirFiles)\\${fileName}" -ArgumentList '${silentSwitches}' -WindowStyle Hidden -WaitForMsiExec`;
  }

  /**
   * Strip msiexec action and quiet flags from silent switches -
   * Start-ADTMsiProcess supplies those itself
   */
  private extractMsiProperties(silentSwitches: string): string {
    return silentSwitches
      .split(/\s+/)
      .filter((token) => token && !/^\/(q[nbrfu]?|quiet|norestart|i|x)$/i.test(token))
      .join(' ')
      .trim();
  }

  private getMsixPackageName(job: PackagingJob): string | null {
    const match = job.uninstall_command?.match(/^MSIX_UNINSTALL:([A-Za-z0-9.-]+)$/);
    return match?.[1] || null;
  }

  private getMsixInstallCommand(job: PackagingJob, fileName: string): string {
    const packageName = this.getMsixPackageName(job);
    if (!packageName) {
      return 'throw "The MSIX/APPX package identity is missing or unsafe; refusing an ambiguous deployment."';
    }

    const escapedFileName = fileName.replace(/'/g, "''");
    const escapedVersion = job.version.replace(/'/g, "''");
    const common = `$msixPath = Join-Path $adtSession.DirFiles '${escapedFileName}'
    $packageName = '${packageName}'
    $targetVersion = '${escapedVersion}'`;

    if (job.install_scope === 'user') {
      return `${common}
    $existingPackage = Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1
    $shouldInstallPackage = $true
    if ($existingPackage) {
        try { $shouldInstallPackage = [version]$existingPackage.Version -lt [version]$targetVersion }
        catch { $shouldInstallPackage = [string]$existingPackage.Version -ne $targetVersion }
    }
    if ($shouldInstallPackage) {
        Add-AppxPackage -Path $msixPath -ForceApplicationShutdown -ErrorAction Stop
    } else {
        Write-ADTLogEntry -Message "MSIX/APPX package [$packageName] version [$($existingPackage.Version)] already satisfies target [$targetVersion]." -Severity 'Success' -Source 'Install-ADTDeployment'
    }`;
    }

    return `${common}
    $existingPackage = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq $packageName } | Sort-Object Version -Descending | Select-Object -First 1
    $shouldInstallPackage = $true
    if ($existingPackage) {
        try { $shouldInstallPackage = [version]$existingPackage.Version -lt [version]$targetVersion }
        catch { $shouldInstallPackage = [string]$existingPackage.Version -ne $targetVersion }
    }
    if ($shouldInstallPackage) {
        Add-AppxProvisionedPackage -Online -PackagePath $msixPath -SkipLicense -ErrorAction Stop
    } else {
        Write-ADTLogEntry -Message "Provisioned MSIX/APPX package [$packageName] version [$($existingPackage.Version)] already satisfies target [$targetVersion]." -Severity 'Success' -Source 'Install-ADTDeployment'
    }`;
  }

  /**
   * Get install command for zip installers (PSADT v4 cmdlets)
   * Extracts the archive to a unique temp directory and runs the nested
   * installer declared by package_config.nestedInstallerType/nestedInstallerPath
   * Emits an install-time error when no nested installer is declared
   */
  private getZipInstallCommand(job: PackagingJob, fileName: string, silentSwitches: string): string {
    const nested = this.getNestedInstaller(job);
    if (!nested.path) {
      return 'throw "Zip package does not declare a nested installer; cannot install"';
    }

    const normalizedNestedPath = this.normalizeNestedInstallerPath(nested.path);
    const nestedPathEscaped = normalizedNestedPath.replace(/'/g, "''");
    const nestedType = (nested.type ?? '').toLowerCase();

    if (nestedType === 'portable') {
      return this.getPortableZipInstallCommand(job, fileName, nestedPathEscaped);
    }

    let executeLine: string;
    if (nestedType === 'msi' || nestedType === 'wix') {
      const msiProperties = this.extractMsiProperties(silentSwitches);
      executeLine = msiProperties
        ? `Start-ADTMsiProcess -Action 'Install' -FilePath $nestedInstallerPath -AdditionalArgumentList '${msiProperties}'`
        : `Start-ADTMsiProcess -Action 'Install' -FilePath $nestedInstallerPath`;
    } else {
      executeLine = `Start-ADTProcess -FilePath $nestedInstallerPath -ArgumentList '${silentSwitches}' -WindowStyle Hidden -WaitForMsiExec`;
    }

    return `$zipExtractDir = [System.IO.Path]::Combine($env:TEMP, "IntuneGet_Zip_" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
    $null = New-Item -Path $zipExtractDir -ItemType Directory -Force
    try {
        Expand-Archive -Path "$($adtSession.DirFiles)\\${fileName}" -DestinationPath $zipExtractDir -Force
        $nestedInstallerPath = Join-Path $zipExtractDir '${nestedPathEscaped}'
        if (-not (Test-Path -LiteralPath $nestedInstallerPath)) {
            throw "Nested installer not found in archive: ${nestedPathEscaped}"
        }
        Write-ADTLogEntry -Message "Running nested installer: $nestedInstallerPath" -Severity 'Info' -Source 'Install-ADTDeployment'
        ${executeLine}
    }
    finally {
        if (Test-Path -LiteralPath $zipExtractDir) {
            Remove-Item -Path $zipExtractDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }`;
  }

  private getPortableZipInstallCommand(
    job: PackagingJob,
    fileName: string,
    nestedPathEscaped: string
  ): string {
    const fileNameEscaped = fileName.replace(/'/g, "''");
    return `${this.getPortableInstallPathLine(job)}
    $portableStageDir = [System.IO.Path]::Combine($env:TEMP, "IntuneGet_Portable_" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
    $replacementStarted = $false
    try {
        $null = New-Item -Path $portableStageDir -ItemType Directory -Force
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $stageRoot = [System.IO.Path]::GetFullPath($portableStageDir)
        $stageRootPrefix = $stageRoot.TrimEnd([char[]]@('\\', '/')) + [System.IO.Path]::DirectorySeparatorChar
        $archivePath = Join-Path $adtSession.DirFiles '${fileNameEscaped}'
        $archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
        try {
            foreach ($entry in $archive.Entries) {
                $entryRelativePath = $entry.FullName.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
                if ([string]::IsNullOrWhiteSpace($entryRelativePath)) { continue }
                if ($entryRelativePath.Contains(':')) { throw "Archive entry contains an unsupported path: $($entry.FullName)" }
                $targetPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($stageRoot, $entryRelativePath))
                if ($targetPath -ne $stageRoot -and -not $targetPath.StartsWith($stageRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                    throw "Archive entry escapes the portable staging directory: $($entry.FullName)"
                }
                if ([string]::IsNullOrEmpty($entry.Name)) {
                    $null = New-Item -Path $targetPath -ItemType Directory -Force
                    continue
                }
                $targetDirectory = [System.IO.Path]::GetDirectoryName($targetPath)
                if ($targetDirectory) { $null = New-Item -Path $targetDirectory -ItemType Directory -Force }
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)
            }
        }
        finally {
            if ($archive) { $archive.Dispose() }
        }
        $declaredNestedPath = [System.IO.Path]::GetFullPath((Join-Path $stageRoot '${nestedPathEscaped}'))
        if (-not $declaredNestedPath.StartsWith($stageRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Nested installer path escapes the portable staging directory"
        }
        if (-not (Test-Path -LiteralPath $declaredNestedPath -PathType Leaf)) {
            throw "Nested installer not found in archive: ${nestedPathEscaped}"
        }
        $installParent = [System.IO.Path]::GetDirectoryName($installPath)
        if ($installParent) { $null = New-Item -Path $installParent -ItemType Directory -Force }
        $replacementStarted = $true
        if (Test-Path -LiteralPath $installPath) { Remove-Item -LiteralPath $installPath -Recurse -Force -ErrorAction Stop }
        Move-Item -LiteralPath $portableStageDir -Destination $installPath -Force
        Write-ADTLogEntry -Message "Portable archive installed to: $installPath" -Severity 'Success' -Source 'Install-ADTDeployment'
    }
    catch {
        if ($replacementStarted -and (Test-Path -LiteralPath $installPath)) {
            Remove-Item -LiteralPath $installPath -Recurse -Force -ErrorAction SilentlyContinue
        }
        Write-ADTLogEntry -Message "Failed to install portable archive: $_" -Severity 'Error' -Source 'Install-ADTDeployment'
        throw
    }
    finally {
        if (Test-Path -LiteralPath $portableStageDir) {
            Remove-Item -LiteralPath $portableStageDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }`;
  }

  /**
   * Get uninstall command (PSADT v4 cmdlets)
   * A custom uninstall command override from psadtConfig takes precedence
   */
  private getUninstallCommand(job: PackagingJob, installerFileName: string): string {
    const uninstallOverride = this.getCommandOverride(job, 'uninstallCommand');
    if (uninstallOverride) {
      const overrideEscaped = uninstallOverride.replace(/'/g, "''");
      return `Start-ADTProcess -FilePath "$env:SystemRoot\\System32\\cmd.exe" -ArgumentList '/c ${overrideEscaped}' -WorkingDirectory $adtSession.DirFiles -WindowStyle Hidden`;
    }

    if (this.isPortableInstaller(job)) {
      return `${this.getPortableInstallPathLine(job)}
    Write-ADTLogEntry -Message "Removing portable app folder: $installPath" -Severity 'Info' -Source 'Uninstall-ADTDeployment'
    if (Test-Path -LiteralPath $installPath) {
        Remove-Item -LiteralPath $installPath -Recurse -Force -ErrorAction Stop
    }`;
    }

    if (!job.uninstall_command) {
      return "Write-ADTLogEntry -Message 'No uninstall command specified' -Severity 'Warning' -Source 'Uninstall-ADTDeployment'";
    }

    if (/^MSIX_UNINSTALL:/.test(job.uninstall_command)) {
      const packageName = this.getMsixPackageName(job);
      if (!packageName) {
        return 'throw "The MSIX/APPX package identity is missing or unsafe; refusing an ambiguous removal."';
      }
      if (job.install_scope === 'user') {
        return `$packages = Get-AppxPackage -Name '${packageName}' -ErrorAction SilentlyContinue
    foreach ($pkg in @($packages)) {
        Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
    }`;
      }
      return `$provPackages = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq '${packageName}' }
    foreach ($provPackage in @($provPackages)) {
        Remove-AppxProvisionedPackage -Online -PackageName $provPackage.PackageName -ErrorAction Stop | Out-Null
    }
    $packages = Get-AppxPackage -Name '${packageName}' -AllUsers -ErrorAction SilentlyContinue
    foreach ($pkg in @($packages)) {
        Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers -ErrorAction Stop
    }`;
    }

    const registryIdentity = this.getRegistryUninstallIdentity(job);
    if (registryIdentity) {
      const installerType = job.installer_type.toLowerCase();
      const fileNameEscaped = installerFileName.replace(/'/g, "''");
      const silentSwitches = this.extractSilentSwitches(
        job.install_command,
        job.installer_type
      ).replace(/'/g, "''");
      const hiveLongName = job.install_scope === 'user' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';
      const markerProviderPath = `Registry::${hiveLongName}\\${this.getRegistryMarkerPath(job)}\\${this.sanitizeWingetId(job.winget_id)}`;
      const selectionBlock = `$configuredProductCode = '${registryIdentity.productCode}'
    $configuredDisplayName = '${registryIdentity.displayName}'
    $markerProviderPath = '${markerProviderPath}'
    $capturedUninstallKey = (Get-ItemProperty -LiteralPath $markerProviderPath -ErrorAction SilentlyContinue).UninstallRegistryKey
    $installedApps = if ($capturedUninstallKey) {
        @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $capturedUninstallKey })
    } elseif ($configuredProductCode) {
        @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $configuredProductCode })
    } else {
        @(Get-ADTApplication -Name $configuredDisplayName -NameMatch 'Exact')
    }
    if ($installedApps.Count -eq 0 -and -not $capturedUninstallKey) {
        $installedApps = @(Get-ADTApplication -Name $configuredDisplayName -NameMatch 'Exact')
    }
    if ($installedApps.Count -ne 1) {
        throw "Could not find one exact vendor uninstall entry. Found $($installedApps.Count); refusing broad removal."
    }
    $registeredApplication = $installedApps[0]
    $registeredUninstallRegistryKey = [string]$registeredApplication.PSChildName`;

      if (installerType === 'burn') {
        return `${selectionBlock}
    $registeredUninstallProperty = if (-not [string]::IsNullOrWhiteSpace($registeredApplication.QuietUninstallStringFilePath)) {
        'QuietUninstallString'
    } elseif (-not [string]::IsNullOrWhiteSpace($registeredApplication.UninstallStringFilePath)) {
        'UninstallString'
    } else {
        throw "The captured Burn bundle does not provide an uninstall command."
    }
    [string[]]$registeredUninstallArguments = @($registeredApplication."$($registeredUninstallProperty)ArgumentList" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    if ($registeredUninstallArguments.Count -eq 0) {
        $registeredUninstallArguments = @('/uninstall', '/quiet', '/norestart')
    }
    $bundledUninstaller = Join-Path $adtSession.DirFiles '${fileNameEscaped}'
    if (-not (Test-Path -LiteralPath $bundledUninstaller -PathType Leaf)) {
        throw "The packaged Burn uninstaller was not found: $bundledUninstaller"
    }
    Write-ADTLogEntry -Message "Using packaged Burn bundle because the registered vendor cache may be disposable." -Source 'Uninstall-ADTDeployment'
    $uninstallProcessParameters = @{
        FilePath = $bundledUninstaller
        ArgumentList = $registeredUninstallArguments
        WorkingDirectory = $adtSession.DirFiles
        WindowStyle = 'Hidden'
        WaitForMsiExec = $true
        NoWait = $true
        PassThru = $true
    }
    $uninstallDeadline = [DateTime]::UtcNow.AddMinutes(5)
    $uninstallHandle = Start-ADTProcess @uninstallProcessParameters
    $uninstallProcessExitLogged = $false
    $nextUninstallProgressLog = [DateTime]::UtcNow
    do {
        $remainingApplications = @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $registeredUninstallRegistryKey })
        if ($remainingApplications.Count -eq 0) { break }
        $uninstallProcessExited = $false
        try { $uninstallProcessExited = $uninstallHandle.Task.IsCompleted } catch { }
        if ($uninstallProcessExited -and -not $uninstallProcessExitLogged) {
            $uninstallProcessExitLogged = $true
            Write-ADTLogEntry -Message "The Burn uninstall parent process exited; continuing to wait for exact registration [$registeredUninstallRegistryKey] because a child process may still be working." -Severity 'Warning' -Source 'Uninstall-ADTDeployment'
        }
        if ([DateTime]::UtcNow -ge $uninstallDeadline) { break }
        if ([DateTime]::UtcNow -ge $nextUninstallProgressLog) {
            Write-ADTLogEntry -Message "Waiting for Burn uninstall registration [$registeredUninstallRegistryKey] to be removed." -Source 'Uninstall-ADTDeployment'
            $nextUninstallProgressLog = [DateTime]::UtcNow.AddSeconds(15)
        }
        Start-Sleep -Seconds 5
    } while ($true)
    $uninstallProcessExitCode = $null
    try {
        if ($uninstallHandle.Task.IsCompleted) {
            $uninstallProcessExitCode = $uninstallHandle.Task.GetAwaiter().GetResult().ExitCode
        }
    } catch {
        Write-ADTLogEntry -Message "The Burn uninstall task completed without a readable exit code: $_" -Severity 'Warning' -Source 'Uninstall-ADTDeployment'
    }
    if ($uninstallProcessExitCode -in @(1641, 3010)) {
        $script:UninstallRebootExitCode = 3010
    } elseif ($null -ne $uninstallProcessExitCode -and $uninstallProcessExitCode -notin @(0, 1605, 1614)) {
        Write-ADTLogEntry -Message "The Burn uninstall parent process exited with code [$uninstallProcessExitCode]; exact removal verification remains authoritative." -Severity 'Warning' -Source 'Uninstall-ADTDeployment'
    }
    $remainingApplications = @()
    foreach ($verificationAttempt in 1..5) {
        $remainingApplications = @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $registeredUninstallRegistryKey })
        if ($remainingApplications.Count -eq 0) { break }
        if ($verificationAttempt -lt 5) { Start-Sleep -Seconds 2 }
    }
    if ($remainingApplications.Count -gt 0) {
        throw "The Burn uninstall command did not remove registration [$registeredUninstallRegistryKey] before the completion deadline."
    }`;
      }

      return `${selectionBlock}
    $capturedMsiProductCode = if ($registeredApplication.WindowsInstaller -and $registeredApplication.ProductCode) {
        $registeredApplication.ProductCode
    } elseif ($registeredApplication.WindowsInstaller -and [string]$registeredApplication.PSChildName -match '^\\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\\}$') {
        [string]$registeredApplication.PSChildName
    } else {
        $null
    }
    if ($capturedMsiProductCode) {
        Start-ADTMsiProcess -Action 'Uninstall' -ProductCode $capturedMsiProductCode -SuccessExitCodes @(0, 1605, 1614) -RebootExitCodes @(1641, 3010)
    } else {
        $hasQuietUninstall = -not [string]::IsNullOrWhiteSpace($registeredApplication.QuietUninstallStringFilePath)
        $registeredUninstallProperty = if ($hasQuietUninstall) { 'QuietUninstallString' } else { 'UninstallString' }
        $registeredUninstallFile = [string]$registeredApplication."$($registeredUninstallProperty)FilePath"
        [string[]]$registeredUninstallArguments = @($registeredApplication."$($registeredUninstallProperty)ArgumentList" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
        [string[]]$additionalUninstallArguments = @()
        $isVivaldiUninstall = $false
        $isAdobeCreativeCloudUninstall = (Split-Path -Leaf $registeredUninstallFile) -ieq 'Creative Cloud Uninstaller.exe'
        if (-not $hasQuietUninstall) {
            $registeredArgumentText = ($registeredUninstallArguments -join ' ').Trim()
            if ((Split-Path -Leaf $registeredUninstallFile) -ieq 'setup.exe' -and $registeredArgumentText -match '(?i)(^|\\s)--vivaldi(\\s|$)') {
                $isVivaldiUninstall = $true
            } elseif ((Split-Path -Leaf $registeredUninstallFile) -ine 'msiexec.exe' -and '${installerType}' -eq 'inno') {
                foreach ($argument in @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-')) {
                    if ($registeredArgumentText -notmatch "(?i)(^|\\s)$([regex]::Escape($argument))(\\s|$)") {
                        $additionalUninstallArguments += $argument
                    }
                }
            } elseif ((Split-Path -Leaf $registeredUninstallFile) -ine 'msiexec.exe' -and '${installerType}' -eq 'nullsoft' -and $registeredArgumentText -notmatch '(?i)(^|\\s)/S(\\s|$)') {
                $additionalUninstallArguments += '/S'
            }
            if ((Split-Path -Leaf $registeredUninstallFile) -ine 'msiexec.exe' -and $registeredArgumentText -match '(?i)(^|\\s)(/uninstall|-uninstall|--uninstall|/x)(\\s|$|\\{)') {
                $safeManifestUninstallArguments = @('${silentSwitches}' -split '\\s+' | Where-Object { $_ -match '^(?i:/q[nbrfu]?|/quiet|/silent|/verysilent|/norestart|/s|--quiet|--silent)$' })
                foreach ($argument in $safeManifestUninstallArguments) {
                    if ($registeredArgumentText -notmatch "(?i)(^|\\s)$([regex]::Escape($argument))(\\s|$)") {
                        $additionalUninstallArguments += $argument
                    }
                }
            }
        }
        if ($isVivaldiUninstall) {
            $registeredUninstallFile = [string]$registeredApplication.UninstallStringFilePath
            $registeredUninstallArguments = @('--uninstall', '--vivaldi', '--force-uninstall')
        } elseif ($isAdobeCreativeCloudUninstall) {
            # Adobe's desktop client registers an interactive uninstaller. Use its unattended
            # desktop-client command and never forward the install-only --mode=stub value.
            $registeredUninstallArguments = @('-u', '--silent')
        }
        $registeredUninstallLeaf = Split-Path -Leaf $registeredUninstallFile
        $isRegisteredMsiExec = $registeredUninstallLeaf -in @('msiexec', 'msiexec.exe')
        if ($isRegisteredMsiExec) {
            $registeredMsiProductCode = if ($registeredUninstallRegistryKey -match '(?i)^\\{[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\\}$') {
                $registeredUninstallRegistryKey
            } elseif (($registeredUninstallArguments -join ' ') -match '(?i)(?:^|\\s)[/-](?:x|i)\\s*(\\{[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\\})(?=\\s|$)') {
                $Matches[1]
            } else {
                throw "The registered msiexec uninstall command does not expose an exact product code; refusing to reuse install or repair arguments."
            }
            $registeredUninstallFile = Join-Path $env:SystemRoot 'System32\\msiexec.exe'
            $registeredUninstallArguments = @('/x', $registeredMsiProductCode, '/qn', '/norestart')
        } else {
            if (-not (Test-Path -LiteralPath $registeredUninstallFile -PathType Leaf)) {
                throw "The registered vendor uninstaller was not found: $registeredUninstallFile"
            }
            if (-not $hasQuietUninstall -and -not $isVivaldiUninstall -and -not $isAdobeCreativeCloudUninstall) {
                $registeredUninstallArguments += $additionalUninstallArguments
            }
        }
        $registeredUninstallWorkingDirectory = Split-Path -Parent $registeredUninstallFile
        $uninstallProcessParameters = @{
            FilePath = $registeredUninstallFile
            WorkingDirectory = $registeredUninstallWorkingDirectory
            WindowStyle = 'Hidden'
            NoWait = $true
            PassThru = $true
        }
        if ($registeredUninstallArguments.Count -gt 0) {
            $uninstallProcessParameters.ArgumentList = $registeredUninstallArguments
        }
        $uninstallDeadline = [DateTime]::UtcNow.AddMinutes(5)
        $uninstallHandle = Start-ADTProcess @uninstallProcessParameters
        $uninstallProcessExitLogged = $false
        $nextUninstallProgressLog = [DateTime]::UtcNow
        do {
            $remainingApplications = @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $registeredUninstallRegistryKey })
            if ($remainingApplications.Count -eq 0) { break }
            $uninstallProcessExited = $false
            try { $uninstallProcessExited = $uninstallHandle.Task.IsCompleted } catch { }
            if ($uninstallProcessExited -and -not $uninstallProcessExitLogged) {
                $uninstallProcessExitLogged = $true
                Write-ADTLogEntry -Message "The vendor uninstall parent process exited; continuing to wait for exact registration [$registeredUninstallRegistryKey] because a child process may still be working." -Severity 'Warning' -Source 'Uninstall-ADTDeployment'
            }
            if ([DateTime]::UtcNow -ge $uninstallDeadline) { break }
            if ([DateTime]::UtcNow -ge $nextUninstallProgressLog) {
                Write-ADTLogEntry -Message "Waiting for vendor uninstall registration [$registeredUninstallRegistryKey] to be removed." -Source 'Uninstall-ADTDeployment'
                $nextUninstallProgressLog = [DateTime]::UtcNow.AddSeconds(15)
            }
            Start-Sleep -Seconds 5
        } while ($true)
        $uninstallProcessExitCode = $null
        try {
            if ($uninstallHandle.Task.IsCompleted) {
                $uninstallProcessExitCode = $uninstallHandle.Task.GetAwaiter().GetResult().ExitCode
            }
        } catch {
            Write-ADTLogEntry -Message "The vendor uninstall task completed without a readable exit code: $_" -Severity 'Warning' -Source 'Uninstall-ADTDeployment'
        }
        if ($uninstallProcessExitCode -in @(1641, 3010)) {
            $script:UninstallRebootExitCode = 3010
        } elseif ($null -ne $uninstallProcessExitCode -and $uninstallProcessExitCode -notin @(0, 1605, 1614)) {
            Write-ADTLogEntry -Message "The vendor uninstall parent process exited with code [$uninstallProcessExitCode]; exact removal verification remains authoritative." -Severity 'Warning' -Source 'Uninstall-ADTDeployment'
        }
    }
    $remainingApplications = @()
    foreach ($verificationAttempt in 1..5) {
        $remainingApplications = @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $registeredUninstallRegistryKey })
        if ($remainingApplications.Count -eq 0) { break }
        if ($verificationAttempt -lt 5) { Start-Sleep -Seconds 2 }
    }
    if ($remainingApplications.Count -gt 0) {
        throw "The vendor uninstall command did not remove registration [$registeredUninstallRegistryKey] before the completion deadline."
    }`;
    }

    if (/^REGISTRY_UNINSTALL_PRODUCT:/.test(job.uninstall_command)) {
      return 'throw "The exact vendor uninstall identity is malformed; refusing to interpret any embedded GUID as an MSI product code."';
    }

    // MSI uninstall: use the product code with Start-ADTMsiProcess
    const productCodeMatch = job.uninstall_command.match(
      /\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}/
    );
    if (productCodeMatch) {
      return `Start-ADTMsiProcess -Action 'Uninstall' -ProductCode '${productCodeMatch[0]}' -SuccessExitCodes @(0, 1605, 1614, 3010, 1641)`;
    }

    const uninstallCmd = job.uninstall_command.replace(/'/g, "''");
    return `Start-ADTProcess -FilePath "$env:SystemRoot\\System32\\cmd.exe" -ArgumentList '/c ${uninstallCmd}' -WindowStyle Hidden`;
  }

  /**
   * Sanitize wingetId for registry key name
   * Replaces . and - with _ to match detection-rules.ts logic
   */
  private sanitizeWingetId(wingetId: string): string {
    return wingetId.replace(/[\.\-]/g, '_');
  }

  /**
   * Get registry hive based on install scope
   */
  private getRegistryHive(scope: string): string {
    return scope === 'user' ? 'HKCU' : 'HKLM';
  }

  /**
   * Normalize a custom registry marker root into a safe subpath under the
   * hive. Mirrors normalizeMarkerPath in lib/registry-marker.ts (the packager
   * cannot import from lib/) - keep both in sync.
   */
  private normalizeMarkerPath(input: unknown): string {
    const DEFAULT_MARKER_PATH = 'SOFTWARE\\IntuneGet\\Apps';
    if (typeof input !== 'string') {
      return DEFAULT_MARKER_PATH;
    }

    let markerPath = input.trim().replace(/\//g, '\\').replace(/\\+/g, '\\');
    markerPath = markerPath.replace(/^\\+|\\+$/g, '');
    markerPath = markerPath.replace(/^(HKLM|HKCU|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER):?(\\|$)/i, '');
    markerPath = markerPath.replace(/[*?"'<>|\x00-\x1f]/g, '');

    const segments = markerPath
      .split('\\')
      .map((segment) => segment.trim())
      .filter(Boolean);

    return segments.length > 0 ? segments.join('\\') : DEFAULT_MARKER_PATH;
  }

  /**
   * Get the registry marker root for a job: custom value from
   * package_config.psadtConfig.registryMarkerPath, or the IntuneGet default
   */
  private getRegistryMarkerPath(job: PackagingJob): string {
    return this.normalizeMarkerPath(this.getPsadtConfig(job)?.registryMarkerPath);
  }

  /**
   * Generate PowerShell code to create IntuneGet registry marker
   * This marker is used by Intune detection rules to verify installation
   */
  private getRegistryMarkerCreation(job: PackagingJob): string {
    const sanitizedId = this.sanitizeWingetId(job.winget_id);
    const hive = this.getRegistryHive(job.install_scope);
    const markerPath = this.getRegistryMarkerPath(job);
    const regPath = `${hive}\\${markerPath}\\${sanitizedId}`;
    const capturedIdentityValues = this.getRegistryUninstallIdentity(job)
      ? `
        if (-not [string]::IsNullOrWhiteSpace($capturedUninstallKey)) {
            Set-ADTRegistryKey -LiteralPath $regPath -Name 'UninstallRegistryKey' -Value $capturedUninstallKey -Type String
            Set-ADTRegistryKey -LiteralPath $regPath -Name 'UninstallDisplayName' -Value $capturedUninstallName -Type String
        }`
      : '';

    return `try {
        $regPath = '${regPath}'
        Set-ADTRegistryKey -LiteralPath $regPath -Name 'DisplayName' -Value '${job.display_name.replace(/'/g, "''")}' -Type String
        Set-ADTRegistryKey -LiteralPath $regPath -Name 'Version' -Value '${job.version}' -Type String
        Set-ADTRegistryKey -LiteralPath $regPath -Name 'Publisher' -Value '${job.publisher.replace(/'/g, "''")}' -Type String
        Set-ADTRegistryKey -LiteralPath $regPath -Name 'WingetId' -Value '${job.winget_id.replace(/'/g, "''")}' -Type String
        Set-ADTRegistryKey -LiteralPath $regPath -Name 'InstalledDate' -Value (Get-Date -Format 'o') -Type String
${capturedIdentityValues}
        Write-ADTLogEntry -Message "IntuneGet detection marker written to $regPath" -Severity 'Success' -Source 'Install-ADTDeployment'
    } catch {
        Write-ADTLogEntry -Message "Warning: Could not write detection marker: $_" -Severity 'Warning' -Source 'Install-ADTDeployment'
    }`;
  }

  /**
   * Generate PowerShell code to remove IntuneGet registry marker
   * Called during uninstallation to clean up detection marker
   */
  private getRegistryMarkerRemoval(job: PackagingJob): string {
    const sanitizedId = this.sanitizeWingetId(job.winget_id);
    const hive = this.getRegistryHive(job.install_scope);
    const hiveLongName = job.install_scope === 'user' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';
    const markerPath = this.getRegistryMarkerPath(job);
    const regPath = `${hive}\\${markerPath}\\${sanitizedId}`;

    return `try {
        $regPath = '${regPath}'
        if (Test-Path -LiteralPath 'Registry::${hiveLongName}\\${markerPath}\\${sanitizedId}' -PathType Container) {
            Remove-ADTRegistryKey -LiteralPath $regPath -Recurse
            Write-ADTLogEntry -Message "IntuneGet detection marker removed from $regPath" -Severity 'Success' -Source 'Uninstall-ADTDeployment'
        }
    } catch {
        Write-ADTLogEntry -Message "Warning: Could not remove detection marker: $_" -Severity 'Warning' -Source 'Uninstall-ADTDeployment'
    }`;
  }

  /**
   * Extract silent switches from install command
   */
  private extractSilentSwitches(installCommand: string, installerType: string): string {
    const defaultSwitches: Record<string, string> = {
      msi: '/qn /norestart',
      exe: '/S',
      inno: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
      nullsoft: '/S',
      wix: '/qn /norestart',
      burn: '/q /norestart',
      msix: '',
    };

    const cleaned = installCommand
      .replace(/^"[^"]+"\s*/, '')
      .replace(/^\S+\.(exe|msi|msix|appx)\s*/i, '')
      .replace(/\/[ixp]\s+"[^"]+"\s*/gi, '')
      .replace(/\/[ixp]\s+\{[^}]+\}\s*/gi, '')
      .replace(/\/[ixp]\s+\S+\.(msi|msp)\s*/gi, '')
      .trim();
    if (/^(?:\/\S+|-{1,2}\S+)/.test(cleaned) && cleaned !== '-DeploymentType') {
      return cleaned;
    }

    return defaultSwitches[installerType] || '/S';
  }

  private getInstallerSuccessCodes(job: PackagingJob): number[] {
    const config = job.package_config && typeof job.package_config === 'object' && !Array.isArray(job.package_config)
      ? job.package_config as Record<string, unknown>
      : {};
    const raw = Array.isArray(config.installerSuccessCodes) ? config.installerSuccessCodes : [];
    return Array.from(new Set([0, ...raw
      .map((code) => typeof code === 'number' ? code : Number(code))
      .filter((code) => Number.isInteger(code) && code >= 0 && code <= 65535)]))
      .sort((left, right) => left - right);
  }

  /**
   * Create .intunewin package using IntuneWinAppUtil.exe
   */
  private async createIntunewinPackage(
    packageDir: string,
    workDir: string
  ): Promise<PackagingResult> {
    const outputDir = path.join(workDir, 'Output');
    await fs.promises.mkdir(outputDir, { recursive: true });

    const intuneWinUtil = path.join(this.config.paths.tools, 'IntuneWinAppUtil.exe');

    const setupFile = 'Invoke-AppDeployToolkit.exe';
    if (!fs.existsSync(path.join(packageDir, setupFile))) {
      throw new Error(
        `${setupFile} is missing from the package folder. ` +
          'Run "intuneget-packager setup" to repair the tools directory.'
      );
    }

    // Run IntuneWinAppUtil.exe. It reports some failures on stdout while still
    // exiting 0, so keep the output for diagnostics.
    const toolOutput = await this.runProcess(intuneWinUtil, [
      '-c', packageDir,
      '-s', setupFile,
      '-o', outputDir,
      '-q', // Quiet mode
    ]);

    // Find the generated .intunewin file
    const files = await fs.promises.readdir(outputDir);
    const intunewinFile = files.find(f => f.endsWith('.intunewin'));

    if (!intunewinFile) {
      const detail = toolOutput.trim().slice(-500);
      throw new Error(
        `IntuneWinAppUtil did not generate .intunewin file${detail ? `. Tool output: ${detail}` : ''}`
      );
    }

    const intunewinPath = path.join(outputDir, intunewinFile);

    // Extract encryption info AND the inner encrypted payload from the intunewin
    return await this.extractPackageContents(intunewinPath, outputDir);
  }

  /**
   * Extract encryption info and the inner encrypted content file from a
   * .intunewin package.
   *
   * A .intunewin is a ZIP containing Metadata/Detection.xml (encryption keys,
   * digest, the unencrypted content size, and the encrypted payload's file
   * name) plus Contents/<encrypted-payload>. Intune expects the raw encrypted
   * payload to be uploaded to Azure Storage - never the outer .intunewin zip -
   * with size = UnencryptedContentSize and sizeEncrypted = the payload's size.
   */
  private async extractPackageContents(
    intunewinPath: string,
    outputDir: string
  ): Promise<PackagingResult> {
    const extractDir = path.join(outputDir, 'intunewin-extract');
    const escapedIntunewin = intunewinPath.replace(/'/g, "''");
    const escapedExtractDir = extractDir.replace(/'/g, "''");

    const script = `
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $extractDir = '${escapedExtractDir}'
      if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force }
      [System.IO.Compression.ZipFile]::ExtractToDirectory('${escapedIntunewin}', $extractDir)

      $detection = Get-ChildItem $extractDir -Filter 'Detection.xml' -Recurse | Select-Object -First 1
      if (-not $detection) { throw 'Detection.xml not found inside .intunewin package' }
      [xml]$xml = Get-Content $detection.FullName

      $encryptedFileName = $xml.ApplicationInfo.FileName
      $encryptedFile = Get-ChildItem $extractDir -Filter $encryptedFileName -Recurse | Select-Object -First 1
      if (-not $encryptedFile) { throw "Encrypted content file '$encryptedFileName' not found inside .intunewin package" }

      @{
        EncryptionKey = $xml.ApplicationInfo.EncryptionInfo.EncryptionKey
        MacKey = $xml.ApplicationInfo.EncryptionInfo.MacKey
        InitializationVector = $xml.ApplicationInfo.EncryptionInfo.InitializationVector
        Mac = $xml.ApplicationInfo.EncryptionInfo.Mac
        ProfileIdentifier = $xml.ApplicationInfo.EncryptionInfo.ProfileIdentifier
        FileDigest = $xml.ApplicationInfo.EncryptionInfo.FileDigest
        FileDigestAlgorithm = $xml.ApplicationInfo.EncryptionInfo.FileDigestAlgorithm
        EncryptedContentPath = $encryptedFile.FullName
        EncryptedContentSize = $encryptedFile.Length
        UnencryptedContentSize = [long]$xml.ApplicationInfo.UnencryptedContentSize
      } | ConvertTo-Json
    `;

    const result = await this.runPowerShell(script);
    const data = JSON.parse(result.trim());

    return {
      intunewinPath,
      encryptedContentPath: data.EncryptedContentPath,
      unencryptedContentSize: Number(data.UnencryptedContentSize),
      encryptedContentSize: Number(data.EncryptedContentSize),
      encryptionInfo: {
        encryptionKey: data.EncryptionKey,
        macKey: data.MacKey,
        initializationVector: data.InitializationVector,
        mac: data.Mac,
        profileIdentifier: data.ProfileIdentifier || 'ProfileVersion1',
        fileDigest: data.FileDigest,
        fileDigestAlgorithm: data.FileDigestAlgorithm,
      },
    };
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.promises.mkdir(dest, { recursive: true });
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Run a process and wait for completion
   */
  private runProcess(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          const detail = (stderr.trim() || stdout.trim()).slice(-500);
          reject(new Error(`Process exited with code ${code}${detail ? `: ${detail}` : ''}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Run PowerShell script or command
   */
  private runPowerShell(scriptOrPath: string, args?: string[]): Promise<string> {
    const isFile = scriptOrPath.endsWith('.ps1');
    const psArgs = isFile
      ? ['-ExecutionPolicy', 'Bypass', '-File', scriptOrPath, ...(args || [])]
      : ['-ExecutionPolicy', 'Bypass', '-Command', scriptOrPath];

    return this.runProcess('powershell.exe', psArgs);
  }
}
