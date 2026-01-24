/**
 * PSADT (PowerShell App Deploy Toolkit) Configuration Types
 * Simplified for Intune deployments with essential features
 */

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
 * Processes that should be closed before installation
 */
export interface ProcessToClose {
  name: string;        // Process name without .exe
  description: string; // Friendly name shown to user
}

/**
 * File-based detection rule
 */
export interface FileDetection {
  type: 'file';
  path: string;                    // e.g., %ProgramFiles%\App\app.exe
  detectionMethod: 'exists' | 'version' | 'size' | 'dateModified';
  operator?: 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual';
  value?: string;
  check32BitOn64System: boolean;
}

/**
 * Registry-based detection rule
 */
export interface RegistryDetection {
  type: 'registry';
  keyPath: string;                 // e.g., HKLM\SOFTWARE\App
  valueName?: string;              // Optional - if not set, checks key existence
  detectionMethod: 'exists' | 'string' | 'integer' | 'version';
  operator?: 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual';
  value?: string;
  check32BitOn64System: boolean;
}

/**
 * MSI-based detection rule
 */
export interface MsiDetection {
  type: 'msi';
  productCode: string;             // MSI Product Code GUID
  productVersionOperator?: 'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual';
  productVersion?: string;
}

/**
 * Script-based detection rule
 */
export interface ScriptDetection {
  type: 'script';
  script: string;                  // PowerShell script content
  enforceSignatureCheck: boolean;
  runAs32Bit: boolean;
}

export type DetectionRule = FileDetection | RegistryDetection | MsiDetection | ScriptDetection;

/**
 * Complete PSADT configuration for a package
 * Simplified to essential settings that are actually implemented
 */
export interface PSADTConfig {
  // Process management
  processesToClose: ProcessToClose[];

  // App close handling
  showClosePrompt: boolean;        // Enable interactive close dialog
  closeCountdown: number;          // Countdown duration in seconds (default 60)

  // Deferral handling
  allowDefer: boolean;
  deferTimes: number;              // How many times user can defer (default 3)

  // Restart handling
  restartBehavior: RestartBehavior;

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

  // Deferral handling - disabled by default
  allowDefer: false,
  deferTimes: 3,

  // Suppress restarts - let Intune handle restart scheduling
  restartBehavior: 'Suppress',

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
