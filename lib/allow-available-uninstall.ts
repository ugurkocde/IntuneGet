import { logValue } from '@/lib/server-log';

export type AllowAvailableUninstallSource =
  | 'explicit_override'
  | 'explicit_config'
  | 'explicit_settings_patch'
  | 'inherited_upload_history'
  | 'inherited_graph'
  | 'preserved_same_app'
  | 'default_graph_field_missing'
  | 'default_source_missing'
  | 'default_omitted';

export type AllowAvailableUninstallGraphReadStatus =
  | 'not_needed'
  | 'hit'
  | 'field_missing'
  | 'not_found'
  | 'error';

const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function parseAllowAvailableUninstall(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function parseAllowAvailableUninstallFromRecord(record: unknown): boolean | undefined {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return undefined;
  }
  return parseAllowAvailableUninstall((record as Record<string, unknown>).allowAvailableUninstall);
}

export function hasInvalidAllowAvailableUninstall(record: unknown): boolean {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return false;
  }
  const value = (record as Record<string, unknown>).allowAvailableUninstall;
  return value !== undefined && typeof value !== 'boolean';
}

export function isHostedAllowAvailableUninstallEnabled(): boolean {
  return (
    process.env.HOSTED_ALLOW_AVAILABLE_UNINSTALL_ENABLED === 'true' ||
    process.env.NEXT_PUBLIC_HOSTED_ALLOW_AVAILABLE_UNINSTALL === 'true'
  );
}

export interface AllowAvailableUninstallAuditEntry {
  jobId?: string;
  policyId?: string;
  wingetId?: string;
  updateMode: 'create' | 'sameApp' | 'auto_update' | 'settings_patch';
  allowAvailableUninstall: boolean | null;
  source: AllowAvailableUninstallSource;
  graphReadStatus: AllowAvailableUninstallGraphReadStatus;
}

export function logAllowAvailableUninstallDecision(entry: AllowAvailableUninstallAuditEntry): void {
  const payload: Record<string, string | boolean | null> = {
    updateMode: entry.updateMode,
    allowAvailableUninstall: entry.allowAvailableUninstall,
    source: entry.source,
    graphReadStatus: entry.graphReadStatus,
  };
  if (entry.jobId) {
    payload.jobId = logValue(entry.jobId, 128);
  }
  if (entry.policyId) {
    payload.policyId = logValue(entry.policyId, 128);
  }
  if (entry.wingetId) {
    payload.wingetId = logValue(entry.wingetId, 128);
  }
  console.info('[allow-available-uninstall]', payload);
}
