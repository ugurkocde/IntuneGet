const operators = new Set(['equal', 'notEqual', 'greaterThan', 'greaterThanOrEqual', 'lessThan', 'lessThanOrEqual']);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function canUseCustomDetection(input: {
  wingetId?: string; sourceType?: string; installerType?: string; nestedInstallerType?: string;
}): boolean {
  return input.sourceType !== 'custom' && input.sourceType !== 'curated' &&
    !(input.wingetId || '').toLowerCase().startsWith('intuneget.curated.') &&
    !['msix', 'appx'].includes((input.nestedInstallerType || input.installerType || '').toLowerCase());
}

/** Validate only the explicitly opted in declarative rule contract. */
export function validateCustomDetectionRules(rules: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(rules) || rules.length === 0) return { valid: false, errors: ['Add at least one custom detection rule.'] };
  rules.forEach((value, index) => {
    const fail = (message: string) => errors.push(`Rule ${index + 1}: ${message}`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) { fail('Invalid rule.'); return; }
    const r = value as Record<string, unknown>;
    if (r.type === 'msi') {
      if (typeof r.productCode !== 'string' || !/^\{[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\}$/i.test(r.productCode)) fail('Enter a valid MSI product code.');
      if (r.productVersionOperator !== undefined && (!operators.has(String(r.productVersionOperator)) || !nonempty(r.productVersion))) fail('Select a version operator and value.');
      if (r.productVersion !== undefined && r.productVersionOperator === undefined) fail('Select a version operator.');
      return;
    }
    if (r.type !== 'file' && r.type !== 'registry') { fail('Only registry, file and MSI rules are supported.'); return; }
    if (r.type === 'file' && (!nonempty(r.path) || !nonempty(r.fileOrFolderName))) fail('Enter a path and file or folder name.');
    if (r.type === 'registry' && !nonempty(r.keyPath)) fail('Enter a registry key path.');
    if (r.valueName !== undefined && typeof r.valueName !== 'string') fail('Invalid registry value name.');
    if (r.check32BitOn64System !== undefined && typeof r.check32BitOn64System !== 'boolean') fail('Invalid architecture setting.');
    const types = r.type === 'file' ? ['exists', 'notExists', 'version', 'sizeInMB'] : ['exists', 'notExists', 'string', 'integer', 'version'];
    if (!types.includes(String(r.detectionType))) fail('Select a supported detection type.');
    else if (!['exists', 'notExists'].includes(String(r.detectionType)) && (!operators.has(String(r.operator)) || !nonempty(r.detectionValue))) fail('Select an operator and comparison value.');
    else if (r.detectionType === 'integer' && !/^-?\d+$/.test(String(r.detectionValue))) fail('Enter a whole number.');
    else if (r.detectionType === 'sizeInMB' && !/^\d+$/.test(String(r.detectionValue))) fail('Enter a nonnegative whole number of MiB.');
    else if (r.detectionType === 'version' && !/^\d+(\.\d+){1,3}$/.test(String(r.detectionValue))) fail('Enter a version such as 1.2.3.');
  });
  return { valid: errors.length === 0, errors };
}

export function customDetectionUpdateHold(version: string): string {
  return `Custom detection rules are fixed. Deploy ${version} from the catalog with updated rules.`;
}
