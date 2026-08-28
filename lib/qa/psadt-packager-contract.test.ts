import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
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

const reviewedWindowAutomationHelper = readFileSync(
  resolve(
    process.cwd(),
    '.github/scripts/Invoke-IntuneGetReviewedUninstallWindowAutomation.ps1'
  ),
  'utf8'
);

const reviewedArchiveUninstallHelper = readFileSync(
  resolve(
    process.cwd(),
    '.github/scripts/Invoke-IntuneGetReviewedArchiveUninstall.ps1'
  ),
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
  installerType: 'exe' | 'inno' | 'burn' | 'nullsoft' | 'msi' | 'zip',
  displayName = 'Contract Test App',
  installerSuccessCodes: number[] = [],
  psadtConfig: unknown = {},
  packageDependencies: Array<Record<string, unknown>> = [],
  wingetId = 'IntuneGet.ContractTest',
  uninstallDisplayName = displayName,
  version = '1.0.0',
  uninstallCommand = `REGISTRY_UNINSTALL:${uninstallDisplayName}`,
  silentSwitches = '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
  installScope: 'machine' | 'user' = 'machine',
  nestedInstallerType = '',
  nestedInstallerPath = '',
  verifyPackage?: (packageDirectory: string) => void
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

    const installerFileName = installerType === 'zip' && nestedInstallerPath
      ? 'setup.zip'
      : 'setup.exe';
    const installerPath = join(fixtureRoot, installerFileName);
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
        INPUT_VERSION: version,
        INPUT_WINGET_ID: wingetId,
        INPUT_INSTALLER_TYPE: installerType,
        INPUT_INSTALL_SCOPE: installScope,
        INPUT_NESTED_INSTALLER_TYPE: nestedInstallerType,
        INPUT_NESTED_INSTALLER_PATH: nestedInstallerPath,
        INPUT_SILENT_SWITCHES: silentSwitches,
        INPUT_INSTALLER_SUCCESS_CODES: JSON.stringify(installerSuccessCodes),
        INPUT_PACKAGE_DEPENDENCIES: JSON.stringify(packageDependencies),
        INPUT_UNINSTALL_COMMAND: uninstallCommand,
        INSTALLER_PATH: installerPath,
        INSTALLER_FILENAME: installerFileName,
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

    verifyPackage?.(join(fixtureRoot, 'package'));

    return readFileSync(generatedPath, 'utf8');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function executeReviewedMsiInstallBlock(generated: string): void {
  const startMarker = '    # IntuneGet reviewed asynchronous MSI start';
  const endMarker = '    # IntuneGet reviewed asynchronous MSI end';
  const start = generated.indexOf(startMarker);
  const end = generated.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    throw new Error('Generated reviewed MSI block markers are missing.');
  }

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'intuneget-reviewed-msi-runtime-'));
  const runtimeScriptPath = join(fixtureRoot, 'contract.ps1');
  const reviewedMsiBlock = generated.slice(start, end + endMarker.length);
  const runtimeScript = `$ErrorActionPreference = 'Stop'
$adtSession = [pscustomobject]@{
    DirFiles = '${fixtureRoot.replace(/'/g, "''")}'
    LogPath = '${fixtureRoot.replace(/'/g, "''")}'
}
function Write-ADTLogEntry { param($Message, $Source, $Severity) }
function Start-ADTProcess {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$FilePath,
        [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string[]]$ArgumentList,
        [Parameter(Mandatory = $false)][string]$WorkingDirectory,
        [Parameter(Mandatory = $false)][string]$WindowStyle,
        [Parameter(Mandatory = $false)][switch]$WaitForMsiExec,
        [Parameter(Mandatory = $true)][switch]$NoWait,
        [Parameter(Mandatory = $true)][switch]$PassThru
    )
    if (-not $WaitForMsiExec -or -not $NoWait -or -not $PassThru) {
        throw 'The reviewed MSI process contract is missing a required switch.'
    }
    $script:CapturedFilePath = $FilePath
    $script:CapturedArgumentList = [string]::Join(' ', [string[]]$ArgumentList)
    $completedTask = [System.Threading.Tasks.Task]::FromResult([pscustomobject]@{ ExitCode = 0 })
    [pscustomobject]@{ Task = $completedTask }
}
${reviewedMsiBlock}
$expectedInstallerPath = Join-Path $adtSession.DirFiles 'setup.exe'
if ($script:CapturedFilePath -ne "$env:SystemRoot\\System32\\msiexec.exe") {
    throw "Unexpected reviewed MSI executable [$script:CapturedFilePath]."
}
if (-not $script:CapturedArgumentList.Contains(('/i "{0}"' -f $expectedInstallerPath))) {
    throw "The reviewed MSI argument list omitted the exact installer path: $script:CapturedArgumentList"
}
if ($script:CapturedArgumentList -notlike '*REBOOT=ReallySuppress /QN /norestart ALLUSERS=1 CMDLINE=SME,quiet /L*V*') {
    throw "The reviewed MSI argument list did not retain PSADT defaults, vendor properties, and verbose logging: $script:CapturedArgumentList"
}
`;

  try {
    writeFileSync(runtimeScriptPath, runtimeScript);
    const result = spawnSync('pwsh', ['-NoProfile', '-File', runtimeScriptPath], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        `Reviewed MSI runtime contract failed (${result.status}):\n${result.stdout}\n${result.stderr}`
      );
    }
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
    expect(innoBlock).toContain('$effectiveInstallerArgumentsEscaped = $innoSwitchesEscaped');
  });

  it('expands target-machine environment variables in vendor install arguments', () => {
    expect(packager).toContain(
      "`$effectiveInstallerArguments = [Environment]::ExpandEnvironmentVariables('$effectiveInstallerArgumentsEscaped')"
    );
    expect(packager).toContain("$effectiveInstallerArgumentsEscaped -match '%[A-Za-z][A-Za-z0-9()_]*%'");
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
    'executes a reviewed archive batch from a confined temporary extraction',
    () => {
      const fixtureRoot = mkdtempSync(
        join(tmpdir(), 'intuneget-archive-uninstall-helper-')
      );
      try {
        const archiveContent = join(fixtureRoot, 'archive', 'TeradataODBC');
        mkdirSync(archiveContent, { recursive: true });
        writeFileSync(
          join(archiveContent, 'silent_uninstall.bat'),
          '@echo off\r\necho reviewed-archive-uninstall-ok\r\nexit /b 0\r\n'
        );
        const archivePath = join(fixtureRoot, 'setup.zip');
        const compression = spawnSync(
          'pwsh',
          [
            '-NoProfile',
            '-Command',
            "Compress-Archive -Path (Join-Path $env:ARCHIVE_SOURCE '*') -DestinationPath $env:ARCHIVE_DESTINATION -Force",
          ],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              ARCHIVE_SOURCE: join(fixtureRoot, 'archive'),
              ARCHIVE_DESTINATION: archivePath,
            },
          }
        );
        expect(compression.status).toBe(0);

        const helperPath = join(
          fixtureRoot,
          'Invoke-IntuneGetReviewedArchiveUninstall.ps1'
        );
        writeFileSync(helperPath, reviewedArchiveUninstallHelper);
        writeFileSync(
          join(fixtureRoot, 'ReviewedArchiveUninstall.json'),
          JSON.stringify({
            relativePath: 'TeradataODBC\\silent_uninstall.bat',
            arguments: ['ALL'],
          })
        );
        const result = spawnSync(
          'pwsh',
          ['-NoProfile', '-File', helperPath, '-ArchivePath', archivePath],
          { encoding: 'utf8' }
        );

        expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
        expect(`${result.stdout}\n${result.stderr}`).toContain(
          'reviewed-archive-uninstall-ok'
        );
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'loads the reviewed window-control native helper and fails closed without a matching button',
    () => {
      const fixtureRoot = mkdtempSync(
        join(tmpdir(), 'intuneget-window-automation-helper-')
      );
      try {
        const helperPath = join(
          fixtureRoot,
          'Invoke-IntuneGetReviewedUninstallWindowAutomation.ps1'
        );
        writeFileSync(helperPath, reviewedWindowAutomationHelper);
        writeFileSync(
          join(fixtureRoot, 'ReviewedUninstallWindowAutomation.json'),
          JSON.stringify({
            processName: 'pwsh.exe',
            steps: [{ windowText: '', buttonIndex: 1, timeoutSeconds: 1 }],
          })
        );
        const pwshPath = spawnSync(
          'pwsh',
          ['-NoProfile', '-Command', '(Get-Process -Id $PID).Path'],
          { encoding: 'utf8' }
        ).stdout.trim();
        const result = spawnSync(
          'pwsh',
          [
            '-NoProfile',
            '-File',
            helperPath,
            '-ExpectedProcessPath',
            pwshPath,
            '-MinimumStartTimeUtc',
            '1970-01-01T00:00:00Z',
          ],
          { encoding: 'utf8' }
        );

        expect(result.status).toBe(1);
        expect(`${result.stdout}\n${result.stderr}`).toContain(
          'Reviewed uninstall window-automation step [1] did not find its exact process window'
        );
      } finally {
        rmSync(fixtureRoot, { recursive: true, force: true });
      }
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects unsafe reviewed uninstall window automation',
    () => {
      expect(() =>
        generateRegistryUninstallPackage(
          'exe',
          'Unsafe Window Automation',
          [],
          {
            reviewedUninstallWindowAutomation: {
              processName: '..\\Uninstall.exe',
              steps: [{ buttonIndex: 0, timeoutSeconds: 500 }],
            },
          }
        )
      ).toThrow(
        'reviewedUninstallWindowAutomation.processName must be a bounded executable leaf name'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'embeds and invokes bounded IDM window automation while retaining exact ARP verification',
    () => {
      let embeddedConfig: unknown;
      let embeddedHelper = '';
      const automation = {
        processName: 'Uninstall.exe',
        steps: [
          {
            windowText: 'Internet Download Manager',
            buttonIndex: 2,
            timeoutSeconds: 60,
          },
          { buttonIndex: 3, timeoutSeconds: 15 },
          {
            windowText: 'Internet protocol options',
            buttonIndex: 2,
            timeoutSeconds: 15,
          },
        ],
      };
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Internet Download Manager',
        [],
        {
          reviewedUninstallWindowAutomation: automation,
          uninstallCompletionTimeoutMinutes: 3,
        },
        [],
        'Tonec.InternetDownloadManager',
        'Internet Download Manager',
        '6.43.10',
        'REGISTRY_UNINSTALL:Internet Download Manager',
        '/skipdlgs',
        'machine',
        '',
        '',
        (packageDirectory) => {
          const supportDirectory = join(packageDirectory, 'SupportFiles');
          const configPath = join(
            supportDirectory,
            'ReviewedUninstallWindowAutomation.json'
          );
          const helperPath = join(
            supportDirectory,
            'Invoke-IntuneGetReviewedUninstallWindowAutomation.ps1'
          );
          expect(existsSync(configPath)).toBe(true);
          expect(existsSync(helperPath)).toBe(true);
          embeddedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
          embeddedHelper = readFileSync(helperPath, 'utf8');
        }
      );

      expect(embeddedConfig).toEqual({
        processName: automation.processName,
        steps: [
          automation.steps[0],
          { windowText: '', ...automation.steps[1] },
          automation.steps[2],
        ],
      });
      expect(embeddedHelper).toContain(
        '[System.IO.Path]::GetFullPath($_.Path) -ieq $expectedFullPath'
      );
      expect(embeddedHelper).toContain(
        '$_.StartTime.ToUniversalTime() -ge $minimumStartUtc'
      );
      expect(embeddedHelper).toContain('private const uint BM_CLICK = 0x00F5;');
      expect(embeddedHelper).toContain('private const uint SMTO_ABORTIFHUNG = 0x0002;');
      expect(generated).toContain(
        '$uninstallInvocationStartedAt = [DateTime]::UtcNow.AddSeconds(-2)'
      );
      expect(generated).toContain(
        '& $windowAutomationScript -ExpectedProcessPath $registeredUninstallFile -MinimumStartTimeUtc $uninstallInvocationStartedAt'
      );
      expect(generated).toContain(
        'Get-ADTApplication -FilterScript { $_.PSChildName -eq $registeredUninstallRegistryKey }'
      );
      expect(generated).toContain(
        'The vendor uninstall command did not remove registration [$registeredUninstallRegistryKey] before the completion deadline.'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'appends NeoLoad unattended removal to the exact captured install4j command',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'NeoLoad',
        [],
        { reviewedUninstallArguments: ['-q'] },
        [],
        'Tricentis.NeoLoad',
        'NeoLoad',
        '8.2.1',
        'REGISTRY_UNINSTALL_KEY:0878-6793-3006-4848:NeoLoad',
        '-q'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "$configuredProductCode = '0878-6793-3006-4848'"
      );
      expect(uninstallFunction).toContain("$reviewedUninstallArguments = @('-q')");
      expect(uninstallFunction).toContain(
        '$registeredUninstallArguments += $reviewedArgument'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'appends Total Commander unattended removal to the exact captured product command',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Total Commander',
        [],
        { reviewedUninstallArguments: ['/7'] },
        [],
        'Ghisler.TotalCommander',
        'Total Commander 64-bit (Remove or Repair)',
        '11.58',
        'REGISTRY_UNINSTALL_KEY:Totalcmd64:Total Commander 64-bit (Remove or Repair)',
        '/AHN*'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain("$configuredProductCode = 'Totalcmd64'");
      expect(uninstallFunction).toContain("$reviewedUninstallArguments = @('/7')");
      expect(uninstallFunction).toContain(
        '$registeredUninstallArguments += $reviewedArgument'
      );
      expect(uninstallFunction).toContain(
        'Get-ADTApplication -FilterScript { $_.PSChildName -eq $registeredUninstallRegistryKey }'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'appends FSLogix restart suppression to the exact captured Burn command',
    () => {
      const generated = generateRegistryUninstallPackage(
        'zip',
        'FSLogix',
        [],
        { reviewedUninstallArguments: ['/norestart'] },
        [],
        'Microsoft.FSLogix',
        'FSLogix',
        '3.26.126.19110',
        'REGISTRY_UNINSTALL:Microsoft FSLogix Apps',
        '/install /quiet /norestart'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "$reviewedUninstallArguments = @('/norestart')"
      );
      expect(uninstallFunction).toContain(
        '$registeredUninstallArguments += $reviewedArgument'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'appends SketchUp silent removal to the exact captured InstallShield command',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'SketchUp Pro 2022',
        [],
        { reviewedUninstallArguments: ['-silent'] },
        [],
        'Trimble.SketchUp.2022',
        'SketchUp Pro 2022',
        '22.0.354',
        'REGISTRY_UNINSTALL_PRODUCT:{C631706C-1735-11EC-9621-0242AC130015}:SketchUp Pro 2022',
        '/silent'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "$configuredProductCode = '{C631706C-1735-11EC-9621-0242AC130015}'"
      );
      expect(uninstallFunction).toContain("$reviewedUninstallArguments = @('-silent')");
      expect(uninstallFunction).toContain(
        '$registeredUninstallArguments += $reviewedArgument'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'expands required WinGet install locations on the target machine',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Battle.net Setup',
        [],
        {},
        [],
        'Blizzard.BattleNet',
        'Battle.net',
        '1.19.3.3219',
        'REGISTRY_UNINSTALL_KEY:Battle.net:Battle.net',
        '/S --lang=enUS --installpath="%PROGRAMFILES(X86)%\\Battle.net"'
      );
      const installFunction = generated.slice(
        generated.indexOf('function Install-ADTDeployment'),
        generated.indexOf('function Uninstall-ADTDeployment')
      );

      expect(installFunction).toContain(
        "$effectiveInstallerArguments = [Environment]::ExpandEnvironmentVariables('/S --lang=enUS --installpath=\"%PROGRAMFILES(X86)%\\Battle.net\"')"
      );
      expect(installFunction).toContain(
        'Start-ADTProcess -FilePath "$($adtSession.DirFiles)\\setup.exe" -ArgumentList $effectiveInstallerArguments'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'runs root-level install4j uninstallers unattended when the manifest identifies the framework',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Snapform Viewer',
        [],
        {},
        [],
        'Ringler.SnapformViewer',
        'Snapform Viewer',
        '1.8.7',
        'REGISTRY_UNINSTALL_KEY:2841-5017-1617-4151:Snapform Viewer',
        '-q -Dinstall4j.suppressUnattendedReboot=true'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "$installerUsesInstall4j = '-q -Dinstall4j.suppressUnattendedReboot=true' -match '(?i)(^|\\s)-Dinstall4j\\.'"
      );
      expect(uninstallFunction).toContain(
        "$registeredUninstallLeaf -in @('uninstaller.exe', 'uninstall.exe')"
      );
      expect(uninstallFunction).toContain(
        "($registeredUninstallParentLeaf -ieq '.install4j' -or $installerUsesInstall4j)"
      );
      expect(uninstallFunction).toContain(
        "foreach ($argument in @('-q', '-Dinstall4j.suppressUnattendedReboot=true'))"
      );
      expect(uninstallFunction).toContain(
        '$additionalUninstallArguments += $argument'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'retains the canonical .install4j uninstaller signature without manifest framework switches',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Example install4j application',
        [],
        {},
        [],
        'Example.Install4j',
        'Example install4j application',
        '1.0.0',
        'REGISTRY_UNINSTALL_KEY:example-install4j:Example install4j application',
        '/S'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "$installerUsesInstall4j = '/S' -match '(?i)(^|\\s)-Dinstall4j\\.'"
      );
      expect(uninstallFunction).toContain(
        "($registeredUninstallParentLeaf -ieq '.install4j' -or $installerUsesInstall4j)"
      );
    }
  );

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
    'verifies .NET Framework with the reviewed Microsoft registry signal',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Microsoft .NET Framework Runtime 4.8.1',
        [],
        {
          verifyInstall: true,
          preserveVendorInstallationOnUninstall: true,
          reviewedRegistryInstallEvidence: {
            keyPath:
              'HKLM:\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full',
            valueName: 'Release',
            minimumDword: 533320,
          },
        },
        [],
        'Microsoft.DotNet.Framework.Runtime'
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
        "Get-Item -LiteralPath 'Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\NET Framework Setup\\NDP\\v4\\Full'"
      );
      expect(installFunction).toContain(
        "GetValueKind('Release') -ne [Microsoft.Win32.RegistryValueKind]::DWord"
      );
      expect(installFunction).toContain(
        '[uint64]$evidenceValue -ge [uint64]533320'
      );
      expect(installFunction).toContain(
        'Post-install verification passed for reviewed Windows runtime registry evidence'
      );
      expect(installFunction).not.toContain('$preInstallApplications');
      expect(installFunction).not.toContain(
        'Could not select one vendor uninstall entry'
      );
      expect(uninstallFunction).toContain(
        'Retaining the shared vendor installation and removing only the IntuneGet management marker.'
      );
      expect(uninstallFunction).not.toContain(
        'Could not find one unambiguous vendor uninstall'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'verifies Windows App Runtime with exact shared Appx framework evidence',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Windows App Runtime 1.8',
        [],
        {
          verifyInstall: true,
          preserveVendorInstallationOnUninstall: true,
          reviewedAppxInstallEvidence: {
            packageName: 'Microsoft.WindowsAppRuntime.1.8',
            publisherId: '8wekyb3d8bbwe',
            minimumVersion: '8000.879.2017.0',
          },
        },
        [],
        'Microsoft.WindowsAppRuntime.1.8'
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
        "Get-AppxPackage -AllUsers -Name 'Microsoft.WindowsAppRuntime.1.8'"
      );
      expect(installFunction).toContain(
        "[string]$_.PublisherId -eq '8wekyb3d8bbwe'"
      );
      expect(installFunction).toContain('[bool]$_.IsFramework');
      expect(installFunction).toContain(
        "[version]$_.Version -ge $minimumAppxVersion"
      );
      expect(installFunction).toContain(
        'Post-install verification passed for reviewed shared Appx framework evidence'
      );
      expect(installFunction).not.toContain('$preInstallApplications');
      expect(installFunction).not.toContain(
        'Could not select one vendor uninstall entry'
      );
      expect(uninstallFunction).toContain(
        'Retaining the shared vendor installation and removing only the IntuneGet management marker.'
      );
      expect(uninstallFunction).not.toContain('Microsoft EdgeWebView');
      expect(uninstallFunction).not.toContain('Start-ADTProcess @uninstallProcessParameters');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'verifies Windows App Runtime 1.3 with its exact shared Appx framework evidence',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Windows App Runtime',
        [],
        {
          verifyInstall: true,
          preserveVendorInstallationOnUninstall: true,
          reviewedAppxInstallEvidence: {
            packageName: 'Microsoft.WindowsAppRuntime.1.3',
            publisherId: '8wekyb3d8bbwe',
            minimumVersion: '3000.934.1904.0',
          },
        },
        [],
        'Microsoft.WindowsAppRuntime.1.3'
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
        "Get-AppxPackage -AllUsers -Name 'Microsoft.WindowsAppRuntime.1.3'"
      );
      expect(installFunction).toContain(
        "[string]$_.PublisherId -eq '8wekyb3d8bbwe'"
      );
      expect(installFunction).toContain('[bool]$_.IsFramework');
      expect(installFunction).toContain(
        "[version]'3000.934.1904.0'"
      );
      expect(installFunction).not.toContain('$preInstallApplications');
      expect(installFunction).not.toContain(
        'Could not select one vendor uninstall entry'
      );
      expect(uninstallFunction).toContain(
        'Retaining the shared vendor installation and removing only the IntuneGet management marker.'
      );
      expect(uninstallFunction).not.toContain('Start-ADTProcess @uninstallProcessParameters');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects wildcard and unretained reviewed Appx evidence',
    () => {
      expect(() =>
        generateRegistryUninstallPackage(
          'exe',
          'Unsafe Appx Evidence',
          [],
          {
            preserveVendorInstallationOnUninstall: true,
            reviewedAppxInstallEvidence: {
              packageName: 'Microsoft.WindowsAppRuntime.*',
              publisherId: '8wekyb3d8bbwe',
              minimumVersion: '8000.879.2017.0',
            },
          }
        )
      ).toThrow('packageName must be a safe exact Appx package name');

      expect(() =>
        generateRegistryUninstallPackage(
          'exe',
          'Unretained Appx Evidence',
          [],
          {
            reviewedAppxInstallEvidence: {
              packageName: 'Microsoft.WindowsAppRuntime.1.8',
              publisherId: '8wekyb3d8bbwe',
              minimumVersion: '8000.879.2017.0',
            },
          }
        )
      ).toThrow(
        'reviewedAppxInstallEvidence requires preserveVendorInstallationOnUninstall'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects unsafe reviewed registry install evidence',
    () => {
      expect(() =>
        generateRegistryUninstallPackage(
          'exe',
          'Unsafe Registry Evidence',
          [],
          {
            preserveVendorInstallationOnUninstall: true,
            reviewedRegistryInstallEvidence: {
              keyPath: 'HKLM:\\SOFTWARE\\..\\Secrets',
              valueName: 'Release',
              minimumDword: 1,
            },
          }
        )
      ).toThrow('keyPath must be a safe literal path below HKLM:\\SOFTWARE');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'requires shared-runtime retention for reviewed registry evidence',
    () => {
      expect(() =>
        generateRegistryUninstallPackage(
          'exe',
          'Unsafe Registry Lifecycle',
          [],
          {
            reviewedRegistryInstallEvidence: {
              keyPath: 'HKLM:\\SOFTWARE\\Microsoft\\Example',
              valueName: 'Release',
              minimumDword: 1,
            },
          }
        )
      ).toThrow(
        'reviewedRegistryInstallEvidence requires preserveVendorInstallationOnUninstall'
      );
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
    'keeps an exact vendor uninstall contract authoritative for Inno packages',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'AOMEI Partition Assistant',
        [],
        {
          reviewedExactUninstall: {
            executablePath:
              '%ProgramFiles(x86)%\\AOMEI Partition Assistant\\unins000.exe',
            arguments: [
              '/SILENT',
              '/SUPPRESSMSGBOXES',
              '/NORESTART',
              '/SP-',
            ],
            completionTimeoutMinutes: 5,
          },
        },
        [],
        'AOMEI.PartitionAssistant'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles(x86)%\\AOMEI Partition Assistant\\unins000.exe')"
      );
      expect(uninstallFunction).toContain(
        "$registeredUninstallArguments = @('/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-')"
      );
      expect(uninstallFunction).toContain(
        "if (-not $useReviewedExactUninstall -and -not $isVivaldiUninstall"
      );
      expect(uninstallFunction).not.toContain(
        "$registeredUninstallArguments = @('/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/VERYSILENT'"
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses MiKTeX integrated setup instead of its interactive Console cleanup page',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'MiKTeX',
        [],
        {
          reviewedExactUninstall: {
            executablePath:
              '%ProgramFiles%\\MiKTeX\\miktex\\bin\\x64\\miktexsetup.exe',
            arguments: ['--quiet', '--shared=yes', 'uninstall'],
            completionTimeoutMinutes: 15,
          },
        },
        [],
        'MiKTeX.MiKTeX'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles%\\MiKTeX\\miktex\\bin\\x64\\miktexsetup.exe')"
      );
      expect(uninstallFunction).toContain(
        "$registeredUninstallArguments = @('--quiet', '--shared=yes', 'uninstall')"
      );
      expect(uninstallFunction).toContain(
        '$effectiveUninstallCompletionTimeoutMinutes = if ($useReviewedExactUninstall) { 15 }'
      );
      expect(uninstallFunction).toContain(
        'Waiting for vendor uninstall registration [$registeredUninstallRegistryKey] to be removed.'
      );
      expect(uninstallFunction).not.toContain('--start-page cleanup');
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
    'expands a reviewed versioned managed-directory lifecycle before validation',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Zee Drive',
        [],
        {
          reviewedManagedInstallDirectory:
            '%ProgramFiles%\\Thinkscape Zee Drive\\<VERSION>',
          reviewedManagedInstallEvidenceFile:
            '%ProgramFiles%\\Thinkscape Zee Drive\\<VERSION>\\ZeeDrive.exe',
          reviewedManagedInstallCompletionTimeoutMinutes: 5,
        },
        [],
        'Thinkscape.ZeeDrive',
        'Zee Drive',
        '68.15.0.0'
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
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles%\\Thinkscape Zee Drive\\68.15.0.0')"
      );
      expect(installFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles%\\Thinkscape Zee Drive\\68.15.0.0\\ZeeDrive.exe')"
      );
      expect(uninstallFunction).toContain(
        'Remove-Item -LiteralPath $managedInstallDirectory'
      );
      expect(generated).not.toContain('<VERSION>');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'verifies and removes the reviewed Tor Browser user Desktop payload',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Tor Browser',
        [],
        { reviewedManagedInstallDirectory: '%USERPROFILE%\\Desktop\\Tor Browser' },
        [],
        'TorProject.TorBrowser',
        'Tor Browser',
        '15.0.19',
        'REGISTRY_UNINSTALL:Tor Browser',
        '/S',
        'user'
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
        "[Environment]::ExpandEnvironmentVariables('%USERPROFILE%\\Desktop\\Tor Browser')"
      );
      expect(installFunction).toContain('Verified managed extracted payload');
      expect(installFunction).not.toContain('Captured vendor uninstall entry');
      expect(uninstallFunction).toContain('Remove-Item -LiteralPath $managedInstallDirectory');
      expect(uninstallFunction).not.toContain('Waiting for vendor uninstall registration');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'verifies and removes a reviewed non-ARP machine directory',
    () => {
      const generated = generateRegistryUninstallPackage(
        'nullsoft',
        'Managed Payload Example',
        [],
        {
          reviewedManagedInstallDirectory: '%ProgramFiles%\\ManagedPayloadExample',
          reviewedManagedInstallEvidenceFile:
            '%ProgramFiles%\\ManagedPayloadExample\\ManagedPayloadExample.exe',
          reviewedManagedInstallCompletionTimeoutMinutes: 2,
        },
        [],
        'Example.ManagedPayload',
        'Managed Payload Example',
        '1.0.0',
        'REGISTRY_UNINSTALL:Managed Payload Example',
        '/S',
        'machine'
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
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles%\\ManagedPayloadExample')"
      );
      expect(installFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles%\\ManagedPayloadExample\\ManagedPayloadExample.exe')"
      );
      expect(installFunction).toContain(
        'Verified stable managed installation evidence'
      );
      expect(installFunction).not.toContain('Captured vendor uninstall entry');
      expect(uninstallFunction).toContain(
        'Remove-Item -LiteralPath $managedInstallDirectory'
      );
      expect(uninstallFunction).not.toContain(
        'Waiting for vendor uninstall registration'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects a reviewed user Desktop directory for a machine-scope package',
    () => {
      expect(() =>
        generateRegistryUninstallPackage(
          'exe',
          'Unsafe User Extractor',
          [],
          { reviewedManagedInstallDirectory: '%USERPROFILE%\\Desktop\\Unsafe' }
        )
      ).toThrow('reviewed user Desktop path');
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
      ).toThrow('must be a safe machine path');
      expect(() =>
        generateRegistryUninstallPackage(
          'exe',
          'Unsafe System Drive Extractor',
          [],
          { reviewedManagedInstallDirectory: '%SystemDrive%\\Windows' }
        )
      ).toThrow('must be a safe machine path');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses a reviewed vendor command for a managed installation instance',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Visual Studio BuildTools 2026',
        [],
        {
          reviewedInstallArguments: [
            '--installPath "%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools"',
            '--add Microsoft.VisualStudio.Workload.MSBuildTools',
            '--norestart',
          ],
          reviewedManagedInstallDirectory:
            '%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools',
          reviewedManagedUninstall: {
            executablePath:
              '%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe',
            arguments: [
              'uninstall',
              '--installPath',
              '%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools',
              '--quiet',
              '--norestart',
            ],
            completionTimeoutMinutes: 15,
          },
        },
        [],
        'Microsoft.VisualStudio.BuildTools',
        'Visual Studio BuildTools 2026',
        '18.9.1',
        'REGISTRY_UNINSTALL:Visual Studio BuildTools 2026',
        '--quiet --wait --campaign "winget"'
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
        "$effectiveInstallerArguments = [Environment]::ExpandEnvironmentVariables('--quiet --wait --campaign \"winget\" --installPath \"%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools\" --add Microsoft.VisualStudio.Workload.MSBuildTools --norestart')"
      );
      expect(installFunction).toContain('-ArgumentList $effectiveInstallerArguments');
      expect(uninstallFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\setup.exe')"
      );
      expect(uninstallFunction).toContain(
        "$managedUninstallArguments = @('uninstall', '--installPath', '%ProgramFiles%\\Microsoft Visual Studio\\18\\BuildTools', '--quiet', '--norestart')"
      );
      expect(uninstallFunction).toContain(
        '$managedUninstallDeadline = [DateTime]::UtcNow.AddMinutes(15)'
      );
      expect(uninstallFunction).not.toContain(
        'Remove-Item -LiteralPath $managedInstallDirectory'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses Autodesk Licensing Service dedicated evidence and unattended removal',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Autodesk Licensing Service',
        [],
        {
          reviewedManagedInstallDirectory:
            '%ProgramFiles(x86)%\\Common Files\\Autodesk Shared\\AdskLicensing',
          reviewedManagedInstallEvidenceFile:
            '%ProgramFiles(x86)%\\Common Files\\Autodesk Shared\\AdskLicensing\\uninstall.exe',
          reviewedManagedInstallCompletionTimeoutMinutes: 5,
          reviewedManagedUninstall: {
            executablePath:
              '%ProgramFiles(x86)%\\Common Files\\Autodesk Shared\\AdskLicensing\\uninstall.exe',
            arguments: ['--mode', 'unattended'],
            completionTimeoutMinutes: 5,
          },
        },
        [],
        'Autodesk.LicensingService'
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
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles(x86)%\\Common Files\\Autodesk Shared\\AdskLicensing\\uninstall.exe')"
      );
      expect(uninstallFunction).toContain(
        "$managedUninstallArguments = @('--mode', 'unattended')"
      );
      expect(uninstallFunction).toContain(
        '$managedUninstallCompletionTarget = $managedInstallEvidenceFile'
      );
      expect(uninstallFunction).toContain(
        'while ((Test-Path -LiteralPath $managedUninstallCompletionTarget)'
      );
      expect(uninstallFunction).not.toContain(
        'while ((Test-Path -LiteralPath $managedInstallDirectory)'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses the exact Autodesk ODIS manifest lifecycle for Navisworks Freedom',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Autodesk Create Installer',
        [],
        {
          reviewedManagedInstallDirectory:
            '%ProgramW6432%\\Autodesk\\Navisworks Freedom 2026',
          reviewedManagedInstallEvidenceFile:
            '%ProgramW6432%\\Autodesk\\Navisworks Freedom 2026\\Roamer.exe',
          reviewedManagedInstallCompletionProcess:
            '%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe',
          reviewedManagedInstallCompletionTimeoutMinutes: 15,
          reviewedManagedUninstall: {
            executablePath:
              '%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe',
            arguments: [
              '-i',
              'uninstall',
              '--silent',
              '--trigger_point',
              'system',
              '-m',
              '%ProgramData%\\Autodesk\\ODIS\\metadata\\{BE06C262-73A9-3C2F-8982-C105E1EE9A34}\\bundleManifest.xml',
              '-x',
              '%ProgramData%\\Autodesk\\ODIS\\metadata\\{BE06C262-73A9-3C2F-8982-C105E1EE9A34}\\SetupRes\\manifest.xsd',
            ],
            completionTimeoutMinutes: 15,
          },
        },
        [],
        'Autodesk.NavisworksFreedom.2026'
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
        "[Environment]::ExpandEnvironmentVariables('%ProgramW6432%\\Autodesk\\Navisworks Freedom 2026')"
      );
      expect(installFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramW6432%\\Autodesk\\Navisworks Freedom 2026\\Roamer.exe')"
      );
      expect(installFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe')"
      );
      expect(installFunction).toContain(
        '$managedInstallReadyObservations -ge 2'
      );
      expect(installFunction).toContain(
        '$managedInstallDeadline = [DateTime]::UtcNow.AddMinutes(15)'
      );
      expect(installFunction).not.toContain('Captured vendor uninstall entry');
      expect(uninstallFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe')"
      );
      expect(uninstallFunction).toContain(
        "$managedUninstallArguments = @('-i', 'uninstall', '--silent', '--trigger_point', 'system', '-m', '%ProgramData%\\Autodesk\\ODIS\\metadata\\{BE06C262-73A9-3C2F-8982-C105E1EE9A34}\\bundleManifest.xml', '-x', '%ProgramData%\\Autodesk\\ODIS\\metadata\\{BE06C262-73A9-3C2F-8982-C105E1EE9A34}\\SetupRes\\manifest.xsd')"
      );
      expect(uninstallFunction).toContain(
        '$managedUninstallDeadline = [DateTime]::UtcNow.AddMinutes(15)'
      );
      expect(uninstallFunction).not.toContain(
        'Remove-Item -LiteralPath $managedInstallDirectory'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'resolves one validated package-version segment in a reviewed managed uninstaller',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Google Updater',
        [],
        {
          reviewedManagedInstallDirectory:
            '%ProgramFiles(x86)%\\Google\\GoogleUpdater',
          reviewedManagedUninstall: {
            executablePath:
              '%ProgramFiles(x86)%\\Google\\GoogleUpdater\\<VERSION>\\updater.exe',
            arguments: ['--uninstall', '--system'],
            completionTimeoutMinutes: 5,
          },
        },
        [],
        'Google.GoogleUpdater'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles(x86)%\\Google\\GoogleUpdater\\1.0.0\\updater.exe')"
      );
      expect(uninstallFunction).toContain(
        "$managedUninstallArguments = @('--uninstall', '--system')"
      );
      expect(uninstallFunction).not.toContain('<VERSION>');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects an unsafe package version used in a reviewed managed uninstaller path',
    () => {
      expect(() =>
        generateRegistryUninstallPackage(
          'exe',
          'Unsafe Version App',
          [],
          {
            reviewedManagedInstallDirectory: '%ProgramFiles%\\Example',
            reviewedManagedUninstall: {
              executablePath:
                '%ProgramFiles%\\Example\\<VERSION>\\uninstall.exe',
              arguments: ['/quiet'],
              completionTimeoutMinutes: 5,
            },
          },
          [],
          'IntuneGet.UnsafeVersion',
          'Unsafe Version App',
          '..\\Windows'
        )
      ).toThrow('invalid version placeholder or package version');
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

  it('honors signed process equivalents of unsigned WinGet success codes', () => {
    if (!canRunWindowsPowerShellPackager) return;
    const generated = generateRegistryUninstallPackage(
      'nullsoft',
      'Recuva',
      [-1073741819, -1073740791],
      {},
      [],
      'Piriform.Recuva'
    );
    expect(generated).toContain(
      'AppSuccessExitCodes = @(-1073741819, -1073740791, 0)'
    );
  });

  it('does not rewrite dollar signs or backticks in generic silent switches', () => {
    expect(packager).toContain('$silentSwitchesEscaped = $effectiveSilentSwitches -replace "\'", "\'\'"');
    const assignment = packager.match(/^\$silentSwitchesEscaped\s*=.*$/m)?.[0] ?? '';
    expect(assignment).not.toContain("-replace '`'");
    expect(assignment).not.toContain("-replace '\\$'");
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'omits ArgumentList when an EXE installer declares no arguments',
    () => {
      for (const installScope of ['machine', 'user'] as const) {
        const generated = generateRegistryUninstallPackage(
          'exe',
          'No Arguments Contract App',
          [],
          { reviewedArgumentlessInstall: true },
          [],
          'IntuneGet.NoArguments',
          'No Arguments Contract App',
          '1.0.0',
          'REGISTRY_UNINSTALL:No Arguments Contract App',
          '',
          installScope
        );

        expect(generated).not.toContain("-ArgumentList ''");
        expect(generated).toContain(
          installScope === 'user'
            ? 'Start-ADTProcess -FilePath $installerDest -UseShellExecute'
            : 'Start-ADTProcess -FilePath "$($adtSession.DirFiles)\\setup.exe" -WindowStyle Hidden'
        );
      }
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects an argument-free EXE without the reviewed vendor contract',
    () => {
      expect(() => generateRegistryUninstallPackage(
        'exe',
        'Unreviewed No Arguments App',
        [],
        {},
        [],
        'IntuneGet.UnreviewedNoArguments',
        'Unreviewed No Arguments App',
        '1.0.0',
        'REGISTRY_UNINSTALL:Unreviewed No Arguments App',
        ''
      )).toThrow('requires a reviewed argumentless install contract');
    }
  );

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
    'uses a reviewed vendor-specific unattended argument override',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Bitvise SSH Client',
        [],
        { reviewedInstallArgumentsOverride: '-unat -acceptEula' }
      );

      expect(generated).toContain("-ArgumentList '-unat -acceptEula'");
      expect(generated).not.toContain(
        "-ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-'"
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'strips the complete MSI quiet token without leaking a trailing fragment',
    () => {
      const generated = generateRegistryUninstallPackage(
        'msi',
        'Microsoft ODBC Driver 13 for SQL Server',
        [],
        {},
        [],
        'Microsoft.msodbcsql.13',
        'Microsoft ODBC Driver 13 for SQL Server',
        '13.1.4414.46',
        'msiexec /x "{7E425BFB-1DEB-499F-8F3F-3522A6E98754}" /qn /norestart',
        '/quiet /norestart IACCEPTMSODBCSQLLICENSETERMS=YES ALLUSERS=1'
      );

      expect(generated).toContain(
        "Start-ADTMsiProcess -Action 'Install' -FilePath 'setup.exe' -AdditionalArgumentList '/norestart IACCEPTMSODBCSQLLICENSETERMS=YES ALLUSERS=1'"
      );
      expect(generated).not.toMatch(/AdditionalArgumentList '[^']*\biet\b/);
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'replaces BlueJ automatic context and expands its per-user MSI directory',
    () => {
      const productCode = '{BAF3564F-5DE4-48AC-8CC4-260BFFD56D30}';
      const generated = generateRegistryUninstallPackage(
        'msi',
        'BlueJ',
        [],
        {
          reviewedInstallArgumentsOverride:
            '/qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1 INSTALLDIR="%LOCALAPPDATA%\\Programs\\BlueJ"',
        },
        [],
        'BlueJTeam.BlueJ',
        'BlueJ',
        '6.0.0',
        `msiexec /x "${productCode}" /qn /norestart`,
        '/qn /norestart ALLUSERS=2',
        'user'
      );

      expect(generated).toContain(
        "$effectiveMsiProperties = [Environment]::ExpandEnvironmentVariables('/norestart ALLUSERS=2 MSIINSTALLPERUSER=1 INSTALLDIR=\"%LOCALAPPDATA%\\Programs\\BlueJ\"')"
      );
      expect(generated).toContain(
        "Start-ADTMsiProcess -Action 'Install' -FilePath 'setup.exe' -AdditionalArgumentList $effectiveMsiProperties"
      );
      expect(generated).not.toContain("AdditionalArgumentList '/norestart ALLUSERS=2'");
      expect(generated).not.toContain('ALLUSERS=0');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'expands environment variables in a reviewed Inno install directory override',
    () => {
      const generated = generateRegistryUninstallPackage(
        'inno',
        'NVM for Windows',
        [],
        {
          reviewedInstallArgumentsOverride:
            '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="%ProgramFiles%\\nvm"',
        }
      );

      expect(generated).toContain(
        "$effectiveInstallerArguments = [Environment]::ExpandEnvironmentVariables('/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR=\"%ProgramFiles%\\nvm\"')"
      );
      expect(generated).toContain('-ArgumentList $effectiveInstallerArguments');
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'creates and validates a reviewed InstallShield administrative image instead of installing the launcher',
    () => {
      const productCode = '{6FB7DAEC-5DAD-491E-9951-4684423F291C}';
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Sonos',
        [],
        {
          reviewedInstallShieldAdministrativeImage: {
            expectedMsiFileName: 'Sonos.msi',
          },
        },
        [],
        'Sonos.Controller',
        'Sonos',
        '90.0.77070',
        `REGISTRY_UNINSTALL_PRODUCT:${productCode}:Sonos`,
        '/S /V/quiet /V/norestart'
      );

      expect(generated).toContain(
        '$embeddedMsiAdminArguments = \'/a"\' + $embeddedMsiAdminDir + \'" /s /v"/qn TARGETDIR=\' + $embeddedMsiAdminDir + \' REBOOT=ReallySuppress"\''
      );
      expect(generated).not.toContain(' /x ');
      expect(generated).toContain(
        "if ($embeddedMsiFiles.Count -ne 1 -or $embeddedMsiFiles[0].Name -ine 'Sonos.msi')"
      );
      expect(generated).toContain(
        `$expectedEmbeddedMsiProductCode = '${productCode}'`
      );
      expect(generated).toContain(
        "Start-ADTMsiProcess -Action 'Install' -FilePath $embeddedMsiPath -AdditionalArgumentList 'REBOOT=ReallySuppress'"
      );
      expect(generated).toContain(
        'Remove-Item -LiteralPath $embeddedMsiAdminDir -Recurse -Force'
      );
      expect(generated).not.toContain(
        "-ArgumentList '/S /V/quiet /V/norestart' -WindowStyle Hidden"
      );
    },
    30_000
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'rejects unsafe or ambiguous reviewed InstallShield administrative-image contracts',
    () => {
      expect(() =>
        generateRegistryUninstallPackage('exe', 'Unsafe Embedded MSI App', [], {
          reviewedInstallShieldAdministrativeImage: {
            expectedMsiFileName: '..\\payload.msi',
          },
        })
      ).toThrow('expectedMsiFileName must be a safe literal MSI filename');

      expect(() =>
        generateRegistryUninstallPackage('exe', 'Ambiguous Embedded MSI App', [], {
          reviewedInstallShieldAdministrativeImage: {
            expectedMsiFileName: 'payload.msi',
          },
        })
      ).toThrow('requires an exact manifest MSI product code');
    },
    30_000
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
        'Add-AppxProvisionedPackage -Online -PackagePath $packagePath -SkipLicense'
      );
      expect(generated).toContain('} -ArgumentList $dependencyNestedPath');
      expect(generated).toContain(
        'Wait-Job -Job $dependencyProvisioningJob -Timeout 30'
      );
      expect(generated).toContain(
        'Bundled APPX dependency [Microsoft.VCLibs.Desktop.14] provisioning is still in progress.'
      );
      expect(generated).toContain(
        'Receive-Job -Job $dependencyProvisioningJob -ErrorAction Stop'
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
  it.runIf(canRunWindowsPowerShellPackager)(
    'writes and removes the exact saved custom marker root used by customer detection',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        '8x8 Work',
        [],
        { registryMarkerPath: 'SOFTWARE\\HBX\\InstalledApps' },
        [],
        '8x8.Work',
        '8x8 Work',
        '8.36.2',
        'REGISTRY_UNINSTALL:8x8 Work',
        '/S'
      );

      expect(generated).toContain(
        "$regPath = 'HKLM\\SOFTWARE\\HBX\\InstalledApps\\8x8_Work'"
      );
      expect(generated).toContain(
        "$regPathHKLM = 'HKLM\\SOFTWARE\\HBX\\InstalledApps\\8x8_Work'"
      );
    },
    30_000
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses a reviewed bootstrapper completion window for exact ARP registration',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Autodesk Desktop Connector',
        [],
        { reviewedInstallCompletionTimeoutMinutes: 15 },
        [],
        'Autodesk.DesktopConnector',
        'Autodesk Desktop Connector',
        '2027.2.0.85',
        'REGISTRY_UNINSTALL_PRODUCT:{0D3EBA46-5179-3ECC-9E63-8A0221EBFA9F}:Autodesk Desktop Connector',
        '--quiet'
      );

      expect(generated).toContain(
        'foreach ($verificationAttempt in 1..450)'
      );
      expect(generated).toContain(
        'if ($verificationAttempt -lt 450) { Start-Sleep -Seconds 2 }'
      );
      expect(generated).toContain(
        '$configuredMatches = @($postInstallApplications'
      );
    },
    30_000
  );

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

  it('supports a reviewed exact non-MSI uninstall registry key', () => {
    expect(packager).toContain(
      '^REGISTRY_UNINSTALL_KEY:((?:[A-Za-z0-9][A-Za-z0-9 ._{}()+-]{0,255}|'
    );
    expect(packager).toContain(
      "$uninstallCmd -match '^REGISTRY_UNINSTALL_(PRODUCT|KEY):'"
    );
    expect(packager).toContain(
      '[string]$_.PSChildName -eq $configuredUninstallProductCode'
    );
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'emits a valid exact lifecycle for a named non-MSI ARP key',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'IntelliJ IDEA Ultimate Edition',
        [],
        {},
        [],
        'JetBrains.IntelliJIDEA.Ultimate',
        'IntelliJ IDEA Ultimate Edition',
        '2025.2.5',
        'REGISTRY_UNINSTALL_KEY:IntelliJ IDEA 2025.2.5:IntelliJ IDEA Ultimate Edition'
      );

      expect(generated).toContain(
        "$configuredUninstallProductCode = 'IntelliJ IDEA 2025.2.5'"
      );
      expect(generated).toContain(
        'No captured entry; searching for manifest registry key: $configuredProductCode'
      );
    },
    30_000
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'emits Chrome Beta EXE capture and removal against its exact channel key',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Google Chrome Beta (EXE)',
        [],
        {},
        [],
        'Google.Chrome.Beta.EXE',
        'Google Chrome Beta (EXE)',
        '152.0.7977.54',
        'REGISTRY_UNINSTALL_KEY:Google Chrome Beta:Google Chrome Beta',
        '--do-not-launch-chrome --system-level --chrome-beta'
      );

      expect(generated).toContain(
        "$configuredUninstallProductCode = 'Google Chrome Beta'"
      );
      expect(generated).toContain(
        "$configuredUninstallDisplayName = 'Google Chrome Beta'"
      );
      expect(generated).toContain(
        'No captured entry; searching for manifest registry key: $configuredProductCode'
      );
    },
    30_000
  );

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

  it('matches only one observed ARP entry with the exact requested version suffix', () => {
    expect(packager).toContain('$configuredUninstallVersionedName = if (');
    expect(packager).toContain('$versionSuffixedMatches = @($changedApplications');
    expect(packager).toContain(
      '$candidateComparableName -eq $configuredUninstallVersionedName -and'
    );
    expect(packager).toContain(
      '[string]$_.DisplayVersion -eq $configuredUninstallVersion'
    );
    expect(packager).toContain(
      'if ($versionSuffixedMatches.Count -eq 1) { $selectedApplications = $versionSuffixedMatches }'
    );
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'accepts the exact Visualizer LTSE version suffix and rejects other versions or ambiguity',
    () => {
      const result = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `$configuredName = 'Visualizer LTSE'
$configuredVersion = '1.2.73.0'
$configuredVersionedName = "$configuredName $configuredVersion"
function Select-VersionSuffixed([object[]]$Applications) {
  return @($Applications | Where-Object {
    ([string]$_.DisplayName).Trim() -eq $configuredVersionedName -and
      [string]$_.DisplayVersion -eq $configuredVersion
  })
}
$oneMatch = Select-VersionSuffixed @(
  [pscustomobject]@{ DisplayName = 'Visualizer LTSE 1.2.73.0'; DisplayVersion = '1.2.73.0' },
  [pscustomobject]@{ DisplayName = 'Visualizer LTSE Helper'; DisplayVersion = '1.2.73.0' },
  [pscustomobject]@{ DisplayName = 'Visualizer LTSE 1.2.72.0'; DisplayVersion = '1.2.72.0' }
)
$wrongVersion = Select-VersionSuffixed @(
  [pscustomobject]@{ DisplayName = 'Visualizer LTSE 1.2.73.0'; DisplayVersion = '1.2.72.0' }
)
$ambiguous = Select-VersionSuffixed @(
  [pscustomobject]@{ DisplayName = 'Visualizer LTSE 1.2.73.0'; DisplayVersion = '1.2.73.0' },
  [pscustomobject]@{ DisplayName = 'Visualizer LTSE 1.2.73.0'; DisplayVersion = '1.2.73.0' }
)
[pscustomobject]@{ OneMatch = @($oneMatch).Count; WrongVersion = @($wrongVersion).Count; Ambiguous = @($ambiguous).Count } | ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8' }
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        OneMatch: 1,
        WrongVersion: 0,
        Ambiguous: 2,
      });
    }
  );

  it('selects only one visible strict-name-prefix ARP entry with the exact requested version', () => {
    expect(packager).toContain('$versionAlignedPrefixMatches = @($changedApplications');
    expect(packager).toContain(
      "$candidateComparableName.StartsWith($configuredUninstallComparableName + '' '', [System.StringComparison]::OrdinalIgnoreCase)"
    );
    expect(packager).toContain(
      'if ($versionAlignedPrefixMatches.Count -eq 1) { $selectedApplications = $versionAlignedPrefixMatches }'
    );
    expect(packager.indexOf('$versionAlignedPrefixMatches')).toBeLessThan(
      packager.indexOf('$bundleCandidates')
    );
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'accepts the OpenOffice marketing-name suffix without accepting helpers, hidden entries, version drift, or ambiguity',
    () => {
      const result = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `$configuredName = 'OpenOffice'
$configuredVersion = '4.116.9816'
function Select-VersionAlignedPrefix([object[]]$Applications) {
  return @($Applications | Where-Object {
    $systemComponentProperty = $_.PSObject.Properties['SystemComponent']
    $isVisibleApplication = -not $systemComponentProperty -or -not [bool]$systemComponentProperty.Value
    $candidateName = ([string]$_.DisplayName).Trim()
    $hasConfiguredNameBoundary = (
      $candidateName.StartsWith($configuredName + ' ', [System.StringComparison]::OrdinalIgnoreCase) -or
      $candidateName.StartsWith($configuredName + '(', [System.StringComparison]::OrdinalIgnoreCase)
    )
    $isVisibleApplication -and $hasConfiguredNameBoundary -and
      [string]$_.DisplayVersion -eq $configuredVersion
  })
}
$oneMatch = Select-VersionAlignedPrefix @(
  [pscustomobject]@{ DisplayName = 'OpenOffice 4.1.16'; DisplayVersion = '4.116.9816'; SystemComponent = 0 },
  [pscustomobject]@{ DisplayName = 'OpenOfficeConnector'; DisplayVersion = '4.116.9816'; SystemComponent = 0 },
  [pscustomobject]@{ DisplayName = 'Microsoft Visual C++ Runtime'; DisplayVersion = '4.116.9816'; SystemComponent = 0 },
  [pscustomobject]@{ DisplayName = 'OpenOffice Helper'; DisplayVersion = '4.116.9816'; SystemComponent = 1 },
  [pscustomobject]@{ DisplayName = 'OpenOffice 4.1.15'; DisplayVersion = '4.115.9815'; SystemComponent = 0 }
)
$wrongVersion = Select-VersionAlignedPrefix @(
  [pscustomobject]@{ DisplayName = 'OpenOffice 4.1.16'; DisplayVersion = '4.115.9815'; SystemComponent = 0 }
)
$ambiguous = Select-VersionAlignedPrefix @(
  [pscustomobject]@{ DisplayName = 'OpenOffice 4.1.16'; DisplayVersion = '4.116.9816'; SystemComponent = 0 },
  [pscustomobject]@{ DisplayName = 'OpenOffice (x86)'; DisplayVersion = '4.116.9816'; SystemComponent = 0 }
)
[pscustomobject]@{ OneMatch = @($oneMatch).Count; WrongVersion = @($wrongVersion).Count; Ambiguous = @($ambiguous).Count } | ConvertTo-Json -Compress`,
        ],
        { encoding: 'utf8' }
      );

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        OneMatch: 1,
        WrongVersion: 0,
        Ambiguous: 2,
      });
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'emits the version-aligned prefix capture for the OpenOffice Nullsoft-to-MSI lifecycle',
    () => {
      const generated = generateRegistryUninstallPackage(
        'nullsoft',
        'Apache OpenOffice',
        [],
        {},
        [],
        'Apache.OpenOffice',
        'OpenOffice',
        '4.116.9816',
        'REGISTRY_UNINSTALL:OpenOffice',
        '/S /GUILEVEL=qn /PARAM1="/norestart"'
      );

      expect(generated).toContain("$configuredUninstallDisplayName = 'OpenOffice'");
      expect(generated).toContain('$versionAlignedPrefixMatches = @($changedApplications');
      expect(generated).toContain(
        'if ($versionAlignedPrefixMatches.Count -eq 1) { $selectedApplications = $versionAlignedPrefixMatches }'
      );
    },
    30_000
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'emits version-suffixed capture and uninstall fallback for Visualizer LTSE',
    () => {
      const generated = generateRegistryUninstallPackage(
        'zip',
        'Visualizer LTSE',
        [],
        {},
        [],
        'IPEVO.VisualizerLTSE',
        'Visualizer LTSE',
        '1.2.73.0'
      );

      expect(generated).toContain('$configuredUninstallVersionedName = if (');
      expect(generated).toContain('$versionSuffixedMatches = @($changedApplications');
      expect(generated).toContain('$configuredVersionedAppName = if (');
      expect(generated).toContain(
        "Get-ADTApplication -Name $configuredVersionedAppName -NameMatch 'Exact'"
      );
    },
    30_000
  );

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

  it('launches a registered vendor uninstaller outside the application directory', () => {
    expect(packager).toContain(
      '$registeredUninstallWorkingDirectory = $adtSession.DirSupportFiles'
    );
    expect(packager).toContain(
      '$registeredUninstallWorkingDirectory = $adtSession.DirFiles'
    );
    expect(packager).not.toContain(
      '$registeredUninstallWorkingDirectory = Split-Path -Parent $registeredUninstallFile'
    );
  });

  it('keeps registered PowerShell script uninstallers bounded in both customer packagers', () => {
    for (const source of [packager, hostedPackager]) {
      expect(source).toContain('$isRegisteredPowerShellHost');
      expect(source).toContain('$powerShellFileSwitchIndexes.Count -ne 1');
      expect(source).toContain('[string]$registeredApplication.InstallLocation');
      expect(source).toContain('[Uri]::TryCreate($registeredPowerShellScript');
      expect(source).toContain('$registeredPowerShellScriptUri.IsFile');
      expect(source).toContain('[StringComparison]::OrdinalIgnoreCase');
      expect(source.replaceAll('\\\\', '\\')).toContain(
        'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
      );
      expect(source).toContain(
        'The registered PowerShell uninstall command contains an unsupported host switch'
      );
      expect(source).not.toContain('Get-Command powershell');
      expect(source).not.toContain('[IO.Path]::IsPathFullyQualified');
    }
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'emits a parseable exact PowerShell -File uninstall contract',
    () => {
      const generated = generateRegistryUninstallPackage('exe', 'Namma Agent');

      expect(generated).toContain(
        "$isRegisteredPowerShellHost = $registeredUninstallLeaf -in @('powershell', 'powershell.exe')"
      );
      expect(generated).toContain(
        "$registeredUninstallFile = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'"
      );
      expect(generated).toContain(
        '$registeredPowerShellScript.StartsWith('
      );
      expect(generated).toContain(
        'The registered PowerShell uninstall script is outside the captured install location.'
      );
    }
  );

  it('never captures an unrelated background ARP change as the installed product', () => {
    expect(packager).not.toContain(
      'if ($selectedApplications.Count -eq 0 -and $changedApplications.Count -eq 1)'
    );
    expect(packager).not.toContain(
      '$selectedApplications = @($changedApplications[0])'
    );
    expect(packager).toContain(
      'if ($selectedApplications.Count -eq 0 -and -not $configuredUninstallProductCode -and $configuredUninstallPublisherName)'
    );
    expect(packager).toContain(
      '[string]$_.Publisher -eq $configuredUninstallPublisherName'
    );
  });

  it('keeps visible-primary ARP selection opt-in, identity-bounded, and fail-closed', () => {
    expect(packager).toContain(
      "-Name 'reviewedPreferVisiblePrimaryUninstallRegistration'"
    );
    expect(packager).toContain(
      '$visiblePrimaryMatches = @($selectedApplications | Where-Object {'
    );
    expect(packager).toContain(
      'if ($visiblePrimaryMatches.Count -eq 1) { $selectedApplications = $visiblePrimaryMatches }'
    );
    expect(packager).toContain(
      '$visiblePrimaryMatches = @($installedApps | Where-Object {'
    );
    expect(packager).toContain(
      'if ($visiblePrimaryMatches.Count -eq 1) { $installedApps = $visiblePrimaryMatches }'
    );
    expect(packager.indexOf('$visiblePrimaryMatches = @($selectedApplications')).toBeLessThan(
      packager.indexOf("'    if ($selectedApplications.Count -eq 1) {'")
    );
    expect(packager.indexOf('$visiblePrimaryMatches = @($installedApps')).toBeLessThan(
      packager.indexOf('if ($installedApps.Count -ne 1)')
    );
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses a reviewed renamed ARP identity instead of a stale transitional MSI ProductCode',
    () => {
      const generated = generateRegistryUninstallPackage(
        'msi',
        'Poly Lens',
        [],
        { reviewedRegistryUninstallDisplayName: 'Poly Studio' },
        [],
        'Poly.PolyLens'
      );

      expect(generated).toContain("$configuredUninstallProductCode = ''");
      expect(generated).toContain("$configuredUninstallDisplayName = 'Poly Studio'");
      expect(generated).toContain("$appName = 'Poly Studio'");
    },
    30_000
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses Jamovi current installer registered identity instead of its stale catalog name',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Jamovi Desktop',
        [],
        { reviewedRegistryUninstallDisplayName: 'jamovi' },
        [],
        'Jamovi.Desktop.Current'
      );

      expect(generated).toContain("$configuredUninstallDisplayName = 'jamovi'");
      expect(generated).toContain("$appName = 'jamovi'");
    },
    30_000
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'writes generated deployment scripts as UTF-8 with BOM for Windows PowerShell',
    () => {
      const displayName = '班级优化大师';
      const generated = generateRegistryUninstallPackage(
        'nullsoft',
        displayName,
        [],
        {},
        [],
        'Seewo.EasiCare',
        displayName,
        '2.1.0.1428',
        `REGISTRY_UNINSTALL:${displayName}`,
        '/S',
        'machine',
        '',
        '',
        (packageDirectory) => {
          const scriptBytes = readFileSync(
            join(packageDirectory, 'Invoke-AppDeployToolkit.ps1')
          );
          expect(Array.from(scriptBytes.subarray(0, 3))).toEqual([
            0xef,
            0xbb,
            0xbf,
          ]);
        }
      );

      expect(generated).toContain(
        `$configuredUninstallDisplayName = '${displayName}'`
      );
      expect(generated).toContain(`$appName = '${displayName}'`);
    },
    30_000
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'appends IrfanView\'s documented silent switch to its captured ARP command',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'IrfanView',
        [],
        { reviewedUninstallArguments: ['/silent'] },
        [],
        'IrfanSkiljan.IrfanView'
      );

      expect(generated).toContain("$reviewedUninstallArguments = @('/silent')");
      expect(generated).toContain(
        '$registeredUninstallArguments += $reviewedArgument'
      );
    },
    30_000
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'emits the reviewed visible-primary selector only when enabled',
    () => {
      const enabled = generateRegistryUninstallPackage(
        'exe',
        'Surfshark',
        [],
        { reviewedPreferVisiblePrimaryUninstallRegistration: true },
        [],
        'Surfshark.Surfshark'
      );
      const disabled = generateRegistryUninstallPackage('exe');

      expect(enabled).toContain(
        '$visiblePrimaryMatches = @($selectedApplications | Where-Object {'
      );
      expect(enabled).toContain(
        '$visiblePrimaryMatches = @($installedApps | Where-Object {'
      );
      expect(disabled).not.toContain('$visiblePrimaryMatches');
    },
    30_000
  );

  it('logs bounded ARP identity metadata before rejecting an ambiguous install delta', () => {
    expect(packager).toContain(
      '@($changedApplications | Select-Object -First 20)'
    );
    expect(packager).toContain('foreach ($ambiguousApplication in $diagnosticApplications)');
    expect(packager).toContain('ARP delta diagnostics truncated after');
    expect(packager).toContain(
      'Ambiguous vendor uninstall candidate: name=[$($ambiguousApplication.DisplayName)]; publisher=[$($ambiguousApplication.Publisher)]; version=[$($ambiguousApplication.DisplayVersion)]; key=[$($ambiguousApplication.PSChildName)]; windowsInstaller=[$([bool]$ambiguousApplication.WindowsInstaller)]; systemComponent=[$ambiguousSystemComponent]; uninstallLeaf=[$ambiguousUninstallLeaf].'
    );
    expect(packager).toContain(
      'throw "Could not select one vendor uninstall entry. The installer changed $($changedApplications.Count) entries and $($selectedApplications.Count) matched the configured identity."'
    );
    expect(packager).toContain(
      'throw "Could not find one unambiguous vendor uninstall registry entry for [$appName]. Found $($installedApps.Count); refusing broad removal."'
    );
    expect(packager).toContain(
      "-Severity ''Warning'' -Source ''Uninstall-ADTDeployment''"
    );
  });

  it('prefers a registered Burn helper and keeps the packaged fallback for disposable caches', () => {
    expect(packager).toContain("if ($registeredInstallerTypeLower -eq 'burn')");
    expect(packager).toContain(
      '$capturedMsiProductCode = if ($registeredApplication.WindowsInstaller -and $registeredApplication.ProductCode)'
    );
    expect(packager).toContain(
      "$registeredUninstallLeaf -in @(''msiexec'', ''msiexec.exe'') -and [string]$registeredApplication.PSChildName -match"
    );
    expect(packager).toContain(
      'The exact GUID key plus an MsiExec command is still an authoritative MSI identity.'
    );
    expect(packager).toContain(
      'The Burn-labeled package registered Windows Installer product [$capturedMsiProductCode]; executing its exact MSI uninstall.'
    );
    expect(packager).toContain(
      "Start-ADTMsiProcess -Action ''Uninstall'' -ProductCode $capturedMsiProductCode"
    );
    expect(packager).toContain(
      '[string[]]$registeredUninstallArguments = @($registeredApplication."$($registeredUninstallProperty)ArgumentList" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })'
    );
    expect(packager).toContain(
      "foreach ($requiredBurnArgument in @(''/uninstall'', ''/quiet'', ''/norestart''))"
    );
    expect(packager).toContain(
      "$normalizedRequiredBurnArgument = $requiredBurnArgument -replace ''^[/-]+'', ''''"
    );
    expect(packager).toContain(
      "$registeredUninstallArguments += $requiredBurnArgument"
    );
    expect(packager).not.toContain(
      "if ($registeredUninstallArguments.Count -eq 0) {"
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
      '$bundleCandidates = @($changedApplications | Where-Object {'
    );
    expect(packager).toContain(
      '$bundleCandidates = @($selectedApplications | Where-Object {'
    );
    expect(packager).toContain(
      '$isVisibleApplication -and -not $_.WindowsInstaller'
    );
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'narrows an ambiguous executable-wrapper display-name match to the single top-level entry',
    () => {
      for (const installerType of ['burn', 'exe']) {
        const generated = generateRegistryUninstallPackage(installerType, 'Wrapped App');

        expect(generated).toContain('if ($selectedApplications.Count -gt 1)');
        expect(generated).toContain(
          '$bundleCandidates = @($selectedApplications | Where-Object {'
        );
        expect(generated).toContain('$isVisibleApplication -and -not $_.WindowsInstaller');
        expect(generated.indexOf('if ($selectedApplications.Count -gt 1)')).toBeLessThan(
          generated.indexOf('if ($selectedApplications.Count -eq 1) { break }')
        );
        expect(generated).toContain(
          '$topLevelWrapperMatches = @($installedApps | Where-Object {'
        );
        expect(generated).toContain(
          'if ($topLevelWrapperMatches.Count -eq 1) { $installedApps = $topLevelWrapperMatches }'
        );
      }
    }
  );

  it('uses the effective registered engine for archived executable-wrapper disambiguation', () => {
    expect(packager).toContain(
      "if ($registeredInstallerTypeLower -in @('burn', 'exe'))"
    );
    expect(packager).toContain(
      "if ($registeredInstallerTypeLower -eq 'burn')"
    );
    expect(packager).not.toContain(
      "if ($originalInstallerType -in @('burn', 'exe'))"
    );
    expect(hostedPackager).toContain(
      "if ($selectedApplications.Count -gt 1 -and '${registeredInstallerType}' -in @('burn', 'exe'))"
    );
    expect(hostedPackager).toContain(
      "if ($installedApps.Count -gt 1 -and '${registeredInstallerType}' -in @('burn', 'exe'))"
    );
    expect(hostedPackager).toContain(
      "if (registeredInstallerType === 'burn')"
    );
  });

  it.runIf(canRunWindowsPowerShellPackager)(
    'does not emit executable-wrapper duplicate-entry narrowing for native installer packages',
    () => {
      const generated = generateRegistryUninstallPackage('inno', 'Example App');

      expect(generated).not.toContain(
        'A top-level executable wrapper and its chained MSI can intentionally share the same ARP display name.'
      );
      expect(generated).not.toContain('$topLevelWrapperMatches');
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
        '[string]$_.Publisher -eq $configuredUninstallPublisherName'
      );
      expect(burnGenerated).toContain('$isVisibleApplication -and -not $_.WindowsInstaller');
      expect(burnGenerated).toContain(
        'A top-level executable wrapper and its chained MSI can intentionally share the same ARP display name.'
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

  it('adds the vendor-documented quiet switch to exact Autodesk ODIS uninstall commands', () => {
    expect(packager).toContain(
      "$autodeskOdisInstaller = [Environment]::ExpandEnvironmentVariables(''%ProgramW6432%\\Autodesk\\AdODIS\\V1\\Installer.exe'')"
    );
    expect(packager).toContain(
      "$registeredArgumentText -match ''(?i)(^|\\s)-i\\s+uninstall(\\s|$)''"
    );
    expect(packager).toContain(
      "$registeredArgumentText -match ''(?i)(^|\\s)--trigger_point\\s+system(\\s|$)''"
    );
    expect(packager).toContain(
      "$registeredArgumentText -notmatch ''(?i)(^|\\s)(-q|--silent)(\\s|$)''"
    );
    expect(packager).toContain("$additionalUninstallArguments += ''-q''");
    expect(packager).toContain(
      'Using the verified Autodesk ODIS silent uninstall switch.'
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
    'keeps the reviewed Logitech G HUB bootstrapper observable and removes it silently',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Logitech G HUB',
        [],
        {
          processesToClose: [
            { name: 'lghub', description: 'Logitech G HUB' },
            { name: 'lghub_agent', description: 'Logitech G HUB Agent' },
            { name: 'lghub_updater', description: 'Logitech G HUB Updater' },
            {
              name: 'lghub_software_manager',
              description: 'Logitech G HUB Software Manager',
            },
          ],
          reviewedInstallCompletionTimeoutMinutes: 15,
          reviewedExactUninstall: {
            executablePath: '%ProgramFiles%\\LGHUB\\lghub_updater.exe',
            arguments: ['--uninstall', '--full'],
            completionTimeoutMinutes: 10,
          },
        },
        [],
        'Logitech.GHUB',
        'Logitech G HUB',
        '2026.4.919028',
        'REGISTRY_UNINSTALL:Logitech G HUB',
        '--silent'
      );

      expect(generated).toContain(
        "Start-ADTProcess -FilePath $installerPath -ArgumentList '--silent' -WindowStyle Hidden -WaitForMsiExec -NoWait -PassThru"
      );
      expect(generated).not.toContain('-ArgumentList $installerArgumentList');
      expect(generated).toContain(
        'Write-ADTLogEntry -Message "The reviewed vendor installer is still working."'
      );
      expect(generated).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles%\\LGHUB\\lghub_updater.exe')"
      );
      expect(generated).toContain(
        "$registeredUninstallArguments = @('--uninstall', '--full')"
      );
      expect(generated).toContain('$effectiveUninstallCompletionTimeoutMinutes = if ($useReviewedExactUninstall) { 10 }');
      expect(generated).toContain("@{ Name = 'lghub'; Description = 'Logitech G HUB' }");
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'keeps a reviewed Webroot MSI custom action observable and bounded',
    () => {
      const generated = generateRegistryUninstallPackage(
        'msi',
        'Webroot SecureAnywhere',
        [],
        {
          reviewedInstallArguments: ['CMDLINE=SME,quiet'],
          reviewedInstallCompletionTimeoutMinutes: 30,
        },
        [],
        'Webroot.SecureAnywhere',
        'Webroot SecureAnywhere',
        '9.0.45.63',
        'REGISTRY_UNINSTALL:Webroot SecureAnywhere',
        '/qn /norestart ALLUSERS=1'
      );

      expect(generated).toContain(
        '$installDeadline = [DateTime]::UtcNow.AddMinutes(30)'
      );
      expect(generated).toContain(
        "$msiInstallerPath = Join-Path $adtSession.DirFiles 'setup.exe'"
      );
      expect(generated).toContain(
        '$msiArgumentList = \'/i "{0}" REBOOT=ReallySuppress /QN\' -f $msiInstallerPath'
      );
      expect(generated).toContain(
        "$msiAdditionalArgumentList = '/norestart ALLUSERS=1 CMDLINE=SME,quiet'"
      );
      expect(generated).toContain(
        '$msiArgumentList = "$msiArgumentList /L*V `"$msiLogPath`""'
      );
      expect(generated).toContain(
        '$installHandle = Start-ADTProcess -FilePath "$env:SystemRoot\\System32\\msiexec.exe" -ArgumentList $msiArgumentList -WorkingDirectory $adtSession.DirFiles -WindowStyle Hidden -WaitForMsiExec -NoWait -PassThru'
      );
      expect(generated).not.toMatch(/Start-ADTMsiProcess[^\r\n]*-NoWait/);
      expect(generated).toContain(
        'Write-ADTLogEntry -Message "The reviewed MSI installer is still working."'
      );
      expect(generated).toContain(
        '$installProcessExitCode = $installHandle.Task.GetAwaiter().GetResult().ExitCode'
      );
      expect(generated).toContain(
        "throw 'The reviewed MSI installer did not complete within 30 minutes.'"
      );
      executeReviewedMsiInstallBlock(generated);
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'combines Egnyte update-on-boot with the managed MSI reboot suppression',
    () => {
      const generated = generateRegistryUninstallPackage(
        'msi',
        'Egnyte Desktop App',
        [],
        { reviewedInstallArguments: ['ED_UPDATE_ON_BOOT=1'] },
        [],
        'Egnyte.EgnyteDesktopApp',
        'Egnyte Desktop App',
        '4.5.1.201',
        'msiexec /x "{D205BFAE-B251-4EDF-B4DF-5ABF19F96B59}" /qn /norestart',
        '/quiet ALLUSERS=1'
      );

      expect(generated).toContain(
        "Start-ADTMsiProcess -Action 'Install' -FilePath 'setup.exe' -AdditionalArgumentList 'ALLUSERS=1 ED_UPDATE_ON_BOOT=1'"
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'keeps a reviewed nested FlashPrint bootstrapper observable',
    () => {
      const generated = generateRegistryUninstallPackage(
        'zip',
        'FlashPrint',
        [],
        { reviewedInstallCompletionTimeoutMinutes: 15 },
        [],
        'Flashforge.FlashPrint',
        'FlashPrint',
        '5.8.3',
        'REGISTRY_UNINSTALL:FlashPrint',
        '/exenoui /qb! REBOOT=ReallySuppress',
        'machine',
        'exe',
        'FlashPrint 5_5.8.3_x64.exe'
      );

      expect(generated).toContain(
        '$installDeadline = [DateTime]::UtcNow.AddMinutes(15)'
      );
      expect(generated).toContain(
        "Start-ADTProcess -FilePath $nestedInstallerPath -ArgumentList '/exenoui /qb! REBOOT=ReallySuppress' -WindowStyle Hidden -WaitForMsiExec -NoWait -PassThru"
      );
      expect(generated).toContain(
        'Write-ADTLogEntry -Message "The reviewed nested vendor installer is still working."'
      );
      expect(generated).toContain(
        '$installProcessExitCode = $installHandle.Task.GetAwaiter().GetResult().ExitCode'
      );
      expect(generated).not.toContain(
        "Start-ADTProcess -FilePath $nestedInstallerPath -ArgumentList '/exenoui /qb! REBOOT=ReallySuppress' -WindowStyle Hidden -WaitForMsiExec -Timeout"
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'packages Teradata vendor-documented silent archive removal for QA and customers',
    () => {
      const reviewedArchiveUninstall = {
        relativePath: 'TeradataODBC\\silent_uninstall.bat',
        arguments: ['ALL'],
        completionTimeoutMinutes: 15,
      };
      const generated = generateRegistryUninstallPackage(
        'zip',
        'Teradata ODBC Driver',
        [],
        { reviewedArchiveUninstall },
        [],
        'Teradata.TTUOdbc',
        'Teradata ODBC Driver',
        '20.00.38.00',
        'REGISTRY_UNINSTALL_PRODUCT:{F075B63A-C629-41F8-BA56-33D9940F2000}:Teradata ODBC Driver',
        '/silent ALLARGS="{F075B63A-C629-41F8-BA56-33D9940F2000} 20.00 "ALL" ODBC"',
        'machine',
        'exe',
        'TeradataODBC\\TTUSuiteSilent.exe',
        (packageDirectory) => {
          const helperPath = join(
            packageDirectory,
            'SupportFiles',
            'Invoke-IntuneGetReviewedArchiveUninstall.ps1'
          );
          const configPath = join(
            packageDirectory,
            'SupportFiles',
            'ReviewedArchiveUninstall.json'
          );
          expect(existsSync(helperPath)).toBe(true);
          expect(readFileSync(helperPath, 'utf8')).toBe(reviewedArchiveUninstallHelper);
          expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
            relativePath: reviewedArchiveUninstall.relativePath,
            arguments: reviewedArchiveUninstall.arguments,
          });
          expect(existsSync(join(packageDirectory, 'Files', 'setup.zip'))).toBe(true);
        }
      );

      expect(generated).toContain(
        "$reviewedArchiveUninstallScript = Join-Path $adtSession.DirSupportFiles 'Invoke-IntuneGetReviewedArchiveUninstall.ps1'"
      );
      expect(generated).toContain(
        "$reviewedArchivePath = Join-Path $adtSession.DirFiles 'setup.zip'"
      );
      expect(generated).toContain(
        "$registeredUninstallFile = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'"
      );
      expect(generated).toContain(
        "'-File', $reviewedArchiveUninstallScript, '-ArchivePath', $reviewedArchivePath"
      );
      expect(generated).toContain(
        '$effectiveUninstallCompletionTimeoutMinutes = if ($useReviewedExactUninstall) { 15 }'
      );
      expect(generated).toContain(
        '} elseif ($isRegisteredPowerShellHost -and -not $useReviewedExactUninstall) {'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses Wiris MathType official silent removal instead of the generic Nullsoft fallback',
    () => {
      const generated = generateRegistryUninstallPackage(
        'nullsoft',
        'MathType 7',
        [],
        {
          reviewedExactUninstall: {
            executablePath: '%ProgramFiles(x86)%\\MathType\\Setup.exe',
            arguments: ['-Q', '-R'],
            completionTimeoutMinutes: 5,
          },
        },
        [],
        'Wiris.MathType.7',
        'MathType 7',
        '7.12.2',
        'REGISTRY_UNINSTALL_KEY:DSMT7:MathType 7',
        '-Q'
      );

      expect(generated).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles(x86)%\\MathType\\Setup.exe')"
      );
      expect(generated).toContain("$registeredUninstallArguments = @('-Q', '-R')");
      expect(generated).not.toContain("$registeredUninstallArguments = @('-R', '/S')");
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'uses Logi Bolt /silent instead of the generic Nullsoft /S fallback',
    () => {
      const generated = generateRegistryUninstallPackage(
        'nullsoft',
        'Logi Bolt',
        [],
        {
          reviewedExactUninstall: {
            executablePath: '%ProgramFiles%\\Logi\\LogiBolt\\LogiBoltUninstaller.exe',
            arguments: ['/silent'],
            completionTimeoutMinutes: 5,
          },
        },
        [],
        'Logitech.LogiBolt',
        'Logi Bolt',
        '1.2.6024.0',
        'REGISTRY_UNINSTALL_KEY:LogiBolt:Logi Bolt',
        '/silent'
      );

      expect(generated).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles%\\Logi\\LogiBolt\\LogiBoltUninstaller.exe')"
      );
      expect(generated).toContain("$registeredUninstallArguments = @('/silent')");
      expect(generated).not.toContain("$registeredUninstallArguments = @('/S')");
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'replaces Logitech LGS interactive mode with its reviewed silent helper contract',
    () => {
      const generated = generateRegistryUninstallPackage(
        'nullsoft',
        'Logitech Gaming Software',
        [],
        {
          reviewedExactUninstall: {
            executablePath:
              '%ProgramFiles%\\Logitech Gaming Software\\uninstallhlpr.exe',
            arguments: [
              '/bitness=x64',
              '/silentmode=on',
              '/langid=ENU',
              '/downgrade=no',
              '/firstRun=yes',
              '/S',
            ],
            completionTimeoutMinutes: 5,
          },
        },
        [],
        'Logitech.LGS',
        'Logitech Gaming Software',
        '9.04.49',
        'REGISTRY_UNINSTALL_KEY:Logitech Gaming Software:Logitech Gaming Software',
        '/S'
      );

      expect(generated).toContain(
        "[Environment]::ExpandEnvironmentVariables('%ProgramFiles%\\Logitech Gaming Software\\uninstallhlpr.exe')"
      );
      expect(generated).toContain(
        "$registeredUninstallArguments = @('/bitness=x64', '/silentmode=on', '/langid=ENU', '/downgrade=no', '/firstRun=yes', '/S')"
      );
      expect(generated).not.toContain('/silentmode=off');
      expect(generated).toContain(
        'Waiting for vendor uninstall registration [$registeredUninstallRegistryKey] to be removed.'
      );
    }
  );

  it.runIf(canRunWindowsPowerShellPackager)(
    'stops the reviewed Azure Monitor Agent service before MSI removal',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'Azure Monitor Agent',
        [],
        { reviewedUninstallServiceNames: ['AzureMonitorAgent'] },
        [],
        'Microsoft.AzureMonitorAgent',
        'Azure Monitor Agent',
        '1.44.0.0',
        'REGISTRY_UNINSTALL:Azure Monitor Agent',
        '/qn /norestart ALLUSERS=1'
      );
      const uninstallFunction = generated.slice(
        generated.indexOf('function Uninstall-ADTDeployment'),
        generated.indexOf('function Repair-ADTDeployment')
      );

      expect(uninstallFunction).toContain(
        "foreach ($reviewedServiceName in @('AzureMonitorAgent'))"
      );
      expect(uninstallFunction).toContain(
        'Stop-Service -Name $reviewedServiceName -Force -ErrorAction Stop'
      );
      expect(uninstallFunction.indexOf('Stop-Service')).toBeLessThan(
        uninstallFunction.indexOf('Executing MSI uninstall')
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
    for (const source of [packager, hostedPackager]) {
      expect(source).toContain(
        'The vendor uninstaller returned reboot-required exit code [$uninstallProcessExitCode]; the exact registration remains pending reboot.'
      );
    }
    expect(packager).not.toContain('TotalSeconds -ge 15');
  });

  it('keeps the reviewed MSI helper guard identical in both customer packagers', () => {
    for (const source of [packager, hostedPackager]) {
      expect(source).toContain('reviewedUninstallProcessGuard');
      expect(source).toContain('Get-CimInstance -ClassName Win32_Process');
      expect(source).toContain('CreationDate.ToUniversalTime()');
      expect(source).toContain('reviewedGuardCreationLookbackSeconds');
      expect(source).toContain(
        '[DateTime]::UtcNow.AddSeconds(-$reviewedGuardCreationLookbackSeconds)'
      );
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
      'The captured Burn/MSI uninstall command did not remove registration [$registeredUninstallRegistryKey] before the completion deadline.'
    );
    expect(packager).toContain(
      'The Burn uninstaller requested a reboot with exit code [$uninstallProcessExitCode].'
    );
    for (const source of [packager, hostedPackager]) {
      expect(source).toContain(
        'The Burn uninstaller returned reboot-required exit code [$uninstallProcessExitCode]; the exact registration remains pending reboot.'
      );
    }
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

  it('accepts leaf-only registered uninstall executables before exact command parsing', () => {
    expect(packager).toContain(
      '$registeredUninstallParentPath = Split-Path -Parent $registeredUninstallFile'
    );
    expect(packager).toContain(
      '$registeredUninstallParentLeaf = if ([string]::IsNullOrWhiteSpace($registeredUninstallParentPath)) {'
    );
    expect(packager).toContain("Split-Path -Leaf $registeredUninstallParentPath");
    expect(packager).not.toContain(
      'Split-Path -Leaf (Split-Path -Parent $registeredUninstallFile)'
    );
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

  it.runIf(canRunWindowsPowerShellPackager)(
    'bypasses empty registered EXE paths when an exact MSI product code is available',
    () => {
      const generated = generateRegistryUninstallPackage(
        'exe',
        'MSI Empty Path Contract',
        [],
        {},
        [],
        'IntuneGet.MsiEmptyPathContract',
        'MSI Empty Path Contract',
        '1.0.0',
        'REGISTRY_UNINSTALL_PRODUCT:{8D48EC0B-C512-43E6-BA0E-3876353DF7C2}:MSI Empty Path Contract'
      );
      const uninstallStart = generated.indexOf('function Uninstall-ADTDeployment');
      const uninstallEnd = generated.indexOf('function Repair-ADTDeployment', uninstallStart);
      const uninstall = generated.slice(uninstallStart, uninstallEnd);
      const exactMsiBranch = uninstall.indexOf('if ($capturedMsiProductCode) {');
      const registeredExeParsing = uninstall.indexOf(
        '$registeredUninstallProperty = if ($hasQuietUninstall)'
      );

      expect(exactMsiBranch).toBeGreaterThan(-1);
      expect(registeredExeParsing).toBeGreaterThan(exactMsiBranch);
      expect(uninstall.slice(exactMsiBranch, registeredExeParsing)).toContain(
        "Start-ADTMsiProcess -Action 'Uninstall' -ProductCode $capturedMsiProductCode"
      );
      expect(uninstall.slice(exactMsiBranch, registeredExeParsing)).not.toContain(
        'Split-Path'
      );

      const hostedExeParsing = hostedPackager.indexOf(
        "$registeredUninstallProperty = if ($hasQuietUninstall) { 'QuietUninstallString' } else { 'UninstallString' }"
      );
      const hostedMsiBranch = hostedPackager.lastIndexOf(
        'if ($capturedMsiProductCode) {',
        hostedExeParsing
      );
      expect(hostedMsiBranch).toBeGreaterThan(-1);
      expect(hostedExeParsing).toBeGreaterThan(hostedMsiBranch);
      expect(hostedPackager.slice(hostedMsiBranch, hostedExeParsing)).not.toContain(
        'Split-Path'
      );
    },
    30_000
  );

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
    expect(packager).toContain('Add-AppxProvisionedPackage -Online -PackagePath $packagePath');
    expect(packager).toContain('} -ArgumentList $msixPath');
    expect(packager).toContain('Wait-Job -Job $provisioningJob -Timeout 30');
    expect(packager).toContain('MSIX/APPX provisioning is still in progress');
    expect(packager).toContain('Receive-Job -Job $provisioningJob -ErrorAction Stop');
    expect(packager).toContain('Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers');
    expect(packager).toContain('if ($IsUserScope)');
  });
});
