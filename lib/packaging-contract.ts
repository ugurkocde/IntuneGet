export type InstallerContractFamily =
  | 'msi'
  | 'msix'
  | 'portable'
  | 'archive'
  | 'standard-exe'
  | 'vendor-bootstrapper';

export type PackagingContractResult =
  | {
      valid: true;
      family: InstallerContractFamily;
      dependencyMode: 'self-contained' | 'remote-configuration';
    }
  | {
      valid: false;
      family: InstallerContractFamily;
      code:
        | 'unsupported-installer-type'
        | 'archive-contract-incomplete'
        | 'required-argument-missing'
        | 'unsafe-argument-syntax';
      message: string;
    };

export interface PackagingContractInput {
  wingetId: string;
  installerType: string;
  silentArgs: string;
  nestedInstallerType?: string;
  nestedInstallerFiles?: readonly string[];
}

const KNOWN_TYPES = new Set([
  'appx',
  'burn',
  'exe',
  'inno',
  'msi',
  'msix',
  'nullsoft',
  'portable',
  'wix',
  'zip',
]);

const VENDOR_BOOTSTRAPPERS = new Set([
  'microsoft.office',
  'microsoft.visualstudio.2022.community',
  'microsoft.visualstudio.2022.enterprise',
  'microsoft.visualstudio.2022.professional',
  'microsoft.visualstudio.community',
  'microsoft.visualstudio.enterprise',
  'microsoft.visualstudio.professional',
]);

function familyFor(input: PackagingContractInput): InstallerContractFamily {
  const type = input.installerType.trim().toLowerCase();
  if (type === 'msi' || type === 'wix') return 'msi';
  if (type === 'msix' || type === 'appx') return 'msix';
  if (type === 'portable') return 'portable';
  if (type === 'zip') return 'archive';
  if (VENDOR_BOOTSTRAPPERS.has(input.wingetId.trim().toLowerCase())) {
    return 'vendor-bootstrapper';
  }
  return 'standard-exe';
}

/**
 * Validate the semantic installer contract before a package consumes VM time.
 *
 * PSADT can reliably execute a complete vendor command, but it cannot invent a
 * missing operand (for example Office Deployment Tool's configuration XML) or
 * infer an archive's nested installer. This gate deliberately fails closed for
 * those incomplete shapes while allowing vendor-specific arguments to remain
 * intact.
 */
export function evaluatePackagingContract(
  input: PackagingContractInput
): PackagingContractResult {
  const type = input.installerType.trim().toLowerCase();
  const family = familyFor(input);
  const args = input.silentArgs.trim();

  if (!KNOWN_TYPES.has(type)) {
    return {
      valid: false,
      family,
      code: 'unsupported-installer-type',
      message: `Installer type [${input.installerType || 'unknown'}] does not have a tested packaging adapter.`,
    };
  }

  if (/\0|[\r\n]/.test(args)) {
    return {
      valid: false,
      family,
      code: 'unsafe-argument-syntax',
      message: 'Installer arguments contain a null byte or line break.',
    };
  }

  if (family === 'archive') {
    const nestedType = input.nestedInstallerType?.trim().toLowerCase() || '';
    const nestedFiles = (input.nestedInstallerFiles || []).filter((value) => value.trim());
    if (Boolean(nestedType) !== (nestedFiles.length > 0)) {
      return {
        valid: false,
        family,
        code: 'archive-contract-incomplete',
        message: 'Archive package is missing its nested installer type or path.',
      };
    }
  }

  // These switches are commands that require a following file/URL operand.
  // A terminal match means an upstream parser discarded part of the vendor
  // command; running it would at best be a silent no-op.
  if (/(?:^|\s)(?:\/configure|\/config|--config|-config|\/loadinf|\/apply|\/unattend(?:ed)?)(?:\s*)$/i.test(args)) {
    return {
      valid: false,
      family,
      code: 'required-argument-missing',
      message: 'A vendor configuration switch is missing its required file or URL operand.',
    };
  }

  if (input.wingetId.trim().toLowerCase() === 'microsoft.office') {
    const officeConfiguration = args.match(/(?:^|\s)\/configure\s+("[^"]+"|'[^']+'|\S+)/i)?.[1];
    if (!officeConfiguration) {
      return {
        valid: false,
        family,
        code: 'required-argument-missing',
        message: 'Microsoft Office requires an Office Deployment Tool configuration file or URL.',
      };
    }
    return {
      valid: true,
      family,
      dependencyMode: /^['"]?https:\/\//i.test(officeConfiguration)
        ? 'remote-configuration'
        : 'self-contained',
    };
  }

  return { valid: true, family, dependencyMode: 'self-contained' };
}

export class PackagingContractError extends Error {
  readonly code: Exclude<PackagingContractResult, { valid: true }>['code'];
  readonly family: InstallerContractFamily;

  constructor(result: Exclude<PackagingContractResult, { valid: true }>) {
    super(result.message);
    this.name = 'PackagingContractError';
    this.code = result.code;
    this.family = result.family;
  }
}

export function assertPackagingContract(input: PackagingContractInput): void {
  const result = evaluatePackagingContract(input);
  if (!result.valid) throw new PackagingContractError(result);
}
