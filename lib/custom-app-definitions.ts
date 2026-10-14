import type { CustomAppInput } from './custom-app';

export type CustomAppDefinition = Omit<CustomAppInput, 'version' | 'installerUrl' | 'sha256'>;
export interface SavedCustomAppDefinition {
  id: string;
  user_id: string;
  tenant_id: string;
  definition: CustomAppDefinition;
  created_at: string;
  updated_at: string;
}

const fields = ['displayName', 'publisher', 'installerType', 'architecture', 'installScope', 'silentSwitches', 'uninstallCommand', 'description', 'iconUrl'] as const;
const optional = new Set<string>(['silentSwitches', 'uninstallCommand', 'description', 'iconUrl']);

/** Validate static metadata only. Version, installer URLs and hashes are never saved. */
export function parseCustomAppDefinition(value: unknown): CustomAppDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid definition');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !fields.includes(key as typeof fields[number]))) throw new Error('Unknown definition field');
  const result: Record<string, string> = {};
  for (const key of fields) {
    if (input[key] === undefined && optional.has(key)) continue;
    if (typeof input[key] !== 'string') throw new Error('Invalid definition field');
    const text = input[key].trim();
    if ((!text && !optional.has(key)) || text.includes('\0') || !text.isWellFormed() || text.length > (key === 'description' ? 4000 : 2048)) throw new Error('Invalid definition field');
    result[key] = text;
  }
  if (!['exe', 'msi', 'inno', 'nullsoft', 'burn'].includes(result.installerType) || !['x64', 'x86', 'arm64'].includes(result.architecture) || !['user', 'machine'].includes(result.installScope)) throw new Error('Invalid definition options');
  if (result.installerType === 'exe' && !result.silentSwitches) throw new Error('Silent switches are required');
  if (result.iconUrl) {
    try { if (new URL(result.iconUrl).protocol !== 'https:') throw new Error(); }
    catch { throw new Error('Icon URL must use HTTPS'); }
  }
  return result as unknown as CustomAppDefinition;
}

/** Loading a saved definition always requires fresh version and installer evidence. */
export function customAppVersionInput(definition: CustomAppDefinition): CustomAppInput {
  return { ...parseCustomAppDefinition(definition), version: '', installerUrl: '', sha256: '' };
}
