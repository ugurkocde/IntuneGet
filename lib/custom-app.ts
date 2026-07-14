/**
 * Custom App Helpers
 * Builds Win32 cart items for apps added via a direct installer URL
 * (issue #109, phase 1) instead of the winget catalog.
 *
 * Custom apps reuse the existing win32 packaging pipeline: a synthetic
 * winget-style ID (Custom.<Publisher>.<Name>) drives the registry marker
 * detection rule. A supplied SHA256 enables strict verification; when it is
 * omitted, the packaging workflow calculates the hash from the downloaded
 * installer and records it on the job.
 */

import {
  generateDetectionRules,
  generateInstallCommand,
  generateUninstallCommand,
} from '@/lib/detection-rules';
import { DEFAULT_PSADT_CONFIG } from '@/types/psadt';
import type {
  NormalizedInstaller,
  WingetArchitecture,
  WingetInstallerType,
  WingetScope,
} from '@/types/winget';
import type { Win32CartItem } from '@/types/upload';

// Installer types supported for custom apps (subset of WingetInstallerType)
export type CustomInstallerType = Extract<
  WingetInstallerType,
  'exe' | 'msi' | 'inno' | 'nullsoft' | 'burn'
>;

// Mirrors getDefaultSilentSwitch in lib/manifest-api.ts (not exported there),
// limited to the installer types supported for custom apps.
export const CUSTOM_SILENT_SWITCH_DEFAULTS: Record<CustomInstallerType, string> = {
  exe: '/S',
  msi: '/qn /norestart',
  inno: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
  nullsoft: '/S',
  burn: '/quiet /norestart',
};

export interface CustomAppInput {
  displayName: string;
  publisher: string;
  version: string;
  installerUrl: string;
  installerType: CustomInstallerType;
  architecture: WingetArchitecture;
  installScope: WingetScope;
  silentSwitches?: string;
  sha256?: string;
  uninstallCommand?: string;
  description?: string;
  iconUrl?: string;
}

export type CustomAppCartItem = Omit<Win32CartItem, 'id' | 'addedAt'>;

/**
 * Strip all non-alphanumeric characters, e.g. "O'Brien Software" -> "OBrienSoftware".
 * Capped at 64 characters per segment so pathological input cannot produce
 * oversized ids or registry marker key paths.
 */
export function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
}

/**
 * Synthesize a winget-style package ID for a custom app.
 * Example: "O'Brien Software" + "My App 2" -> "Custom.OBrienSoftware.MyApp2"
 */
export function buildCustomWingetId(publisher: string, displayName: string): string {
  const publisherSlug = slugify(publisher) || 'Publisher';
  const nameSlug = slugify(displayName) || 'App';
  return `Custom.${publisherSlug}.${nameSlug}`;
}

export function isValidInstallerUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isValidSha256(value: string): boolean {
  return /^[A-Fa-f0-9]{64}$/.test(value);
}

export function isValidIconUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Assemble a complete Win32 cart item from custom app form input.
 * Throws on invalid input - callers (the form) should validate first
 * and surface inline errors; this acts as the final guard.
 */
export function buildCustomAppCartItem(input: CustomAppInput): CustomAppCartItem {
  const displayName = input.displayName.trim();
  const publisher = input.publisher.trim();
  const version = input.version.trim();
  const installerUrl = input.installerUrl.trim();
  const sha256 = input.sha256?.trim() || '';
  const iconUrl = input.iconUrl?.trim() || '';

  if (!displayName || !publisher || !version) {
    throw new Error('Display name, publisher, and version are required');
  }
  if (!isValidInstallerUrl(installerUrl)) {
    throw new Error('Installer URL must be a valid http(s) URL');
  }
  if (sha256 && !isValidSha256(sha256)) {
    throw new Error('SHA256 must be a 64-character hexadecimal string');
  }
  if (iconUrl && !isValidIconUrl(iconUrl)) {
    throw new Error('Icon URL must be a valid https URL');
  }

  const wingetId = buildCustomWingetId(publisher, displayName);

  const installer: NormalizedInstaller = {
    architecture: input.architecture,
    url: installerUrl,
    sha256,
    type: input.installerType,
    scope: input.installScope,
    silentArgs: input.silentSwitches?.trim() || CUSTOM_SILENT_SWITCH_DEFAULTS[input.installerType],
  };

  const detectionRules = generateDetectionRules(installer, displayName, wingetId, version);

  return {
    appSource: 'win32',
    sourceType: 'custom',
    wingetId,
    displayName,
    publisher,
    description: input.description?.trim() || undefined,
    version,
    architecture: input.architecture,
    installScope: input.installScope,
    installerType: input.installerType,
    installerUrl,
    installerSha256: sha256,
    installCommand: generateInstallCommand(installer, input.installScope),
    uninstallCommand: input.uninstallCommand?.trim() || generateUninstallCommand(installer, displayName),
    detectionRules,
    iconPath: iconUrl || undefined,
    psadtConfig: {
      ...DEFAULT_PSADT_CONFIG,
      detectionRules,
    },
  };
}
