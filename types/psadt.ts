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

  // Install commands (can override defaults)
  installCommand?: string;
  uninstallCommand?: string;
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
