import type { DeployMode, DialogPosition, PSADTConfig, RestartBehavior } from '@/types/psadt';
import type { PackageDefaults } from '@/types/user-settings';

/**
 * Saved defaults for newly configured Win32 packages (#2085).
 *
 * Only enums, booleans and integers bounded by the PackageConfig controls are
 * accepted. Commands, detection, paths, process names, branding, free text and
 * verifyInstall are never part of a saved default.
 */
const DEPLOY_MODES: readonly DeployMode[] = ['Silent', 'NonInteractive', 'Auto'];
const RESTART_BEHAVIORS: readonly RestartBehavior[] = ['Suppress', 'Force', 'Prompt'];
const DIALOG_POSITIONS: readonly DialogPosition[] = [
  'Default', 'Center', 'Top', 'Bottom', 'TopLeft', 'TopRight', 'BottomLeft', 'BottomRight',
];

const BOOLEAN_KEYS = [
  'showClosePrompt',
  'blockExecution',
  'promptToSave',
  'persistPrompt',
  'minimizeWindows',
  'allowDefer',
  'checkDiskSpace',
  'removeExistingInstall',
] as const;

// Limits match the current PackageConfig inputs.
const INTEGER_LIMITS = {
  closeCountdown: [10, 300],
  deferTimes: [1, 99],
  deferDays: [1, 365],
} as const;
const RESTART_COUNTDOWN_LIMITS = [60, 3600] as const;
const RESTART_NO_HIDE_LIMITS = [10, 300] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function boundedInteger(value: unknown, [min, max]: readonly [number, number]): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

/** Returns a clean defaults object, or null when nothing valid remains. */
export function sanitizePackageDefaults(value: unknown): PackageDefaults | null {
  if (!isPlainObject(value)) return null;
  const result: PackageDefaults = {};

  if (DEPLOY_MODES.includes(value.deployMode as DeployMode)) {
    result.deployMode = value.deployMode as DeployMode;
  }
  if (RESTART_BEHAVIORS.includes(value.restartBehavior as RestartBehavior)) {
    result.restartBehavior = value.restartBehavior as RestartBehavior;
  }
  if (DIALOG_POSITIONS.includes(value.windowLocation as DialogPosition)) {
    result.windowLocation = value.windowLocation as DialogPosition;
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof value[key] === 'boolean') result[key] = value[key] as boolean;
  }
  for (const key of Object.keys(INTEGER_LIMITS) as (keyof typeof INTEGER_LIMITS)[]) {
    const parsed = boundedInteger(value[key], INTEGER_LIMITS[key]);
    if (parsed !== undefined) result[key] = parsed;
  }
  if (isPlainObject(value.progressDialog) && typeof value.progressDialog.enabled === 'boolean') {
    result.progressDialog = { enabled: value.progressDialog.enabled };
  }
  if (isPlainObject(value.restartPrompt)) {
    const prompt = value.restartPrompt;
    const countdownSeconds = boundedInteger(prompt.countdownSeconds, RESTART_COUNTDOWN_LIMITS);
    const countdownNoHideSeconds = boundedInteger(prompt.countdownNoHideSeconds, RESTART_NO_HIDE_LIMITS);
    if (typeof prompt.enabled === 'boolean' && countdownSeconds !== undefined && countdownNoHideSeconds !== undefined) {
      result.restartPrompt = { enabled: prompt.enabled, countdownSeconds, countdownNoHideSeconds };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** Picks the saveable defaults out of a package's current PSADT config. */
export function pickPackageDefaults(config: PSADTConfig): PackageDefaults | null {
  const clean = sanitizePackageDefaults(config);
  const keys = ['deployMode', 'restartBehavior', 'windowLocation', ...BOOLEAN_KEYS, ...Object.keys(INTEGER_LIMITS), 'restartPrompt', 'progressDialog'] as const;
  for (const key of keys) {
    if ((key === 'deferTimes' || key === 'deferDays') && config.allowDefer !== true) continue;
    if (config[key as keyof PSADTConfig] !== undefined && (!clean || !(key in clean))) {
      throw new Error(`Package defaults contain an invalid value for ${key}. Check its countdown or deferral limits before saving.`);
    }
  }
  return clean;
}

/** Seeds a new package's starting config. Package specific fields are kept. */
export function applyPackageDefaults(config: PSADTConfig, defaults: PackageDefaults | null): PSADTConfig {
  const clean = sanitizePackageDefaults(defaults);
  if (!clean) return config;
  return {
    ...config,
    ...clean,
    ...(clean.progressDialog ? { progressDialog: { ...config.progressDialog, ...clean.progressDialog } } : {}),
    ...(clean.restartPrompt ? { restartPrompt: { ...clean.restartPrompt } } : {}),
  };
}
