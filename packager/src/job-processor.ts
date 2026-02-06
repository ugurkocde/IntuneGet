/**
 * Job Processor - Orchestrates the packaging and upload steps
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { PackagerConfig } from './config.js';
import { PackagingJob, JobPoller } from './job-poller.js';
import { IntuneUploader, IntuneAppResult } from './intune-uploader.js';
import { createLogger, Logger } from './logger.js';

interface PackagingResult {
  intunewinPath: string;
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
      const intuneApp = await this.uploader.uploadToIntune(
        job,
        result.intunewinPath,
        result.encryptionInfo,
        async (percent, message) => {
          // Map upload progress (0-100) to overall progress (75-95)
          const overallPercent = 75 + Math.floor(percent * 0.2);
          await poller.updateJobProgress(job.id, overallPercent, message);
        }
      );

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

    // Check if tools exist
    const intuneWinExists = fs.existsSync(intuneWinUtil);
    const psadtExists = fs.existsSync(psadtDir);

    if (!intuneWinExists || !psadtExists) {
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
   */
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(url);

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
    const urlFileName = path.basename(urlPath);

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
    if (fs.existsSync(psadtSource)) {
      await this.copyDirectory(psadtSource, toolkitDir);
    }

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
    if (fs.existsSync(deployExeSource)) {
      await fs.promises.copyFile(deployExeSource, path.join(packageDir, 'Invoke-AppDeployToolkit.exe'));
    }

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
   * Generate Deploy-Application.ps1 script
   */
  private generateDeployScript(job: PackagingJob, installerFileName: string): string {
    const silentSwitches = this.extractSilentSwitches(job.install_command, job.installer_type);

    return `<#
.SYNOPSIS
    PSAppDeployToolkit deployment script for ${job.display_name}
.DESCRIPTION
    This script deploys ${job.display_name} ${job.version} using PSAppDeployToolkit
#>

[CmdletBinding()]
Param (
    [Parameter(Mandatory = $false)]
    [ValidateSet('Install', 'Uninstall', 'Repair')]
    [String]$DeploymentType = 'Install',
    [Parameter(Mandatory = $false)]
    [ValidateSet('Interactive', 'Silent', 'NonInteractive')]
    [String]$DeployMode = 'Silent',
    [Parameter(Mandatory = $false)]
    [switch]$AllowRebootPassThru,
    [Parameter(Mandatory = $false)]
    [switch]$TerminalServerMode,
    [Parameter(Mandatory = $false)]
    [switch]$DisableLogging
)

Try {
    ## Set the script execution policy for this process
    Try { Set-ExecutionPolicy -ExecutionPolicy 'ByPass' -Scope 'Process' -Force -ErrorAction 'Stop' } Catch {}

    ##*===============================================
    ##* VARIABLE DECLARATION
    ##*===============================================
    ## Variables: Application
    [String]$appVendor = '${job.publisher.replace(/'/g, "''")}'
    [String]$appName = '${job.display_name.replace(/'/g, "''")}'
    [String]$appVersion = '${job.version}'
    [String]$appArch = '${job.architecture}'
    [String]$appLang = 'EN'
    [String]$appRevision = '01'
    [String]$appScriptVersion = '1.0.0'
    [String]$appScriptDate = '${new Date().toISOString().split('T')[0]}'
    [String]$appScriptAuthor = 'IntuneGet'

    ##*===============================================
    ##* PRE-INSTALLATION
    ##*===============================================
    [String]$installPhase = 'Pre-Installation'

    ##*===============================================
    ##* INSTALLATION
    ##*===============================================
    [String]$installPhase = 'Installation'

    If ($DeploymentType -ieq 'Install') {
        ## Install application
        $installerPath = "$dirFiles\\${installerFileName}"
        ${this.getInstallCommand(job.installer_type, installerFileName, silentSwitches)}
    }
    ElseIf ($DeploymentType -ieq 'Uninstall') {
        ## Uninstall application
        ${this.getUninstallCommand(job)}

        ## Remove IntuneGet registry marker
        ${this.getRegistryMarkerRemoval(job)}
    }

    ##*===============================================
    ##* POST-INSTALLATION
    ##*===============================================
    [String]$installPhase = 'Post-Installation'

    If ($DeploymentType -ieq 'Install') {
        ## Create IntuneGet registry marker for detection
        ${this.getRegistryMarkerCreation(job)}
    }

}
Catch {
    [Int32]$mainExitCode = 60001
    [String]$mainErrorMessage = "Installation failed: $_"
    Write-Error -Message $mainErrorMessage
    Exit $mainExitCode
}
`;
  }

  /**
   * Get install command based on installer type
   */
  private getInstallCommand(installerType: string, fileName: string, silentSwitches: string): string {
    const ext = path.extname(fileName).toLowerCase();

    if (ext === '.msi' || installerType === 'msi' || installerType === 'wix') {
      return `Execute-MSI -Action 'Install' -Path $installerPath -Parameters '${silentSwitches}'`;
    }

    return `Execute-Process -Path $installerPath -Parameters '${silentSwitches}' -WaitForMsiExec`;
  }

  /**
   * Get uninstall command
   */
  private getUninstallCommand(job: PackagingJob): string {
    if (job.uninstall_command) {
      return `Execute-Process -Path 'cmd.exe' -Parameters '/c ${job.uninstall_command.replace(/'/g, "''")}'`;
    }
    return "## No uninstall command specified";
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
   * Generate PowerShell code to create IntuneGet registry marker
   * This marker is used by Intune detection rules to verify installation
   */
  private getRegistryMarkerCreation(job: PackagingJob): string {
    const sanitizedId = this.sanitizeWingetId(job.winget_id);
    const hive = this.getRegistryHive(job.install_scope);
    const regPath = `${hive}:\\SOFTWARE\\IntuneGet\\Apps\\${sanitizedId}`;

    return `
        ## Create IntuneGet detection marker
        $regPath = '${regPath}'
        If (-not (Test-Path $regPath)) {
            New-Item -Path $regPath -Force | Out-Null
        }
        Set-ItemProperty -Path $regPath -Name 'Version' -Value '${job.version}' -Type String -Force
        Set-ItemProperty -Path $regPath -Name 'DisplayName' -Value '${job.display_name.replace(/'/g, "''")}' -Type String -Force
        Set-ItemProperty -Path $regPath -Name 'Publisher' -Value '${job.publisher.replace(/'/g, "''")}' -Type String -Force
        Set-ItemProperty -Path $regPath -Name 'InstalledOn' -Value (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Type String -Force
        Write-Log -Message "Created IntuneGet detection marker at $regPath" -Source 'Post-Installation'`;
  }

  /**
   * Generate PowerShell code to remove IntuneGet registry marker
   * Called during uninstallation to clean up detection marker
   */
  private getRegistryMarkerRemoval(job: PackagingJob): string {
    const sanitizedId = this.sanitizeWingetId(job.winget_id);
    const hive = this.getRegistryHive(job.install_scope);
    const regPath = `${hive}:\\SOFTWARE\\IntuneGet\\Apps\\${sanitizedId}`;

    return `
        ## Remove IntuneGet detection marker
        $regPath = '${regPath}'
        If (Test-Path $regPath) {
            Remove-Item -Path $regPath -Force -ErrorAction SilentlyContinue
            Write-Log -Message "Removed IntuneGet detection marker at $regPath" -Source 'Uninstallation'
        }`;
  }

  /**
   * Extract silent switches from install command
   */
  private extractSilentSwitches(installCommand: string, installerType: string): string {
    const defaultSwitches: Record<string, string> = {
      msi: '/qn /norestart',
      exe: '/S',
      inno: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
      nullsoft: '/S',
      wix: '/qn /norestart',
      burn: '/q /norestart',
      msix: '',
    };

    // Try to extract switches from the install command
    const switchMatch = installCommand.match(/(?:\/\S+|-\S+)(?:\s+(?:\/\S+|-\S+))*/);
    if (switchMatch && switchMatch[0] !== '-DeploymentType') {
      return switchMatch[0];
    }

    return defaultSwitches[installerType] || '/S';
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

    // Run IntuneWinAppUtil.exe
    await this.runProcess(intuneWinUtil, [
      '-c', packageDir,
      '-s', 'Invoke-AppDeployToolkit.exe',
      '-o', outputDir,
      '-q', // Quiet mode
    ]);

    // Find the generated .intunewin file
    const files = await fs.promises.readdir(outputDir);
    const intunewinFile = files.find(f => f.endsWith('.intunewin'));

    if (!intunewinFile) {
      throw new Error('IntuneWinAppUtil did not generate .intunewin file');
    }

    const intunewinPath = path.join(outputDir, intunewinFile);

    // Extract encryption info from Detection.xml inside the intunewin
    const encryptionInfo = await this.extractEncryptionInfo(intunewinPath);

    return {
      intunewinPath,
      encryptionInfo,
    };
  }

  /**
   * Extract encryption info from .intunewin file
   */
  private async extractEncryptionInfo(
    intunewinPath: string
  ): Promise<PackagingResult['encryptionInfo']> {
    // The .intunewin file is a ZIP containing Detection.xml with encryption info
    // Use PowerShell to extract and parse it
    const script = `
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $zip = [System.IO.Compression.ZipFile]::OpenRead('${intunewinPath.replace(/'/g, "''")}')
      $entry = $zip.Entries | Where-Object { $_.Name -eq 'Detection.xml' }
      $reader = New-Object System.IO.StreamReader($entry.Open())
      $xml = [xml]$reader.ReadToEnd()
      $reader.Close()
      $zip.Dispose()

      @{
        EncryptionKey = $xml.ApplicationInfo.EncryptionInfo.EncryptionKey
        MacKey = $xml.ApplicationInfo.EncryptionInfo.MacKey
        InitializationVector = $xml.ApplicationInfo.EncryptionInfo.InitializationVector
        Mac = $xml.ApplicationInfo.EncryptionInfo.Mac
        ProfileIdentifier = $xml.ApplicationInfo.EncryptionInfo.ProfileIdentifier
        FileDigest = $xml.ApplicationInfo.EncryptionInfo.FileDigest
        FileDigestAlgorithm = $xml.ApplicationInfo.EncryptionInfo.FileDigestAlgorithm
      } | ConvertTo-Json
    `;

    const result = await this.runPowerShell(script);
    const encryptionData = JSON.parse(result.trim());

    return {
      encryptionKey: encryptionData.EncryptionKey,
      macKey: encryptionData.MacKey,
      initializationVector: encryptionData.InitializationVector,
      mac: encryptionData.Mac,
      profileIdentifier: encryptionData.ProfileIdentifier,
      fileDigest: encryptionData.FileDigest,
      fileDigestAlgorithm: encryptionData.FileDigestAlgorithm,
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
          reject(new Error(`Process exited with code ${code}: ${stderr}`));
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
