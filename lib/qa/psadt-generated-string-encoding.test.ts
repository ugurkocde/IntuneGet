import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { char, summarizePowerShell, type PowerShellAstSummary } from '@/lib/__tests__/powershell-ast-helper';

// Security hardening of generated PowerShell: every value the hosted packager
// embeds into Invoke-AppDeployToolkit.ps1 must parse back to exactly the
// configured value, and must never add AST nodes compared with a plain value.

const packagerPath = resolve(process.cwd(), '.github/scripts/Create-PSADTPackage.ps1');

const canRunHostedPackager =
  process.platform === 'win32' &&
  spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { timeout: 30_000 }).status === 0;

const quotes = [0x27, 0x2018, 0x2019, 0x201a, 0x201b, 0x22, 0x201c, 0x201d, 0x201e].map(char).join('');
// One line with every quote variant, backtick escapes, subexpressions,
// variables and block comment delimiters.
const LINE = `q${quotes} tick\`t\`$ $(Get-Date) \${env:TEMP} $HOME <# c #>`;
// The same with line breaks and here-string terminators at the start of a line.
const MULTILINE = `${LINE}\n'@\n"@\nend`;
// Values whose validators reject quotes, path separators or control characters.
const withoutFileNameCharacters = (value: string) => value.replace(/[\x00-\x1F\x7F\\/:*?"<>|]/g, '');

type Variant = 'benign' | 'adversarial';

interface HostedScenario {
  installerType: string;
  installerFileName: string;
  displayName: string;
  publisher: string;
  version: string;
  wingetId: string;
  silentSwitches: string;
  uninstallCommand: string;
  installScope?: 'machine' | 'user';
  nestedInstallerType?: string;
  nestedInstallerPath?: string;
  psadtConfig?: Record<string, unknown>;
  packageDependencies?: Array<Record<string, unknown>>;
}

interface HostedOutput {
  script: string;
  config: string;
  strings: string;
}

const PSD1_FIXTURES = {
  config: "@{\r\n    Toolkit = @{\r\n        CompanyName = 'PSAppDeployToolkit'\r\n    }\r\n}\r\n",
  strings: "@{\r\n    CloseAppsPrompt = @{\r\n        CustomMessage = ''\r\n    }\r\n}\r\n",
};

function runHostedPackager(scenario: HostedScenario): HostedOutput {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'intuneget-psadt-encoding-'));
  try {
    for (const directory of ['psadt/PSAppDeployToolkit', 'psadt/Config', 'psadt/Strings', 'psadt/Assets']) {
      mkdirSync(join(fixtureRoot, directory), { recursive: true });
    }
    writeFileSync(join(fixtureRoot, 'psadt/Config/Config.psd1'), PSD1_FIXTURES.config);
    writeFileSync(join(fixtureRoot, 'psadt/Strings/strings.psd1'), PSD1_FIXTURES.strings);
    writeFileSync(join(fixtureRoot, 'psadt/Invoke-AppDeployToolkit.exe'), 'fixture');
    writeFileSync(
      join(fixtureRoot, 'Send-Callback.ps1'),
      'function Send-Callback { param($Body, $CallbackUrl, $CallbackSecret) return $null }'
    );
    // The installer copied into the package keeps a plain name; the name that
    // is embedded into the script comes from INSTALLER_FILENAME.
    const installerPath = join(fixtureRoot, 'fixture-installer.bin');
    writeFileSync(installerPath, 'fixture');
    const dependencies = scenario.packageDependencies ?? [];
    const dependencyPath = join(fixtureRoot, 'dependencies');
    if (dependencies.length > 0) {
      mkdirSync(dependencyPath, { recursive: true });
      for (const dependency of dependencies) {
        writeFileSync(join(dependencyPath, String(dependency.fileName)), 'dependency-fixture');
      }
    }

    const result = spawnSync('pwsh', ['-NoProfile', '-File', packagerPath], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      // spawnSync blocks the event loop, so the test timeout cannot stop a hung pwsh.
      timeout: 90_000,
      env: {
        ...process.env,
        GITHUB_WORKSPACE: fixtureRoot,
        INPUT_JOB_ID: 'encoding-test',
        INPUT_CALLBACK_URL: 'https://example.invalid/callback',
        INPUT_DISPLAY_NAME: scenario.displayName,
        INPUT_PUBLISHER: scenario.publisher,
        INPUT_VERSION: scenario.version,
        INPUT_WINGET_ID: scenario.wingetId,
        INPUT_INSTALLER_TYPE: scenario.installerType,
        INPUT_INSTALL_SCOPE: scenario.installScope ?? 'machine',
        INPUT_NESTED_INSTALLER_TYPE: scenario.nestedInstallerType ?? '',
        INPUT_NESTED_INSTALLER_PATH: scenario.nestedInstallerPath ?? '',
        INPUT_SILENT_SWITCHES: scenario.silentSwitches,
        INPUT_INSTALLER_SUCCESS_CODES: '[]',
        INPUT_PACKAGE_DEPENDENCIES: JSON.stringify(dependencies),
        INPUT_UNINSTALL_COMMAND: scenario.uninstallCommand,
        INSTALLER_PATH: installerPath,
        INSTALLER_FILENAME: scenario.installerFileName,
        PSADT_CONFIG: JSON.stringify(scenario.psadtConfig ?? {}),
        ...(dependencies.length > 0 ? { DEPENDENCIES_PATH: dependencyPath } : {}),
      },
    });
    if (result.status !== 0) {
      throw new Error(`Packager fixture failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
    }
    const read = (path: string) => readFileSync(join(fixtureRoot, 'package', path), 'utf8');
    return {
      script: read('Invoke-AppDeployToolkit.ps1'),
      config: read('Config/Config.psd1'),
      strings: read('Strings/strings.psd1'),
    };
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

/**
 * Runs a scenario with plain values and with adversarial values, then checks
 * that the adversarial script parses, has the same AST shape and comment
 * count, and contains every expected string value exactly.
 */
function expectExactEmbedding(
  build: (value: (field: string, adversarial: string) => string, variant: Variant) => HostedScenario,
  expectedStrings: (variant: Variant) => string[],
  files: Array<keyof HostedOutput> = ['script']
): void {
  const outputs = (['benign', 'adversarial'] as const).map((variant) =>
    runHostedPackager(build(
      (field, adversarial) => (variant === 'benign' ? `${field} plain` : `${field} ${adversarial}`),
      variant
    ))
  );
  const sources = outputs.flatMap((output) => files.map((file) => output[file]));
  const summaries = summarizePowerShell(sources);
  const benign = summaries.slice(0, files.length);
  const adversarial = summaries.slice(files.length);

  const allStrings = (summary: PowerShellAstSummary[]) => summary.flatMap((entry) => entry.strings);
  files.forEach((file, index) => {
    expect(benign[index].errors, file).toEqual([]);
    expect(adversarial[index].errors, file).toEqual([]);
    expect(adversarial[index].shape, file).toEqual(benign[index].shape);
    expect(adversarial[index].comments.length, file).toBe(benign[index].comments.length);
  });
  for (const expected of expectedStrings('benign')) {
    expect(allStrings(benign), JSON.stringify(expected)).toContain(expected);
  }
  for (const expected of expectedStrings('adversarial')) {
    expect(allStrings(adversarial), JSON.stringify(expected)).toContain(expected);
  }
}

const value = (variant: Variant, field: string, adversarial: string) =>
  variant === 'benign' ? `${field} plain` : `${field} ${adversarial}`;
const collapse = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();

describe.runIf(canRunHostedPackager)('hosted PSADT generator string encoding', () => {
  it('embeds application identity, uninstall command and UI text exactly', () => {
    expectExactEmbedding(
      (v) => ({
        installerType: 'exe',
        installerFileName: 'setup.exe',
        displayName: v('Name', MULTILINE),
        publisher: v('Vendor', MULTILINE),
        version: v('1.0', MULTILINE),
        wingetId: v('Contoso.App', LINE).replace(/ /g, ''),
        silentSwitches: '/S',
        uninstallCommand: v('"C:\\Program Files\\Contoso\\uninstall.exe" /S', MULTILINE),
        psadtConfig: {
          verifyInstall: true,
          removeExistingInstall: true,
          registryMarkerPath: v('SOFTWARE\\Contoso', LINE),
          processesToClose: [{ name: v('proc', withoutFileNameCharacters(LINE)), description: v('Proc', LINE) }],
          showClosePrompt: true,
          progressDialog: { enabled: true, statusMessage: v('Status', MULTILINE) },
          customPrompts: ['pre-install', 'post-install', 'pre-uninstall', 'post-uninstall'].map((timing) => ({
            enabled: true,
            timing,
            title: v(`Title ${timing}`, MULTILINE),
            message: v(`Message ${timing}`, MULTILINE),
            icon: v('Icon', LINE),
            buttonLeftText: v('Left', LINE),
            buttonMiddleText: v('Middle', LINE),
            buttonRightText: v('Right', LINE),
            timeout: 30,
          })),
          balloonTips: ['start', 'end'].map((timing) => ({
            enabled: true,
            timing,
            title: v(`Tip ${timing}`, MULTILINE),
            text: v(`Text ${timing}`, MULTILINE),
            icon: v('TipIcon', LINE),
            displayTime: 5000,
          })),
          restartPrompt: { enabled: true, countdownSeconds: 600, countdownNoHideSeconds: 60 },
          postInstallCommands: [v('echo post-install', MULTILINE)],
          postUninstallCommands: [v('echo post-uninstall', MULTILINE)],
        },
      }),
      (variant) => {
        const marker = value(variant, 'SOFTWARE\\Contoso', LINE).replace(/[*?"'<>|]/g, '');
        const sanitizedId = value(variant, 'Contoso.App', LINE).replace(/ /g, '').replace(/[.-]/g, '_');
        return [
          value(variant, 'Name', MULTILINE),
          value(variant, 'Vendor', MULTILINE),
          value(variant, '1.0', MULTILINE),
          value(variant, 'Contoso.App', LINE).replace(/ /g, ''),
          `HKLM\\${marker}\\${sanitizedId}`,
          value(variant, '"C:\\Program Files\\Contoso\\uninstall.exe" /S', MULTILINE),
          value(variant, 'proc', withoutFileNameCharacters(LINE)),
          value(variant, 'Proc', LINE),
          value(variant, 'Status', MULTILINE),
          ...['pre-install', 'post-install', 'pre-uninstall', 'post-uninstall'].flatMap((timing) => [
            value(variant, `Title ${timing}`, MULTILINE),
            value(variant, `Message ${timing}`, MULTILINE),
          ]),
          value(variant, 'Icon', LINE),
          value(variant, 'Left', LINE),
          value(variant, 'Middle', LINE),
          value(variant, 'Right', LINE),
          ...['start', 'end'].flatMap((timing) => [
            value(variant, `Tip ${timing}`, MULTILINE),
            value(variant, `Text ${timing}`, MULTILINE),
          ]),
          value(variant, 'TipIcon', LINE),
          `/c ${collapse(value(variant, 'echo post-install', MULTILINE))}`,
          `/c ${collapse(value(variant, 'echo post-uninstall', MULTILINE))}`,
          `Post-install verification failed: '${value(variant, 'Name', MULTILINE)}' was not found in the installed applications list. The installer exited without error but the application does not appear to be installed.`,
        ];
      }
    );
  }, 120_000);

  it('embeds silent switches, the uninstall identity and adapter arguments exactly', () => {
    expectExactEmbedding(
      (v) => ({
        installerType: 'exe',
        installerFileName: v('setup', LINE).replace(/[\\/:*?"<>|]/g, '') + '.exe',
        displayName: 'Contoso App',
        publisher: 'Contoso',
        version: '1.0.0',
        wingetId: 'Contoso.App',
        silentSwitches: v('/S', MULTILINE),
        uninstallCommand: `REGISTRY_UNINSTALL:${v('Contoso', LINE)}`,
        psadtConfig: {
          reviewedUninstallArguments: [v('/quiet', LINE)],
          reviewedMultiProductInstallDisplayNamePrefixes: [v('Prefix one', LINE), v('Prefix two', LINE)],
          reviewedMultiProductInstallMinimumCount: 2,
        },
      }),
      (variant) => [
        value(variant, '/S', MULTILINE).trim(),
        value(variant, 'Contoso', LINE),
        value(variant, '/quiet', LINE),
        value(variant, 'Prefix one', LINE),
        value(variant, 'setup', LINE).replace(/[\\/:*?"<>|]/g, '') + '.exe',
      ]
    );
  }, 120_000);

  it('embeds the installer file name exactly in double-quoted user-scope paths', () => {
    expectExactEmbedding(
      (v) => ({
        installerType: 'exe',
        installerFileName: v('setup', MULTILINE) + '.exe',
        displayName: 'Contoso App',
        publisher: 'Contoso',
        version: '1.0.0',
        wingetId: 'Contoso.App',
        silentSwitches: '/S',
        installScope: 'user',
        uninstallCommand: 'REGISTRY_UNINSTALL:Contoso App',
      }),
      (variant) => [`$($adtSession.DirFiles)\\${value(variant, 'setup', MULTILINE)}.exe`]
    );
  }, 120_000);

  it('embeds MSI properties, the MSI file name and the uninstall override exactly', () => {
    expectExactEmbedding(
      (v) => ({
        installerType: 'msi',
        installerFileName: v('setup', LINE).replace(/[\\/:*?"<>|]/g, '') + '.exe',
        displayName: 'Contoso App',
        publisher: 'Contoso',
        version: '1.0.0',
        wingetId: 'Contoso.App',
        silentSwitches: `/qn ${v('PROPERTY=1', MULTILINE)}`,
        uninstallCommand: `REGISTRY_UNINSTALL_PRODUCT:{12345678-1234-1234-1234-123456789ABC}:${v('Contoso', LINE)}`,
        psadtConfig: { uninstallCommand: v('msiexec /x', MULTILINE) },
      }),
      (variant) => [
        value(variant, 'PROPERTY=1', MULTILINE).trim(),
        value(variant, 'setup', LINE).replace(/[\\/:*?"<>|]/g, '') + '.exe',
        `/c ${value(variant, 'msiexec /x', MULTILINE)}`,
      ]
    );
  }, 120_000);

  it('embeds the nested installer path and switches of a ZIP package exactly', () => {
    const nestedPath = (v: (field: string, adversarial: string) => string) =>
      `Payload\\${v('setup', LINE).replace(/[:*?"<>|]/g, '')}.exe`;
    expectExactEmbedding(
      (v) => ({
        installerType: 'zip',
        installerFileName: v('archive', LINE).replace(/[\\/:*?"<>|]/g, '') + '.zip',
        displayName: 'Contoso App',
        publisher: 'Contoso',
        version: '1.0.0',
        wingetId: 'Contoso.App',
        silentSwitches: v('/S', LINE),
        installScope: 'user',
        nestedInstallerType: 'exe',
        nestedInstallerPath: nestedPath(v),
        uninstallCommand: 'REGISTRY_UNINSTALL:Contoso App',
      }),
      (variant) => {
        const v = (field: string, adversarial: string) => value(variant, field, adversarial);
        return [
          nestedPath(v),
          `Nested installer not found in archive: ${nestedPath(v)}`,
          v('/S', LINE),
          `$($adtSession.DirFiles)\\${v('archive', LINE).replace(/[\\/:*?"<>|]/g, '')}.zip`,
        ];
      }
    );
  }, 120_000);

  it('embeds the MSI properties of a nested ZIP installer exactly', () => {
    expectExactEmbedding(
      (v) => ({
        installerType: 'zip',
        installerFileName: 'archive.zip',
        displayName: 'Contoso App',
        publisher: 'Contoso',
        version: '1.0.0',
        wingetId: 'Contoso.App',
        silentSwitches: `/qn ${v('PROPERTY=1', MULTILINE)}`,
        nestedInstallerType: 'msi',
        nestedInstallerPath: 'setup.msi',
        uninstallCommand: 'REGISTRY_UNINSTALL:Contoso App',
      }),
      (variant) => [value(variant, 'PROPERTY=1', MULTILINE).trim()]
    );
  }, 120_000);

  it('embeds Inno Setup switches and portable names exactly', () => {
    expectExactEmbedding(
      (v) => ({
        installerType: 'inno',
        installerFileName: 'setup.exe',
        displayName: 'Contoso App',
        publisher: 'Contoso',
        version: '1.0.0',
        wingetId: 'Contoso.App',
        silentSwitches: v('/VERYSILENT', MULTILINE),
        uninstallCommand: 'REGISTRY_UNINSTALL:Contoso App',
      }),
      (variant) => [`${value(variant, '/VERYSILENT', MULTILINE).trim()} /SP-`]
    );
    expectExactEmbedding(
      (v) => ({
        installerType: 'portable',
        installerFileName: v('tool', MULTILINE) + '.exe',
        displayName: v('Portable', LINE),
        publisher: 'Contoso',
        version: '1.0.0',
        wingetId: 'Contoso.Portable',
        silentSwitches: '',
        uninstallCommand: '',
      }),
      (variant) => [
        `$($adtSession.DirFiles)\\${value(variant, 'tool', MULTILINE)}.exe`,
        `${value(variant, 'tool', MULTILINE)}.exe`,
        value(variant, 'Portable', LINE).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'),
      ]
    );
  }, 120_000);

  it('embeds bundled dependency versions and arguments exactly', () => {
    expectExactEmbedding(
      (v) => ({
        installerType: 'exe',
        installerFileName: 'setup.exe',
        displayName: 'Contoso App',
        publisher: 'Contoso',
        version: '1.0.0',
        wingetId: 'Contoso.App',
        silentSwitches: '/S',
        uninstallCommand: 'REGISTRY_UNINSTALL:Contoso App',
        packageDependencies: [{
          packageIdentifier: 'Microsoft.PowerShell',
          version: v('7.4.0', MULTILINE),
          fileName: 'PowerShell.msi',
          installerSha256: createHashOfFixture(),
          installerType: 'msi',
          silentArgs: v('/qn', MULTILINE),
          successCodes: [0],
          rebootCodes: [3010],
          order: 1,
        }],
      }),
      (variant) => [
        `Installing bundled dependency [Microsoft.PowerShell] version [${value(variant, '7.4.0', MULTILINE)}].`,
        value(variant, '/qn', MULTILINE),
      ]
    );
  }, 120_000);

  it('writes branding values into the PSADT data files exactly', () => {
    expectExactEmbedding(
      (v) => ({
        installerType: 'exe',
        installerFileName: 'setup.exe',
        displayName: 'Contoso App',
        publisher: 'Contoso',
        version: '1.0.0',
        wingetId: 'Contoso.App',
        silentSwitches: '/S',
        uninstallCommand: 'REGISTRY_UNINSTALL:Contoso App',
        psadtConfig: {
          brandingCompanyName: v('Company', MULTILINE),
          brandingWelcomeMessage: v('Welcome', MULTILINE),
        },
      }),
      (variant) => [value(variant, 'Company', MULTILINE), value(variant, 'Welcome', MULTILINE)],
      ['script', 'config', 'strings']
    );
  }, 120_000);

  it('rejects a non-numeric prompt timeout instead of embedding it', () => {
    expect(() => runHostedPackager({
      installerType: 'exe',
      installerFileName: 'setup.exe',
      displayName: 'Contoso App',
      publisher: 'Contoso',
      version: '1.0.0',
      wingetId: 'Contoso.App',
      silentSwitches: '/S',
      uninstallCommand: 'REGISTRY_UNINSTALL:Contoso App',
      psadtConfig: {
        customPrompts: [{ enabled: true, timing: 'pre-install', title: 'T', message: 'M', icon: 'None', timeout: '30; Write-Host x' }],
      },
    })).toThrow(/customPrompts\.timeout must be a whole number/);
  }, 120_000);
});

function createHashOfFixture(): string {
  // Matches the dependency fixture content written by runHostedPackager.
  return createHash('sha256').update('dependency-fixture').digest('hex').toUpperCase();
}
