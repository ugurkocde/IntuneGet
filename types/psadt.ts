/**
 * PSADT (PowerShell App Deploy Toolkit) Configuration Types
 * Comprehensive support for PSADT v4 UI elements and Intune deployments
 */

import type { DetectionRule } from './intune';

// Re-export DetectionRule for convenience
export type { DetectionRule };

/**
 * Restart behavior after installation
 */
export type RestartBehavior =
  | 'Suppress'         // Never restart (recommended for Intune)
  | 'Force'            // Force restart after install
  | 'Prompt';          // Prompt user to restart

/**
 * PSADT deploy mode - controls UI visibility during installation
 */
export type DeployMode =
  | 'Silent'           // No UI at all (recommended for Intune)
  | 'NonInteractive'   // Shows progress but no user interaction required
  | 'Auto';            // PSADT auto-detects based on session state

/**
 * Detection rule type for Intune
 */
export type DetectionType =
  | 'msi'              // MSI Product Code (most reliable for MSI)
  | 'file'             // File/folder existence or version
  | 'registry'         // Registry key/value check
  | 'script';          // PowerShell script

/**
 * Window position options for PSADT dialogs
 */
export type DialogPosition =
  | 'Default'
  | 'Center'
  | 'Top'
  | 'Bottom'
  | 'TopLeft'
  | 'TopRight'
  | 'BottomLeft'
  | 'BottomRight';

/**
 * Icon options for PSADT prompts
 */
export type DialogIcon =
  | 'None'
  | 'Information'
  | 'Warning'
  | 'Error'
  | 'Question';

/**
 * Balloon tip icon options
 */
export type BalloonIcon =
  | 'Info'
  | 'Warning'
  | 'Error'
  | 'None';

/**
 * Processes that should be closed before installation
 */
export interface ProcessToClose {
  name: string;        // Process name without .exe
  description: string; // Friendly name shown to user
}

/**
 * Custom prompt configuration (Show-ADTInstallationPrompt)
 */
export interface CustomPrompt {
  enabled: boolean;
  timing: 'pre-install' | 'post-install' | 'pre-uninstall' | 'post-uninstall';
  title: string;
  message: string;
  icon: DialogIcon;
  buttonLeftText?: string;
  buttonMiddleText?: string;
  buttonRightText?: string;
  timeout?: number;
  persistPrompt?: boolean;
}

/**
 * Progress dialog configuration (Show-ADTInstallationProgress)
 */
export interface ProgressConfig {
  enabled: boolean;
  statusMessage?: string;
  windowLocation?: DialogPosition;
}

/**
 * Restart prompt configuration (Show-ADTInstallationRestartPrompt)
 */
export interface RestartPromptConfig {
  enabled: boolean;
  countdownSeconds: number;
  countdownNoHideSeconds: number;
}

/**
 * Balloon tip configuration (Show-ADTBalloonTip)
 */
export interface BalloonTipConfig {
  enabled: boolean;
  timing: 'start' | 'end';
  title: string;
  text: string;
  icon: BalloonIcon;
  displayTime: number;
}

/**
 * Complete PSADT configuration for a package
 * Comprehensive support for all PSADT v4 UI elements
 */
export interface PSADTConfig {
  // Process management
  processesToClose: ProcessToClose[];

  // App close handling
  showClosePrompt: boolean;        // Enable interactive close dialog
  closeCountdown: number;          // Countdown duration in seconds (default 60)

  // Extended welcome parameters
  blockExecution: boolean;         // Block users from launching apps during install
  promptToSave: boolean;           // Prompt users to save documents before closing apps
  forceCloseProcessesCountdown?: number; // Force countdown regardless of deferral
  persistPrompt: boolean;          // Make prompt reappear until answered
  minimizeWindows: boolean;        // Minimize other windows when showing dialog
  windowLocation: DialogPosition;  // Position of dialog on screen
  brandingCompanyName?: string;    // Company name used by toolkit UI
  brandingWelcomeTitle?: string;   // Custom title for the welcome prompt
  brandingWelcomeMessage?: string; // Custom message for the welcome prompt
  brandingAccentColor?: string;    // Fluent UI accent color
  brandingLogoPath?: string;       // Optional logo image path
  brandingLogoDarkPath?: string;   // Optional dark mode logo image path
  brandingBannerPath?: string;     // Optional banner image path

  // Deferral handling
  allowDefer: boolean;
  deferTimes: number;              // How many times user can defer (default 3)
  deferDeadline?: string;          // ISO date string deadline for deferrals
  deferDays?: number;              // Number of days user can defer

  // Disk space check
  checkDiskSpace: boolean;         // Validate disk space before install
  requiredDiskSpace?: number;      // Required disk space in MB

  // Restart handling
  restartBehavior: RestartBehavior;

  // Deploy mode - controls PSADT v4 UI visibility
  deployMode?: DeployMode;

  // Remove any detected existing installation before installing
  removeExistingInstall?: boolean;

  // Verify the application appears in Add/Remove Programs after install
  // and fail the deployment if it is not found (opt-in)
  verifyInstall?: boolean;

  // Progress dialog (Show-ADTInstallationProgress)
  progressDialog: ProgressConfig;

  // Custom prompts (Show-ADTInstallationPrompt)
  customPrompts: CustomPrompt[];

  // Restart prompt (Show-ADTInstallationRestartPrompt)
  restartPrompt: RestartPromptConfig;

  // Balloon tips (Show-ADTBalloonTip)
  balloonTips: BalloonTipConfig[];

  // Detection
  detectionRules: DetectionRule[];

  // Registry marker root: subpath under the hive (HKLM/HKCU) where the
  // IntuneGet detection marker key is written, without a hive prefix.
  // Example: 'SOFTWARE\\Contoso\\Apps'. Absent/empty means the default
  // 'SOFTWARE\\IntuneGet\\Apps' (see lib/registry-marker.ts).
  registryMarkerPath?: string;

  // Install commands (can override defaults)
  installCommand?: string;
  uninstallCommand?: string;

  // Internal, reviewed vendor arguments appended to the manifest-derived
  // install command. Application adapters populate this field; it is not a
  // customer-facing free-form command surface.
  reviewedInstallArguments?: string[];

  // Internal, reviewed replacement for manifest-derived silent arguments when
  // a vendor documents a proprietary unattended command line. Application
  // adapters populate this field; customers cannot supply it directly.
  reviewedInstallArgumentsOverride?: string;

  // Internal, reviewed vendor arguments appended to an exact registered
  // uninstaller. Application adapters populate this field; it is intentionally
  // not exposed as a customer-facing free-form command surface.
  reviewedUninstallArguments?: string[];

  // Internal guard for a reviewed vendor MSI custom-action helper that can
  // remain alive indefinitely during removal. The packager only accepts this
  // value from an application adapter and matches both the executable name and
  // command line before ending the newly spawned helper after a grace period.
  reviewedUninstallProcessGuard?: {
    processName: string;
    argumentsPattern: string;
    graceSeconds: number;
  };

  // Internal completion window for vendor uninstallers that hand work to a
  // child process. Application adapters may extend the five-minute default;
  // the exact registry identity remains the authoritative completion signal.
  uninstallCompletionTimeoutMinutes?: number;

  // Internal lifecycle policy for shared Windows runtimes that must remain on
  // the device when Intune relinquishes management. Application adapters are
  // the only trusted source for this value; it is not customer-configurable.
  preserveVendorInstallationOnUninstall?: boolean;

  // Internal lifecycle contract for reviewed self-extracting packages that do
  // not register an application in Add/Remove Programs. The generated package
  // verifies this exact directory after install and removes it on uninstall.
  // Application adapters are the only trusted source for this value.
  reviewedManagedInstallDirectory?: string;
  reviewedManagedUninstall?: {
    // A reviewed adapter may use one literal <VERSION> path segment. The
    // packager replaces it with the validated package version before emitting
    // the PSADT script; customer-controlled configuration cannot supply it.
    executablePath: string;
    arguments: string[];
    completionTimeoutMinutes: number;
  };

  // Internal exact-command contract for a reviewed vendor uninstaller whose
  // registered command is interactive or syntactically incorrect. The normal
  // captured ARP identity remains the authoritative completion signal.
  reviewedExactUninstall?: {
    executablePath: string;
    arguments: string[];
    completionTimeoutMinutes: number;
  };

  // Internal install-evidence contract for reviewed bundles that intentionally
  // install several independently registered products. The generated package
  // requires multiple matching ARP entries instead of weakening the ordinary
  // single-product identity rule. Application adapters are the only source.
  reviewedMultiProductInstallDisplayNamePrefixes?: string[];
  reviewedMultiProductInstallMinimumCount?: number;

  // Additional commands run as extra PSADT steps after the main install /
  // uninstall (e.g. delete a desktop shortcut after installing). Each entry is a
  // full command line executed via cmd.exe /c, in order. Empty/absent = none.
  postInstallCommands?: string[];
  postUninstallCommands?: string[];
}

/**
 * Default PSADT configuration following Intune best practices
 */
export const DEFAULT_PSADT_CONFIG: PSADTConfig = {
  // Process management
  processesToClose: [],

  // App close handling - disabled by default for silent deployments
  showClosePrompt: false,
  closeCountdown: 60,

  // Extended welcome parameters - disabled by default
  blockExecution: false,
  promptToSave: false,
  forceCloseProcessesCountdown: undefined,
  persistPrompt: false,
  minimizeWindows: false,
  windowLocation: 'Default',
  brandingCompanyName: undefined,
  brandingWelcomeTitle: undefined,
  brandingWelcomeMessage: undefined,
  brandingAccentColor: undefined,
  brandingLogoPath: undefined,
  brandingLogoDarkPath: undefined,
  brandingBannerPath: undefined,

  // Deferral handling - disabled by default
  allowDefer: false,
  deferTimes: 3,
  deferDeadline: undefined,
  deferDays: undefined,

  // Disk space check - disabled by default
  checkDiskSpace: false,
  requiredDiskSpace: undefined,

  // Suppress restarts - let Intune handle restart scheduling
  restartBehavior: 'Suppress',

  // Silent deploy mode - suppress all PSADT UI for Intune deployments
  deployMode: 'Silent',

  // Do not remove existing installations by default
  removeExistingInstall: false,

  // Progress dialog - disabled by default for silent deployments
  progressDialog: {
    enabled: false,
    statusMessage: undefined,
    windowLocation: undefined,
  },

  // Custom prompts - empty by default
  customPrompts: [],

  // Restart prompt - disabled by default
  restartPrompt: {
    enabled: false,
    countdownSeconds: 600,
    countdownNoHideSeconds: 60,
  },

  // Balloon tips - empty by default
  balloonTips: [],

  // Detection rules will be auto-generated
  detectionRules: [],

  // Commands will be auto-generated based on installer type
  installCommand: undefined,
  uninstallCommand: undefined,
  reviewedInstallArguments: [],
  reviewedInstallArgumentsOverride: undefined,
  reviewedUninstallArguments: [],
  reviewedUninstallProcessGuard: undefined,
};

/**
 * Get smart default processes to close based on app name and category
 */
export function getDefaultProcessesToClose(
  appName: string,
  installerType: string
): ProcessToClose[] {
  const processes: ProcessToClose[] = [];
  const nameLower = appName.toLowerCase();

  // Common browser-related apps
  if (nameLower.includes('chrome') || nameLower.includes('chromium')) {
    processes.push({ name: 'chrome', description: 'Google Chrome' });
  }
  if (nameLower.includes('firefox')) {
    processes.push({ name: 'firefox', description: 'Mozilla Firefox' });
  }
  if (nameLower.includes('edge')) {
    processes.push({ name: 'msedge', description: 'Microsoft Edge' });
  }

  // Office apps
  if (nameLower.includes('office') || nameLower.includes('365')) {
    processes.push(
      { name: 'WINWORD', description: 'Microsoft Word' },
      { name: 'EXCEL', description: 'Microsoft Excel' },
      { name: 'POWERPNT', description: 'Microsoft PowerPoint' },
      { name: 'OUTLOOK', description: 'Microsoft Outlook' },
      { name: 'ONENOTE', description: 'Microsoft OneNote' },
      { name: 'Teams', description: 'Microsoft Teams' }
    );
  }

  // Communication apps
  if (nameLower.includes('teams')) {
    processes.push({ name: 'Teams', description: 'Microsoft Teams' });
  }
  if (nameLower.includes('slack')) {
    processes.push({ name: 'slack', description: 'Slack' });
  }
  if (nameLower.includes('zoom')) {
    processes.push({ name: 'Zoom', description: 'Zoom' });
  }
  if (nameLower.includes('discord')) {
    processes.push({ name: 'Discord', description: 'Discord' });
  }

  // Development tools
  if (nameLower.includes('vscode') || nameLower.includes('visual studio code')) {
    processes.push({ name: 'Code', description: 'Visual Studio Code' });
  }
  if (nameLower.includes('visual studio') && !nameLower.includes('code')) {
    processes.push({ name: 'devenv', description: 'Visual Studio' });
  }
  if (nameLower.includes('git')) {
    processes.push(
      { name: 'git', description: 'Git' },
      { name: 'git-bash', description: 'Git Bash' }
    );
  }

  // Media apps
  if (nameLower.includes('vlc')) {
    processes.push({ name: 'vlc', description: 'VLC Media Player' });
  }
  if (nameLower.includes('spotify')) {
    processes.push({ name: 'Spotify', description: 'Spotify' });
  }

  // Utilities
  if (nameLower.includes('7-zip') || nameLower.includes('7zip')) {
    processes.push({ name: '7zFM', description: '7-Zip File Manager' });
  }
  if (nameLower.includes('notepad++')) {
    processes.push({ name: 'notepad++', description: 'Notepad++' });
  }
  if (nameLower.includes('powertoys')) {
    processes.push({ name: 'PowerToys', description: 'PowerToys' });
  }

  return processes;
}
