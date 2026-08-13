import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packager = readFileSync(
  resolve(process.cwd(), '.github/scripts/Create-PSADTPackage.ps1'),
  'utf8'
);

const hostedPackager = readFileSync(
  resolve(process.cwd(), 'packager/src/job-processor.ts'),
  'utf8'
);

const packagerPath = resolve(
  process.cwd(),
  '.github/scripts/Create-PSADTPackage.ps1'
);

const canRunWindowsPowerShellPackager =
  process.platform === 'win32' &&
  spawnSync('pwsh', [
    '-NoProfile',
    '-Command',
    '$PSVersionTable.PSVersion.ToString()',
  ]).status === 0;

function generateRegistryUninstallPackage(
  installerType: 'inno' | 'burn',
  displayName = 'Contract Test App',
  installerSuccessCodes: number[] = [],
  psadtConfig: unknown = {},
  packageDependencies: Array<Record<string, unknown>> = [],
  wingetId = 'IntuneGet.ContractTest',
  uninstallDisplayName = displayName
): string {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'intuneget-psadt-packager-'));

  try {
    for (const directory of [
      'psadt/PSAppDeployToolkit',
      'psadt/Config',
      'psadt/Strings',
      'psadt/Assets',
    ]) {
      mkdirSync(join(fixtureRoot, directory), { recursive: true });
    }

    const installerPath = join(fixtureRoot, 'setup.exe');
    writeFileSync(installerPath, 'fixture');
    writeFileSync(join(fixtureRoot, 'psadt/Invoke-AppDeployToolkit.exe'), 'fixture');
    writeFileSync(
      join(fixtureRoot, 'Send-Callback.ps1'),
      'function Send-Callback { param($Body, $CallbackUrl, $CallbackSecret) return $null }'
    );
    const dependencyPath = join(fixtureRoot, 'dependencies');
    if (packageDependencies.length > 0) {
      mkdirSync(dependencyPath, { recursive: true });
      for (const dependency of packageDependencies) {
        writeFileSync(
          join(dependencyPath, String(dependency.fileName)),
          'dependency-fixture'
        );
      }
    }

    const result = spawnSync('pwsh', ['-NoProfile', '-File', packagerPath], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_WORKSPACE: fixtureRoot,
        INPUT_JOB_ID: 'contract-test',
        INPUT_CALLBACK_URL: 'https://example.invalid/callback',
        INPUT_DISPLAY_NAME: displayName,
        INPUT_PUBLISHER: 'IntuneGet',
        INPUT_VERSION: '1.0.0',
        INPUT_WINGET_ID: wingetId,
        INPUT_INSTALLER_TYPE: installerType,
        INPUT_INSTALL_SCOPE: 'machine',
        INPUT_SILENT_SWITCHES: '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
        INPUT_INSTALLER_SUCCESS_CODES: JSON.stringify(installerSuccessCodes),
        INPUT_PACKAGE_DEPENDENCIES: JSON.stringify(packageDependencies),
        INPUT_UNINSTALL_COMMAND: `REGISTRY_UNINSTALL:${uninstallDisplayName}`,
        INSTALLER_PATH: installerPath,
        INSTALLER_FILENAME: 'setup.exe',
        ...(packageDependencies.length > 0
          ? { DEPENDENCIES_PATH: dependencyPath }
          : {}),
        PSADT_CONFIG: JSON.stringify(psadtConfig),
      },
    });

    if (result.status !== 0) {
      throw new Error(
        `Packager fixture failed (${result.status}):\n${result.stdout}\n${result.stderr}`
      );
    }

    const generatedPath = join(
      fixtureRoot,
      'package',
      'Invoke-AppDeployToolkit.ps1'
    );
    const parseResult = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        '$tokens=$null; $errors=$null; [System.Management.Automation.Language.Parser]::ParseFile($env:TARGET_SCRIPT,[ref]$tokens,[ref]$errors) | Out-Null; if ($errors.Count) { $errors | ForEach-Object { $_.ToString() }; exit 1 }',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, TARGET_SCRIPT: generatedPath },
      }
    );

    if (parseResult.status !== 0) {
      throw new Error(
        `Generated deployment script did not parse:\n${parseResult.stdout}\n${parseResult.stderr}`
      );
    }

    return readFileSync(generatedPath, 'utf8');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

describe('PSADT Inno packaging contract', () => {
  it('does not inject diagnostic switches into the vendor command line', () => {
    const innoBlock = packager.slice(
      packager.indexOf("if ($installerTypeLower -eq 'inno')"),
      packager.indexOf('switch ($installerTypeLower)')
    );

    expect(innoBlock).not.toContain('/LOG=');
    expect(innoBlock).not.toContain('IntuneGet-Inno-Install.log');
    expect(innoBlock).toContain("$installerArgumentList = \"'$innoSwitchesEscaped'\"");
  });

  it('keeps the startup-prompt suppression idempotent without format-string expansion', () => {
    const innoBlock = packager.slice(
      packager.indexOf("if ($installerTypeLower -eq 'inno')"),
      packager.indexOf('switch ($installerTypeLower)')
    );

    expect(innoBlock).toContain("$innoSwitches -notmatch '(?i)(^|\\s)/SP-(\\s|$)'");
    expect(innoBlock).not.toMatch(/\s-f\s/);
    expect(innoBlock).not.toContain("-replace '`', '``'");
    expect(innoBlock).not.toContain("-replace '\\$', '`$'");
  });
});

describe('PSADT vendor argument contract', () => {
  it.runIf(canRunWindowsPowerShellPackager)(
    'retains reviewed shared runtimes and removes only the IntuneGet marker',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Microsoft Edge WebView2 Runtime',
        [],
        { preserveVendorInstallationOnUninstall: true },
        [],
        'Microsoft.EdgeWebView2Runtime'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );
      const installFunction = generated.slice(
        generated.indexOf('function Install-ADTDeployment'),
        generated.indexOf('function Uninstall-ADTDeployment')
      );

      expect(installFunction).toContain(
        '$sharedRuntimeMatches = @($postInstallApplications | Where-Object {'
      );
      expect(installFunction).toContain(
        '$previousApplication.DisplayVersion -ne $candidateApplication.DisplayVersion'
      );
      expect(installFunction).toContain(
        '[string]$candidateApplication.DisplayName -eq $configuredUninstallDisplayName'
      );
      expect(installFunction).toContain(
        '[version]::TryParse($installedVersionText, [ref]$installedVersion)'
      );
      expect(installFunction).toContain('$installedVersion -ge $requestedVersion');
      expect(installFunction).toContain(
        'Reusing already-installed shared runtime identity'
      );
      expect(uninstallFunction).toContain(
        'Retaining the shared vendor installation and removing only the IntuneGet management marker.'
      );
      expect(uninstallFunction).toContain('IntuneGet detection marker removed from HKLM');
      expect(uninstallFunction).not.toContain('Waiting for vendor uninstall registration');
      expect(uninstallFunction).not.toContain('Start-ADTProcess @uninstallProcessParameters');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'does not reuse unchanged uninstall entries for ordinary applications',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Ordinary Application'
      );

      expect(generated).not.toContain('$sharedRuntimeMatches');
      expect(generated).not.toContain('Reusing already-installed shared runtime identity');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'verifies a reviewed multi-product runtime without weakening ordinary identity selection',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Visual C++ Redistributable AIO',
        [],
        {
          preserveVendorInstallationOnUninstall: true,
          reviewedMultiProductInstallDisplayNamePrefixes: [
            'Microsoft Visual C++',
            'Visual C++',
          ],
          reviewedMultiProductInstallMinimumCount: 10,
        },
        [],
        'abbodi1406.vcredist'
      );
      const installFunction = generated.slice(
        generated.indexOf('function Install-ADTDeployment'),
        generated.indexOf('function Uninstall-ADTDeployment')
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(installFunction).toContain(
        "$reviewedMultiProductPrefixes = @('Microsoft Visual C++', 'Visual C++')"
      );
      expect(installFunction).toContain('$reviewedMultiProductMatches.Count -ge 10');
      expect(installFunction).toContain(
        'if ($multiProductInstallationVerified) { break }'
      );
      expect(installFunction).toContain('Verified reviewed multi-product installation');
      expect(uninstallFunction).toContain(
        'Retaining the shared vendor installation and removing only the IntuneGet management marker.'
      );
      expect(uninstallFunction).not.toContain('Could not find one unambiguous vendor uninstall');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects malformed reviewed multi-product evidence',
    () => {
      expect(() =>
        generateRegistryUninstallPackage(
          'inno',
          'Unsafe Multi Product',
          [],
          {
            reviewedMultiProductInstallDisplayNamePrefixes: [''],
            reviewedMultiProductInstallMinimumCount: 2,
          }
        )
      ).toThrow('reviewed multi-product display-name prefix must be non-empty');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'requires a bounded evidence threshold for reviewed multi-product installs',
    () => {
      expect(() =>
        generateRegistryUninstallPackage(
          'inno',
          'Unsafe Multi Product Threshold',
          [],
          {
            reviewedMultiProductInstallDisplayNamePrefixes: ['Visual C++'],
            reviewedMultiProductInstallMinimumCount: 1,
          }
        )
      ).toThrow('reviewedMultiProductInstallMinimumCount must be an integer from 2 to 100');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects a non-boolean shared-runtime lifecycle flag',
    () => {
      expect(() =>
        generateRegistryUninstallPackage(
          'inno',
          'Invalid Shared Runtime',
          [],
          { preserveVendorInstallationOnUninstall: 'true' }
        )
      ).toThrow('preserveVendorInstallationOnUninstall must be a JSON boolean');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses a reviewed exact vendor command while retaining ARP completion verification',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Opera Stable',
        [],
        {
          reviewedExactUninstall: {
            executablePath: '%ProgramFiles%\\Opera\\opera.exe',
            arguments: ['--uninstall', '--runimmediately', '--deleteuserprofile=0'],
            completionTimeoutMinutes: 5,
          },
        },
        [],
        'Opera.Opera'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles%\\Opera\\opera.exe')"
      );
      expect(uninstallFunction).toContain(
        "$registeredUninstallArguments = @('--uninstall', '--runimmediately', '--deleteuserprofile=0')"
      );
      expect(uninstallFunction).toContain(
        '$effectiveUninstallCompletionTimeoutMinutes = if ($useReviewedExactUninstall) { 5 }'
      );
      expect(uninstallFunction).toContain(
        'Waiting for vendor uninstall registration [$registeredUninstallRegistryKey] to be removed.'
      );
      expect(uninstallFunction).not.toContain('Using reviewed managed-directory removal');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses the hash-verified packaged installer for a reviewed vendor removal lifecycle',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Dell Optimizer',
        [],
        {
          reviewedExactUninstall: {
            executablePath: '%PackageInstaller%',
            arguments: ['/passthrough', '/silent', '/remove'],
            completionTimeoutMinutes: 10,
          },
        },
        [],
        'Dell.Optimizer'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "$registeredUninstallFile = Join-Path $adtSession.DirFiles 'setup.exe'"
      );
      expect(uninstallFunction).toContain(
        "$registeredUninstallArguments = @('/passthrough', '/silent', '/remove')"
      );
      expect(uninstallFunction).toContain(
        '$effectiveUninstallCompletionTimeoutMinutes = if ($useReviewedExactUninstall) { 10 }'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'verifies and removes a reviewed self-extracted managed directory without ARP capture',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Office Deployment Tool',
        [],
        { reviewedManagedInstallDirectory: '%ProgramW6432%\\OfficeDeploymentTool' },
        [],
        'Microsoft.OfficeDeploymentTool'
      );
      const installFunction = generated.slice(
        generated.indexOf('function Install-ADTDeployment'),
        generated.indexOf('function Uninstall-ADTDeployment')
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(installFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramW6432%\\OfficeDeploymentTool')"
      );
      expect(installFunction).toContain('Verified managed extracted payload');
      expect(installFunction).not.toContain('Captured vendor uninstall entry');
      expect(uninstallFunction).toContain('Remove-Item -LiteralPath $managedInstallDirectory');
      expect(uninstallFunction).not.toContain('Waiting for vendor uninstall registration');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'verifies and removes the reviewed HP Image Assistant SWSetup payload',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'HP Image Assistant',
        [],
        { reviewedManagedInstallDirectory: '%SystemDrive%\\SWSetup\\HPImageAssistant' },
        [],
        'HP.ImageAssistant'
      );
      const installFunction = generated.slice(
        generated.indexOf('function Install-ADTDeployment'),
        generated.indexOf('function Uninstall-ADTDeployment')
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(installFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%SystemDrive%\\SWSetup\\HPImageAssistant')"
      );
      expect(installFunction).toContain('Verified managed extracted payload');
      expect(installFunction).not.toContain('Captured vendor uninstall entry');
      expect(uninstallFunction).toContain('Remove-Item -LiteralPath $managedInstallDirectory');
      expect(uninstallFunction).not.toContain('Waiting for vendor uninstall registration');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects an unsafe reviewed managed install directory',
    () => {
      expect(() =>
        generateRegistryUninstallPackage(
          'inno',
          'Unsafe Extractor',
          [],
          { reviewedManagedInstallDirectory: '%ProgramFiles%\\..\\Windows' }
        )
      ).toThrow('must be a safe path below Program Files');
      expect(() =>
        generateRegistryUninstallPackage(
          'exe',
          'Unsafe System Drive Extractor',
          [],
          { reviewedManagedInstallDirectory: '%SystemDrive%\\Windows' }
        )
      ).toThrow('must be a safe path below Program Files');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses a reviewed vendor command for a managed installation instance',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Visual Studio BuildTools 2026',
        [],
        {
          reviewedManagedInstallDirectory:
            '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\BuildTools',
          reviewedManagedUninstall: {
            executablePath:
              '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
            arguments: [
              'uninstall',
              '--installPath',
              '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\BuildTools',
              '--quiet',
              '--norestart',
            ],
            completionTimeoutMinutes: 15,
          },
        },
        [],
        'Microsoft.VisualStudio.BuildTools'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe')"
      );
      expect(uninstallFunction).toContain(
        "$managedUninstallArguments = @('uninstall', '--installPath', '%ProgramFiles(x86)%\\Microsoft Visual Studio\\18\\BuildTools', '--quiet', '--norestart')"
      );
      expect(uninstallFunction).toContain(
        '$managedUninstallDeadline = [DateTime]::UtcNow.AddMinutes(15)'
      );
      expect(uninstallFunction).not.toContain(
        'Remove-Item -LiteralPath $managedInstallDirectory'
      );
    }
  );

  it('honors additional success exit codes declared by the WinGet manifest', () => {
    if (!canRunWindowsPowerShellPackager) return;
    const generated = generateRegistryUninstallPackage(
      'inno',
      'Exit Code Contract App',
      [1168]
    );
    expect(generated).toContain('AppSuccessExitCodes = @(0, 1168)');
  });

  it('does not rewrite dollar signs or backticks in generic silent switches', () => {
    expect(packager).toContain('$silentSwitchesEscaped = $effectiveSilentSwitches -replace "\'", "\'\'"');
    const assignment = packager.match(/^\$silentSwitchesEscaped\s*=.*$/m)?.[0] ?? '';
    expect(assignment).not.toContain("-replace '`'");
    expect(assignment).not.toContain("-replace '\\$'");
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'appends bounded reviewed install arguments to the synthesized vendor command',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Reviewed Install Contract App',
        [],
        { reviewedInstallArguments: ['MY_SPECIAL_MODE=2'] }
      );

      expect(generated).toContain(
        "-ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- MY_SPECIAL_MODE=2'"
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects an unbounded reviewed install argument surface',
    () => {
      expect(() => generateRegistryUninstallPackage(
        'inno',
        'Unsafe Install Contract App',
        [],
        { reviewedInstallArguments: ['x'.repeat(257)] }
      )).toThrow('reviewed install argument must be a non-empty, bounded');
    }
  );
});

describe('PSADT offline dependency contract', () => {
  it.runIf(canRunWindowsPowerShellPackager)(
    'bundles and installs reviewed hash-pinned dependencies before the primary app',
    () => {
      const dependencySha256 = createHash('sha256')
        .update('dependency-fixture')
        .digest('hex')
        .toUpperCase();
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Dependency Contract App',
        [],
        {},
        [{
          packageIdentifier: 'Microsoft.VCRedist.2015+.x64',
          version: '14.51.36210.0',
          fileName: 'Microsoft.VCRedist.2015+.x64-vc_redist.x64.exe',
          installerSha256: dependencySha256,
          installerType: 'exe',
          silentArgs: '/install /quiet /norestart',
          successCodes: [-2147023258, 0, 1638],
          rebootCodes: [1641, 3010],
          order: 1,
        }]
      );

      expect(generated).toContain(
        'Install offline WinGet dependency: Microsoft.VCRedist.2015+.x64 14.51.36210.0'
      );
      expect(generated).toContain(
        "-SuccessExitCodes @(-2147023258, 0, 1638) -RebootExitCodes @(1641, 3010)"
      );
      expect(generated.indexOf('Install offline WinGet dependency')).toBeLessThan(
        generated.indexOf('# Snapshot uninstall entries')
      );
      expect(generated).toContain('$script:DependencyRebootExitCode = 3010');
      expect(generated).toContain(
        'if ($script:UninstallRebootExitCode -or $script:DependencyRebootExitCode)'
      );
    },
    30_000
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'installs a reviewed Wix dependency through explicit silent msiexec',
    () => {
      const dependencySha256 = createHash('sha256')
        .update('dependency-fixture')
        .digest('hex')
        .toUpperCase();
      const generated = generateRegistryUninstallPackage(
        'inno',
        'PowerShell Dependency Contract App',
        [],
        {},
        [{
          packageIdentifier: 'Microsoft.PowerShell',
          version: '7.6.4.0',
          fileName: 'Microsoft.PowerShell-PowerShell-7.6.4-win-x64.msi',
          installerSha256: dependencySha256,
          installerType: 'wix',
          silentArgs: '/qn /norestart',
          successCodes: [0],
          rebootCodes: [1641, 3010],
          order: 1,
        }]
      );

      expect(generated).toContain(
        "Start-ADTProcess -FilePath \"$env:SystemRoot\\System32\\msiexec.exe\""
      );
      expect(generated).toContain(
        "$dependencyArgumentList = '/i \"{0}\" {1}' -f $dependencyPath, '/qn /norestart'"
      );
    },
    30_000
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'extracts and provisions the reviewed Microsoft VCLibs APPX dependency',
    () => {
      const dependencySha256 = createHash('sha256')
        .update('dependency-fixture')
        .digest('hex')
        .toUpperCase();
      const generated = generateRegistryUninstallPackage(
        'inno',
        'VCLibs Dependency Contract App',
        [],
        {},
        [{
          packageIdentifier: 'Microsoft.VCLibs.Desktop.14',
          version: '14.0.33728.0',
          fileName: 'Microsoft.VCLibs.Desktop.14-DesktopAppInstaller_Dependencies.zip',
          installerSha256: dependencySha256,
          installerType: 'zip',
          nestedInstallerType: 'appx',
          nestedInstallerPath: 'x64/Microsoft.VCLibs.140.00.UWPDesktop_14.0.33728.0_x64.appx',
          packageFamilyName: 'Microsoft.VCLibs.140.00.UWPDesktop_8wekyb3d8bbwe',
          silentArgs: '',
          successCodes: [0],
          rebootCodes: [1641, 3010],
          order: 1,
        }]
      );

      expect(generated).toContain('Expand-Archive -LiteralPath $dependencyPath');
      expect(generated).toContain(
        'Add-AppxProvisionedPackage -Online -PackagePath $dependencyNestedPath -SkipLicense'
      );
      expect(generated).toContain(
        "Where-Object { $_.DisplayName -eq 'Microsoft.VCLibs.140.00.UWPDesktop' }"
      );
    },
    30_000
  );
});

describe.skipIf(!canRunWindowsPowerShellPackager)(
  'PSADT generated deployment contract',
  () => {
    it('emits parseable registry-aware scripts for EXE and Burn uninstallers', () => {
      for (const installerType of ['inno', 'burn'] as const) {
        const generated = generateRegistryUninstallPackage(installerType);

        expect(generated).toContain(
          'continuing to wait for exact registration [$registeredUninstallRegistryKey] because a child process may still be working'
        );
        expect(generated).toContain('before the completion deadline.');
        if (installerType === 'inno') {
          expect(generated).toContain(
            "$registeredUninstallProperty = if ($hasQuietUninstall) { 'QuietUninstallString' } else { 'UninstallString' }"
          );
        } else {
          expect(generated).toContain(
            'Start-ADTProcess -FilePath $burnUninstaller'
          );
        }
      }
    }, 30_000);
  }
);

describe('PSADT registry uninstall identity contract', () => {
  it('parses and persists a manifest product code for multi-entry installers', () => {
    expect(packager).toContain(
      "^REGISTRY_UNINSTALL_PRODUCT:(\\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\\}):(.+)$"
    );
    expect(packager).toContain(
      "throw 'The exact vendor uninstall identity is malformed; refusing to interpret any embedded GUID as an MSI product code.'"
    );
    expect(packager).toContain(
      "[string]$_.PSChildName -eq $configuredUninstallProductCode"
    );
    expect(packager).toContain(
      "Set-ADTRegistryKey -LiteralPath $regPath -Name ''UninstallRegistryKey''"
    );
    expect(packager).toContain('foreach ($verificationAttempt in 1..30)');
    expect(packager).toContain('$configuredMatches = @($postInstallApplications');
    expect(packager).not.toContain('$existingNameMatches');
  });

  it('selects one architecture-decorated ARP entry without accepting an ambiguous set', () => {
    expect(packager).toContain('$configuredUninstallComparableName = ((');
    expect(packager).toContain('$architectureAgnosticMatches = @($changedApplications');
    expect(packager).toContain(
      'if ($architectureAgnosticMatches.Count -eq 1) { $selectedApplications = $architectureAgnosticMatches }'
    );
    expect(packager).toContain(
      '(x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)'
    );
    expect(packager.indexOf('$architectureAgnosticMatches')).toBeLessThan(
      packager.indexOf('$bundleCandidates')
    );
  });

  it('accepts one ARP entry after removing only the configured publisher prefix', () => {
    expect(packager).toContain('$configuredUninstallPublisherAgnosticName = if (');
    expect(packager).toContain('$publisherAgnosticMatches = @($changedApplications');
    expect(packager).toContain(
      'if ($publisherAgnosticMatches.Count -eq 1) { $selectedApplications = $publisherAgnosticMatches }'
    );
    expect(packager.indexOf('$publisherAgnosticMatches')).toBeLessThan(
      packager.indexOf('$bundleCandidates')
    );
  });

  it('limits locale-aware ARP matching to one observed localized product entry', () => {
    expect(packager).toContain('$configuredUninstallLocaleHint');
    expect(packager).toContain('$configuredUninstallLocaleAgnosticName');
    expect(packager).toContain('$localeAgnosticMatches = @($changedApplications');
    expect(packager).toContain(
      'if ($localeAgnosticMatches.Count -eq 1) { $selectedApplications = $localeAgnosticMatches }'
    );
    expect(packager.indexOf('$localeAgnosticMatches')).toBeLessThan(
      packager.indexOf('$bundleCandidates')
    );
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'emits the locale hint for a language-specific package and valid PowerShell',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Mozilla Firefox (Deutsch)',
        [],
        {},
        [],
        'Mozilla.Firefox.de',
        'Mozilla Firefox (en-US)'
      );

      expect(generated).toContain("$configuredUninstallLocaleHint = 'de'");
      expect(generated).toContain('$localeAgnosticMatches = @($changedApplications');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'normalizes a manifest publisher prefix while preserving ambiguous matches',
    () => {
      const result = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `function ConvertTo-ComparableName([string]$Name) {
  return (($Name -replace '(?i)(?<![A-Za-z0-9])(x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)(?![A-Za-z0-9])', '' -replace '\\(\\s*\\)', '' -replace '\\(\\s+', '(' -replace '\\s+\\)', ')' -replace '\\s{2,}', ' ')).Trim()
}
function Remove-PublisherPrefix([string]$Name, [string]$Publisher) {
  return ($Name -replace ('(?i)^' + [regex]::Escape($Publisher) + '(?:\\s+|[._-]+)'), '').Trim()
}
$configured = Remove-PublisherPrefix (ConvertTo-ComparableName 'Microsoft SQL Server Management Studio 22') 'Microsoft'
$oneMatch = @('SQL Server Management Studio 22', 'Microsoft Visual Studio Installer') | Where-Object {
  (Remove-PublisherPrefix (ConvertTo-ComparableName $_) 'Microsoft') -eq $configured
}
$ambiguous = @('SQL Server Management Studio 22', 'Microsoft SQL Server Management Studio 22') | Where-Object {
  (Remove-PublisherPrefix (ConvertTo-ComparableName $_) 'Microsoft') -eq $configured
}
[pscustomobject]@{ OneMatch = @($oneMatch).Count; Ambiguous = @($ambiguous).Count } | ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8' }
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({ OneMatch: 1, Ambiguous: 2 });
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'normalizes Firefox architecture metadata while leaving helper entries distinct',
    () => {
      const result = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `function ConvertTo-ComparableName([string]$Name) {
  return (($Name -replace '(?i)(?<![A-Za-z0-9])(x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)(?![A-Za-z0-9])', '' -replace '\\(\\s*\\)', '' -replace '\\(\\s+', '(' -replace '\\s+\\)', ')' -replace '\\s{2,}', ' ')).Trim()
}
[pscustomobject]@{
  Configured = ConvertTo-ComparableName 'Mozilla Firefox (en-US)'
  Product = ConvertTo-ComparableName 'Mozilla Firefox (x64 en-US)'
  Helper = ConvertTo-ComparableName 'Mozilla Maintenance Service'
} | ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8' }
      );

      expect(result.status).toBe(0);
      const names = JSON.parse(result.stdout.trim()) as {
        Configured: string;
        Product: string;
        Helper: string;
      };
      expect(names.Product).toBe(names.Configured);
      expect(names.Helper).not.toBe(names.Configured);
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'matches a single requested locale while preserving ambiguity',
    () => {
      const result = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `$localeHint = 'de'
$configuredName = 'Mozilla Firefox (en-US)'
$configuredPattern = '\\(\\s*(?:(?:x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)\\s+)?[a-z]{2,3}(?:-[A-Z]{2})?\\s*\\)$'
$configuredBase = if ($configuredName -cmatch $configuredPattern) { ($configuredName -creplace $configuredPattern, '').Trim() } else { $null }
$candidatePattern = '\\(\\s*(?:(?:x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)\\s+)?' + [regex]::Escape($localeHint) + '\\s*\\)$'
function Select-Localized([string[]]$Names) {
  return @($Names | Where-Object {
    if ($_ -cnotmatch $candidatePattern) { return $false }
    (($_ -creplace $candidatePattern, '').Trim()) -eq $configuredBase
  })
}
$oneMatch = Select-Localized @('Mozilla Firefox (x64 de)', 'Mozilla Maintenance Service', 'Microsoft Edge')
$ambiguous = Select-Localized @('Mozilla Firefox (x64 de)', 'Mozilla Firefox (x86 de)', 'Mozilla Maintenance Service')
[pscustomobject]@{ OneMatch = @($oneMatch).Count; Ambiguous = @($ambiguous).Count } | ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8' }
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({ OneMatch: 1, Ambiguous: 2 });
    }
  );

  it('promotes a concrete MSI/WiX uninstall command to exact registry identity handling', () => {
    expect(packager).toContain(
      "$installerTypeLower -in @('msi', 'wix') -and $uninstallCmd -match"
    );
    expect(packager).toContain('$registryUninstallProductCode = $Matches[1]');
    expect(packager).toContain('$registryUninstallDisplayName = $DisplayName');
    expect(packager).toContain('$registryUninstallDisplayNameEscaped = $registryUninstallDisplayName -replace');
  });

  it.runIf(canRunWindowsPowerShellPackager)('emits apostrophe-safe registry identity strings', () => {
    const generated = generateRegistryUninstallPackage('inno', "Contoso O'Brien Agent");

    expect(generated).toContain("$configuredUninstallDisplayName = 'Contoso O''Brien Agent'");
    expect(generated).toContain("$appName = 'Contoso O''Brien Agent'");
    expect(generated).not.toContain("Contoso O''''Brien Agent");
  });

  it('never sends an ambiguous display-name result set to a vendor uninstaller', () => {
    expect(packager).toContain("Get-ADTApplication -Name $appName -NameMatch ''Exact''");
    expect(packager).toContain('if ($installedApps.Count -ne 1)');
    expect(packager).toContain('$registeredApplication = $installedApps[0]');
    expect(packager).toContain(
      '$registeredUninstallRegistryKey = [string]$registeredApplication.PSChildName'
    );
    expect(packager).not.toContain(
      'Uninstall-ADTApplication -InstalledApplication $installedApp -SuccessExitCodes'
    );
  });

  it('prefers a registered Burn helper and keeps the packaged fallback for disposable caches', () => {
    expect(packager).toContain("if ($originalInstallerType -eq 'burn')");
    expect(packager).toContain(
      '[string[]]$registeredUninstallArguments = @($registeredApplication."$($registeredUninstallProperty)ArgumentList" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })'
    );
    expect(packager).toContain(
      "`$bundledUninstaller = Join-Path `$adtSession.DirFiles '$installerFileNameSingleQuoteEscaped'"
    );
    expect(packager).toContain(
      '$registeredUninstallFile = [string]$registeredApplication."$($registeredUninstallProperty)FilePath"'
    );
    expect(packager).toContain('$burnUninstaller = $registeredUninstallFile');
    expect(packager).toContain('$burnUninstaller = $bundledUninstaller');
    expect(packager).toContain(
      'Start-ADTProcess -FilePath $burnUninstaller -ArgumentList $registeredUninstallArguments -WorkingDirectory $burnUninstallWorkingDirectory'
    );
    expect(packager).toContain('-WindowStyle Hidden -WaitForMsiExec -NoWait -PassThru');
    expect(packager).toContain(
      '$bundleCandidates = @($changedApplications | Where-Object { -not $_.WindowsInstaller })'
    );
    expect(packager).toContain(
      '$bundleCandidates = @($selectedApplications | Where-Object {'
    );
    expect(packager).toContain(
      '$isVisibleApplication -and -not $_.WindowsInstaller'
    );
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'narrows an ambiguous Burn display-name match to the single bundle entry',
    () => {
      const generated = generateRegistryUninstallPackage('burn', 'PreForm');

      expect(generated).toContain('if ($selectedApplications.Count -gt 1)');
      expect(generated).toContain(
        '$bundleCandidates = @($selectedApplications | Where-Object {'
      );
      expect(generated).toContain('$isVisibleApplication -and -not $_.WindowsInstaller');
      expect(generated.indexOf('if ($selectedApplications.Count -gt 1)')).toBeLessThan(
        generated.indexOf('if ($selectedApplications.Count -eq 1) { break }')
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'does not emit Burn-only duplicate-entry narrowing for non-Burn packages',
    () => {
      const generated = generateRegistryUninstallPackage('inno', 'Example App');

      expect(generated).not.toContain(
        'A Burn bundle and its chained MSI can intentionally share the same ARP display name.'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'does not leak generator-only installer type state into generated scripts',
    () => {
      const innoGenerated = generateRegistryUninstallPackage('inno');
      const burnGenerated = generateRegistryUninstallPackage('burn');

      expect(innoGenerated).not.toContain('$originalInstallerType');
      expect(burnGenerated).not.toContain('$originalInstallerType');
      expect(burnGenerated).toContain(
        '$bundleCandidates = @($changedApplications | Where-Object { -not $_.WindowsInstaller })'
      );
      expect(burnGenerated).toContain('$isVisibleApplication -and -not $_.WindowsInstaller');
      expect(burnGenerated).toContain(
        'A Burn bundle and its chained MSI can intentionally share the same ARP display name.'
      );
    }
  );

  it('never emits the generator-only installer type variable as a quoted script line', () => {
    expect(packager).not.toMatch(/^\s*'.*\$originalInstallerType.*'\s*$/m);
  });

  it('verifies registry installers by their captured vendor identity', () => {
    expect(packager).toContain(
      '@(Get-ADTApplication -FilterScript { $_.PSChildName -eq $capturedUninstallKey } -ErrorAction SilentlyContinue)'
    );
    expect(packager).toContain(
      'Post-install verification passed for captured vendor identity'
    );
  });

  it('executes the exact vendor-documented command for Vivaldi silent removal', () => {
    expect(packager).toContain(
      "$registeredArgumentText -match ''(?i)(^|\\s)--vivaldi(\\s|$)''"
    );
    expect(packager).toContain('$isVivaldiUninstall = $true');
    expect(packager).toContain(
      "$registeredUninstallArguments = @(''--uninstall'', ''--vivaldi'', ''--force-uninstall'')"
    );
    expect(packager).toContain(
      'Preserve the vendor-documented Vivaldi command while using the same registry-aware'
    );
  });

  it('uses the Adobe Creative Cloud desktop client unattended removal contract', () => {
    const registeredPathAssignment = packager.indexOf(
      '$registeredUninstallFile = [string]$registeredApplication.'
    );
    const adobeSignatureCheck = packager.indexOf(
      "$isAdobeCreativeCloudUninstall = (Split-Path -Leaf $registeredUninstallFile) -ieq ''Creative Cloud Uninstaller.exe''"
    );
    expect(registeredPathAssignment).toBeGreaterThan(-1);
    expect(adobeSignatureCheck).toBeGreaterThan(registeredPathAssignment);
    expect(packager).toContain(
      "$isAdobeCreativeCloudUninstall = (Split-Path -Leaf $registeredUninstallFile) -ieq ''Creative Cloud Uninstaller.exe''"
    );
    expect(packager).toContain(
      "$registeredUninstallArguments = @(''-u'', ''--silent'')"
    );
    expect(packager).toContain(
      'never forward the install-only --mode=stub value'
    );
  });

  it('uses the PSADT v4.1 process lifecycle for install and uninstall', () => {
    expect(packager).toContain('AppProcessesToClose = $processesArrayStr');
    expect(packager).toContain(
      '-CloseProcesses $adtSession.AppProcessesToClose'
    );
    expect(packager).toContain(
      'Apply the PSADT v4.1 application process lifecycle before removal.'
    );
    expect(packager).not.toContain('$script:ProcessesToClose');

    const uninstallFunction = packager.indexOf("'function Uninstall-ADTDeployment'");
    const uninstallLifecycle = packager.indexOf(
      'if ($uninstallWelcomeCall)',
      uninstallFunction
    );
    expect(uninstallFunction).toBeGreaterThan(-1);
    expect(uninstallLifecycle).toBeGreaterThan(uninstallFunction);
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'emits the configured process lifecycle inside both generated functions',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Lifecycle Contract App',
        [],
        {
          processesToClose: [
            { name: 'StreamDeck.exe', description: "Elgato's Stream Deck" },
          ],
          showClosePrompt: false,
        }
      );

      expect(generated).toContain(
        "AppProcessesToClose = @(\n    @{ Name = 'StreamDeck'; Description = 'Elgato''s Stream Deck' }\n)"
      );
      expect(
        generated.match(
          /Show-ADTInstallationWelcome -CloseProcesses \$adtSession\.AppProcessesToClose -Silent/g
        )
      ).toHaveLength(2);
      expect(generated.indexOf('Show-ADTInstallationWelcome')).toBeGreaterThan(
        generated.indexOf('function Install-ADTDeployment')
      );
      const uninstallFunction = generated.indexOf('function Uninstall-ADTDeployment');
      expect(generated.indexOf('Show-ADTInstallationWelcome', uninstallFunction)).toBeGreaterThan(
        uninstallFunction
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'emits one valid force-countdown parameter set and never combines it with Silent',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Deferral Contract App',
        [],
        {
          processesToClose: [{ name: 'Example', description: 'Example' }],
          showClosePrompt: false,
          allowDefer: true,
          deferTimes: 2,
          forceCloseProcessesCountdown: 45,
        }
      );

      expect(generated).toContain(
        'Show-ADTInstallationWelcome -CloseProcesses $adtSession.AppProcessesToClose -AllowDeferCloseProcesses -ForceCloseProcessesCountdown 45 -DeferTimes 2'
      );
      expect(generated).not.toContain(
        '-ForceCloseProcessesCountdown 45 -ForceCloseProcessesCountdown'
      );
      expect(generated).not.toContain(
        '-Silent -ForceCloseProcessesCountdown'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'fails packaging instead of dropping an unsafe process entry',
    () => {
      expect(() => generateRegistryUninstallPackage(
        'inno',
        'Unsafe Process Contract App',
        [],
        {
          processesToClose: [{ name: '..\\unsafe.exe', description: 'Unsafe' }],
        }
      )).toThrow('Invalid PSADT process name');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'treats zero defer days as no day-based limit for PSADT v4.1',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'Zero Defer Days Contract App',
        [],
        {
          processesToClose: [{ name: 'Example', description: 'Example' }],
          allowDefer: true,
          deferTimes: 3,
          deferDays: 0,
        }
      );

      expect(generated).toContain('-AllowDeferCloseProcesses');
      expect(generated).not.toContain('-DeferDays 0');

      const positive = generateRegistryUninstallPackage(
        'inno',
        'Positive Defer Days Contract App',
        [],
        { allowDefer: true, deferDays: 1.5 }
      );
      expect(positive).toContain('-DeferDays 1.5');

      expect(() => generateRegistryUninstallPackage(
        'inno',
        'Negative Defer Days Contract App',
        [],
        { allowDefer: true, deferDays: -1 }
      )).toThrow('deferDays must be a number from 0 through 3650');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects non-object configs and string booleans before generation',
    () => {
      expect(() => generateRegistryUninstallPackage(
        'inno',
        'Array Config Contract App',
        [],
        [{ processesToClose: [] }]
      )).toThrow('top-level PSADT_CONFIG value');

      expect(() => generateRegistryUninstallPackage(
        'inno',
        'Boolean Config Contract App',
        [],
        { showClosePrompt: 'false' }
      )).toThrow('showClosePrompt must be a JSON boolean');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects a malformed deferral deadline during packaging',
    () => {
      expect(() => generateRegistryUninstallPackage(
        'inno',
        'Deadline Contract App',
        [],
        { allowDefer: true, deferDeadline: 'next Tuesday' }
      )).toThrow('deferDeadline must be a valid ISO date');
    }
  );

  it('adds verified silent arguments when other vendors only register an interactive uninstall', () => {
    expect(packager).toContain("$registeredInstallerType -eq ''inno''");
    expect(packager).toContain("$registeredInstallerType -eq ''nullsoft''");
    expect(packager).toContain(
      '$registeredUninstallArguments += $additionalUninstallArguments'
    );
  });

  it('strengthens weak Inno quiet uninstall registrations in both customer packagers', () => {
    for (const source of [packager, hostedPackager]) {
      const normalizedSource = source.replaceAll("''", "'");
      expect(normalizedSource).toContain(
        "Where-Object { [string]$_ -notmatch '^(?i:/SILENT)$' }"
      );
      expect(normalizedSource).toContain("'/VERYSILENT'");
      expect(normalizedSource).toContain("'/SUPPRESSMSGBOXES'");
      expect(normalizedSource).toContain("'/NORESTART'");
      expect(normalizedSource).toContain("'/SP-'");
      expect(normalizedSource).toContain(
        '$registeredUninstallArguments += $additionalUninstallArguments'
      );
    }
  });

  it('carries the effective nested installer engine into uninstall normalization', () => {
    expect(packager).toContain("$registeredInstallerTypeLower = if ($installerTypeLower -eq 'zip'");
    expect(packager).toContain("`$registeredInstallerType = '$registeredInstallerTypeLower'");
    expect(hostedPackager).toContain("const registeredInstallerType = installerType === 'zip'");
    expect(hostedPackager).toContain("'${registeredInstallerType}' -eq 'inno'");
  });

  it('monitors exact registry removal for both quiet and fallback EXE uninstall commands', () => {
    expect(packager).toContain(
      "$registeredUninstallProperty = if ($hasQuietUninstall) { ''QuietUninstallString'' } else { ''UninstallString'' }"
    );
    expect(packager).toContain(
      '$uninstallHandle = Start-ADTProcess @uninstallProcessParameters'
    );
    expect(packager).toContain(
      'if ($registeredUninstallArguments.Count -gt 0) {'
    );
    expect(packager).toContain('$uninstallCompletionTimeoutMinutes = 5');
    expect(packager).toContain(
      '$uninstallDeadline = [DateTime]::UtcNow.AddMinutes($uninstallCompletionTimeoutMinutes)'
    );
    expect(packager).toContain('Waiting for vendor uninstall registration');
    expect(packager).toContain('$uninstallHandle.Task.IsCompleted');
    expect(packager).toContain('$uninstallHandle.Task.GetAwaiter().GetResult().ExitCode');
    expect(packager).toContain("$isRegisteredMsiExec = $registeredUninstallLeaf -in @(''msiexec'', ''msiexec.exe'')");
    expect(packager).toContain("$registeredUninstallFile = Join-Path $env:SystemRoot ''System32\\msiexec.exe''");
    expect(packager).toContain(
      'continuing to wait for exact registration [$registeredUninstallRegistryKey] because a child process may still be working'
    );
    expect(packager).not.toContain('TotalSeconds -ge 15');
  });

  it('keeps the reviewed MSI helper guard identical in both customer packagers', () => {
    for (const source of [packager, hostedPackager]) {
      expect(source).toContain('reviewedUninstallProcessGuard');
      expect(source).toContain('Get-CimInstance -ClassName Win32_Process');
      expect(source).toContain('CreationDate.ToUniversalTime()');
      expect(source).toContain('Stop-Process -Id $current.ProcessId -Force');
      expect(source).toContain('Ended the reviewed vendor uninstall helper after its grace period.');
    }
  });

  it('uses the same registry-aware completion rule for selected Burn uninstallers', () => {
    expect(packager).toContain(
      'Start-ADTProcess -FilePath $burnUninstaller -ArgumentList $registeredUninstallArguments'
    );
    expect(packager).toContain(
      'Waiting for Burn uninstall registration [$registeredUninstallRegistryKey] to be removed.'
    );
    expect(packager).toContain(
      'The Burn uninstall command did not remove registration [$registeredUninstallRegistryKey] before the completion deadline.'
    );
    expect(packager).toContain(
      'The Burn uninstaller requested a reboot with exit code [$uninstallProcessExitCode].'
    );
  });

  it('reuses only independently safe manifest switches for uninstall', () => {
    expect(packager).toContain('Never forward install-only values');
    expect(packager).toContain('--mode=stub');
    expect(packager).toContain('$safeManifestUninstallArguments');
    expect(packager).toContain('/verysilent');
    expect(packager).toContain("-split '\\s+'");
    expect(packager).toContain("(Split-Path -Leaf $registeredUninstallFile) -ine ''msiexec.exe''");
    expect(packager).not.toContain('|--silent|-s)$');
  });

  it('rebuilds misregistered msiexec commands as exact quiet product-code removal', () => {
    expect(packager).toContain("$isRegisteredMsiExec = $registeredUninstallLeaf -in @(''msiexec'', ''msiexec.exe'')");
    expect(packager).toContain('$registeredMsiProductCode');
    expect(packager).toContain(
      "$registeredUninstallArguments = @(''/x'', $registeredMsiProductCode, ''/qn'', ''/norestart'')"
    );
    expect(packager).toContain(
      'refusing to reuse install or repair arguments'
    );
    expect(packager).toContain(
      "(?:^|\\s)[/-](?:x|i)\\s*(\\{[A-F0-9]{8}"
    );
    const registryIdentityCheck = packager.indexOf(
      "$registeredUninstallRegistryKey -match ''(?i)^\\{[A-F0-9]"
    );
    const actionBoundArgumentCheck = packager.indexOf(
      "(?:^|\\s)[/-](?:x|i)\\s*(\\{[A-F0-9]"
    );
    expect(registryIdentityCheck).toBeGreaterThan(-1);
    expect(actionBoundArgumentCheck).toBeGreaterThan(registryIdentityCheck);
  });

  it('preserves reboot requests observed from asynchronous uninstallers', () => {
    expect(packager).toContain(
      '$script:UninstallRebootExitCode = 3010'
    );
    expect(packager).toContain(
      'if ($script:UninstallRebootExitCode -or $script:DependencyRebootExitCode)'
    );
    expect(packager).toContain('Close-ADTSession -ExitCode 3010');
  });

  it('still fails closed when asynchronous registry removal never completes', () => {
    expect(packager).toContain('foreach ($verificationAttempt in 1..5)');
    expect(packager).toContain(
      'throw "The vendor uninstall command did not remove registration [$registeredUninstallRegistryKey] before the completion deadline."'
    );
  });

  it('uses a captured MSI product code instead of an executable uninstall string', () => {
    expect(packager).toContain(
      "Get-MsiPropertyValue -Path $env:INSTALLER_PATH -Property 'ProductCode'"
    );
    expect(packager).toContain('[void]$view.Execute()');
    expect(packager).toContain('try { [void]$view.Close() } catch { }');
    expect(packager).toContain(
      "$msiProductCode = [string](Get-MsiPropertyValue -Path $env:INSTALLER_PATH -Property 'ProductCode')"
    );
    expect(packager).toContain("if ($fileExtension -eq '.msi') {");
    expect(packager).not.toContain(
      "$fileExtension -eq '.msi' -and ($useRegistryUninstall -or $uninstallCmd -eq 'MSI_UNINSTALL_IDENTITY_REQUIRED')"
    );
    expect(packager).toContain(
      'Using MSI database product code for registry identity'
    );
    expect(packager).toContain(
      '$capturedMsiProductCode = if ($registeredApplication.WindowsInstaller -and $registeredApplication.ProductCode)'
    );
    expect(packager).not.toContain("$capturedMsiProductCode = if ($registeredInstallerType -in @(''msi'', ''wix'')");
    expect(packager).toContain(
      "Start-ADTMsiProcess -Action ''Uninstall'' -ProductCode $capturedMsiProductCode"
    );
    expect(packager).toContain(
      'foreach ($verificationAttempt in 1..5)'
    );
    expect(packager).toContain(
      'if ($verificationAttempt -lt 5) { Start-Sleep -Seconds 2 }'
    );
  });

  it('keeps non-MSI fallback visible, non-WindowsInstaller, and fail-closed', () => {
    expect(packager).toContain(
      "$allowContainsFallback = '$registeredInstallerTypeLower' -notin @('msi', 'wix')"
    );
    expect(packager).toContain(
      "$systemComponentProperty = $_.PSObject.Properties[''SystemComponent'']"
    );
    expect(packager).toContain(
      '$isVisibleApplication -and -not $_.WindowsInstaller'
    );
  });

  it('repairs missing MSI identities and rejects unresolved MSI or unsafe MSIX identities', () => {
    expect(packager).toContain("if ($fileExtension -eq '.msi') {");
    expect(packager).toContain("$uninstallCmd -eq 'MSI_UNINSTALL_IDENTITY_REQUIRED'");
    expect(packager).toContain(
      'The MSI database did not expose a valid ProductCode; refusing ambiguous detection or removal.'
    );
    const repairIndex = packager.indexOf(
      "if ($fileExtension -eq '.msi'"
    );
    const repairedRegistryBranchIndex = packager.indexOf(
      'if ($useRegistryUninstall) {',
      repairIndex
    );
    const unresolvedSentinelIndex = packager.indexOf(
      "elseif (-not $usePortableUninstall -and $uninstallCmd -eq 'MSI_UNINSTALL_IDENTITY_REQUIRED')",
      repairedRegistryBranchIndex
    );
    expect(repairIndex).toBeGreaterThan(-1);
    expect(repairedRegistryBranchIndex).toBeGreaterThan(repairIndex);
    expect(unresolvedSentinelIndex).toBeGreaterThan(repairedRegistryBranchIndex);
    expect(packager).toContain("$msixPackageName -notmatch '^[A-Za-z0-9.-]+$'");
    expect(packager).toContain("$installerTypeLower -in @('msix', 'appx') -and");
    expect(packager).toContain('[string]::IsNullOrWhiteSpace($msixPackageName) -and');
    expect(packager).toContain('[string]::IsNullOrWhiteSpace($customUninstallCommand)');
  });
});

describe('PSADT nested archive contract', () => {
  it('rejects a nested path when its installer type was lost', () => {
    expect(packager).toContain(
      'Zip package declares a nested installer path but no nested installer type; refusing unsafe default execution.'
    );
  });
});

describe('PSADT MSIX scope contract', () => {
  it('registers user-scoped packages in the current user context', () => {
    expect(packager).toContain('Add-AppxPackage -Path $msixPath -ForceApplicationShutdown');
    expect(packager).toContain('Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue');
    expect(packager).toContain('Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop');
  });

  it('reserves online provisioning and all-user removal for machine scope', () => {
    expect(packager).toContain('Add-AppxProvisionedPackage -Online -PackagePath $msixPath');
    expect(packager).toContain('Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers');
    expect(packager).toContain('if ($IsUserScope)');
  });
});
