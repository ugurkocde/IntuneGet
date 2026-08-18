import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JobProcessor } from '../src/job-processor';
import type { PackagingJob } from '../src/job-poller';

type ScriptGenerator = {
  generateDeployScript(job: PackagingJob, fileName: string): string;
  getInstallCommand(job: PackagingJob, fileName: string, silentSwitches: string): string;
  getUninstallCommand(job: PackagingJob, fileName: string): string;
  getPostInstallVerificationBlock(job: PackagingJob, escapedAppName: string): string;
  extractSilentSwitches(
    installCommand: string,
    installerType: string,
    nestedInstallerType?: string
  ): string;
};

const generator = JobProcessor.prototype as unknown as ScriptGenerator;

function packagingJob(overrides: Partial<PackagingJob> = {}): PackagingJob {
  return {
    id: 'candidate-1',
    user_id: 'user-1',
    user_email: 'qa@example.com',
    tenant_id: 'tenant-1',
    winget_id: 'EligianLabs.PIICrawlerCLI',
    version: '26.0807.2256',
    display_name: 'PIICrawler CLI',
    publisher: 'EligianLabs',
    architecture: 'x64',
    installer_type: 'zip',
    installer_url: 'https://example.com/piicrawler.zip',
    installer_sha256: 'A'.repeat(64),
    install_command: '',
    uninstall_command: 'REGISTRY_UNINSTALL:PIICrawler CLI',
    install_scope: 'machine',
    detection_rules: [],
    package_config: {
      nestedInstallerType: 'portable',
      nestedInstallerPath: 'piicrawler.exe',
      psadtConfig: {},
    },
    status: 'queued',
    progress_percent: 0,
    created_at: '2026-08-08T11:10:00.000Z',
    ...overrides,
  };
}

function installScript(job: PackagingJob): string {
  return generator.getInstallCommand.call(generator, job, 'piicrawler.zip', '');
}

function uninstallScript(job: PackagingJob): string {
  return generator.getUninstallCommand.call(generator, job, 'piicrawler.zip');
}

describe('nested portable PSADT generation', () => {
  it('safely stages a top-level portable zip payload', () => {
    const script = installScript(packagingJob({
      installer_type: 'portable',
      package_config: {},
    }));

    expect(script).toContain('[System.IO.Compression.ZipFile]::OpenRead($archivePath)');
    expect(script).toContain('Move-Item -LiteralPath $portableStageDir -Destination $installPath');
    expect(script).not.toContain('Zip package does not declare');
  });

  it('treats a zip without nested metadata as a portable archive', () => {
    const job = packagingJob({ package_config: {} });
    const script = installScript(job);

    expect(script).toContain('[System.IO.Compression.ZipFile]::OpenRead($archivePath)');
    expect(script).toContain('Move-Item -LiteralPath $portableStageDir -Destination $installPath');
    expect(script).not.toContain('$declaredNestedPath');
    expect(uninstallScript(job)).toContain('Remove-Item -LiteralPath $installPath -Recurse -Force');
  });

  it.each([
    ['Expand-Archive -Path "app.zip" -DestinationPath app -Force', 'zip', 'inno', '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-'],
    ['powershell.exe -Command Expand-Archive -Path app.zip -DestinationPath app', 'zip', 'inno', '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-'],
    ['"setup.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-', 'zip', 'inno', '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-'],
    ['"setup.exe" /configure https://aka.ms/fhlwingetconfig', 'exe', undefined, '/configure https://aka.ms/fhlwingetconfig'],
    ['msiexec.exe /i "agent.msi" /qn REBOOT=ReallySuppress ALLUSERS=1', 'msi', undefined, '/qn REBOOT=ReallySuppress ALLUSERS=1'],
    ['Expand-Archive -Path "app.zip" -DestinationPath app -Force', 'zip', undefined, ''],
    ['Expand-Archive -Path "app.zip" -DestinationPath app -Force', 'portable', undefined, ''],
  ])('extracts local silent switches without archive arguments', (command, type, nestedType, expected) => {
    expect(generator.extractSilentSwitches.call(generator, command, type, nestedType)).toBe(expected);
  });

  it('does not emit PowerShell archive tokens into a generated argument list', () => {
    const script = generator.generateDeployScript.call(generator, packagingJob({
      install_command: 'powershell.exe -Command Expand-Archive -Path app.zip -DestinationPath app',
    }), 'piicrawler.zip');

    expect(script).not.toMatch(/-ArgumentList '[^']*(?:-Command|-Archive)/);
  });
  it('preserves manifest-declared installer success exit codes', () => {
    const script = generator.generateDeployScript.call(generator, packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'piicrawler.exe',
        installerSuccessCodes: [1168],
        psadtConfig: {},
      },
    }), 'piicrawler.zip');
    expect(script).toContain('AppSuccessExitCodes = @(0, 1168)');
  });

  it('applies configured PSADT v4.1 processes before install and uninstall', () => {
    const script = generator.generateDeployScript.call(generator, packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'piicrawler.exe',
        psadtConfig: {
          processesToClose: [
            { name: 'StreamDeck.exe', description: "Elgato's Stream Deck" },
          ],
          showClosePrompt: false,
        },
      },
    }), 'piicrawler.zip');

    expect(script).toContain(
      "AppProcessesToClose = @(@{ Name = 'StreamDeck'; Description = 'Elgato''s Stream Deck' })"
    );
    expect(
      script.match(
        /Show-ADTInstallationWelcome -CloseProcesses \$adtSession\.AppProcessesToClose -Silent/g
      )
    ).toHaveLength(2);
  });

  it('uses a valid interactive deferral parameter set without duplicate countdowns', () => {
    const script = generator.generateDeployScript.call(generator, packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'piicrawler.exe',
        psadtConfig: {
          processesToClose: [{ name: 'Example', description: 'Example' }],
          showClosePrompt: false,
          allowDefer: true,
          deferTimes: 2,
          forceCloseProcessesCountdown: 45,
        },
      },
    }), 'piicrawler.zip');

    expect(script).toContain(
      'Show-ADTInstallationWelcome -CloseProcesses $adtSession.AppProcessesToClose -AllowDeferCloseProcesses -ForceCloseProcessesCountdown 45 -DeferTimes 2'
    );
    expect(script).not.toContain(
      '-ForceCloseProcessesCountdown 45 -ForceCloseProcessesCountdown'
    );
    expect(script).not.toContain('-Silent -ForceCloseProcessesCountdown');
  });

  it('fails closed instead of dropping malformed process lifecycle entries', () => {
    const job = packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'piicrawler.exe',
        psadtConfig: {
          processesToClose: [{ name: '..\\unsafe.exe', description: 'Unsafe' }],
        },
      },
    });

    expect(() => generator.generateDeployScript.call(generator, job, 'piicrawler.zip'))
      .toThrow('Invalid PSADT process name');
  });

  it('treats zero defer days as no day-based limit for PSADT v4.1', () => {
    const script = generator.generateDeployScript.call(generator, packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'piicrawler.exe',
        psadtConfig: {
          processesToClose: [{ name: 'Example', description: 'Example' }],
          allowDefer: true,
          deferTimes: 3,
          deferDays: 0,
        },
      },
    }), 'piicrawler.zip');

    expect(script).toContain('-AllowDeferCloseProcesses');
    expect(script).not.toContain('-DeferDays 0');

    const positiveScript = generator.generateDeployScript.call(generator, packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'piicrawler.exe',
        psadtConfig: { allowDefer: true, deferDays: 1.5 },
      },
    }), 'piicrawler.zip');
    expect(positiveScript).toContain('-DeferDays 1.5');

    const negativeJob = packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'piicrawler.exe',
        psadtConfig: { allowDefer: true, deferDays: -1 },
      },
    });
    expect(() => generator.generateDeployScript.call(generator, negativeJob, 'piicrawler.zip'))
      .toThrow('deferDays must be a number from 0 through 3650');
  });

  it('rejects string booleans and malformed deferral deadlines', () => {
    const stringBooleanJob = packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'piicrawler.exe',
        psadtConfig: { showClosePrompt: 'false' },
      },
    });
    expect(() => generator.generateDeployScript.call(
      generator,
      stringBooleanJob,
      'piicrawler.zip'
    )).toThrow('showClosePrompt must be a boolean');

    const invalidDeadlineJob = packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'piicrawler.exe',
        psadtConfig: { allowDefer: true, deferDeadline: 'next Tuesday' },
      },
    });
    expect(() => generator.generateDeployScript.call(
      generator,
      invalidDeadlineJob,
      'piicrawler.zip'
    )).toThrow('deferDeadline must be a valid ISO date');
  });

  it('safely stages the full archive and never executes the nested portable file', () => {
    const script = installScript(packagingJob());

    expect(script).toContain("$installPath = Join-Path $env:ProgramFiles 'PIICrawler CLI'");
    expect(script).toContain('[System.IO.Compression.ZipFile]::OpenRead($archivePath)');
    expect(script).toContain('Archive entry escapes the portable staging directory');
    expect(script).toContain("Join-Path $stageRoot 'piicrawler.exe'");
    expect(script).toContain('Move-Item -LiteralPath $portableStageDir -Destination $installPath');
    expect(script).not.toContain('Portable nested installers are not supported yet');
    expect(script).not.toContain('Running nested installer');
    expect(script).not.toContain('Expand-Archive');
  });

  it('removes the portable folder instead of using a registry uninstall sentinel', () => {
    const script = uninstallScript(packagingJob());

    expect(script).toContain("$installPath = Join-Path $env:ProgramFiles 'PIICrawler CLI'");
    expect(script).toContain('Remove-Item -LiteralPath $installPath -Recurse -Force');
    expect(script).not.toContain('REGISTRY_UNINSTALL');
    expect(script).not.toContain('cmd.exe');
  });

  it('keeps a custom uninstall command ahead of synthesized portable cleanup', () => {
    const job = packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'piicrawler.exe',
        psadtConfig: { uninstallCommand: 'cleanup.cmd /quiet' },
      },
    });

    const script = uninstallScript(job);

    expect(script).toContain('/c cleanup.cmd /quiet');
    expect(script).not.toContain('Remove-Item -LiteralPath $installPath');
  });

  it('uses the user programs directory for a user-scope portable package', () => {
    const job = packagingJob({ install_scope: 'user' });

    expect(installScript(job)).toContain(
      "$installPath = Join-Path $env:LOCALAPPDATA 'Programs\\PIICrawler CLI'",
    );
    expect(uninstallScript(job)).toContain(
      "$installPath = Join-Path $env:LOCALAPPDATA 'Programs\\PIICrawler CLI'",
    );
  });

  it.each([
    '..\\evil.exe',
    'folder\\..\\evil.exe',
    'C:\\evil.exe',
    '\\\\server\\share\\evil.exe',
    'folder\\tool.exe:payload',
  ])('rejects an unsafe declared nested path: %s', (nestedInstallerPath) => {
    const job = packagingJob({
      package_config: { nestedInstallerType: 'portable', nestedInstallerPath },
    });

    expect(() => installScript(job)).toThrow('Unsafe nested installer path');
  });

  it('normalizes a valid forward-slash nested path', () => {
    const job = packagingJob({
      package_config: {
        nestedInstallerType: 'portable',
        nestedInstallerPath: 'bin/piicrawler.exe',
      },
    });

    expect(installScript(job)).toContain("Join-Path $stageRoot 'bin\\piicrawler.exe'");
  });
});

describe('hosted PSADT portable generator', () => {
  it('contains the same safe nested-portable and uninstall decisions', () => {
    const scriptPath = fileURLToPath(
      new URL('../../.github/scripts/Create-PSADTPackage.ps1', import.meta.url),
    );
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain("$isNestedPortable = $installerTypeLower -eq 'zip'");
    expect(script).toContain("if ($installerTypeLower -eq 'portable' -or $isNestedPortable -or $isPlainPortableArchive)");
    expect(script).toContain('[System.IO.Compression.ZipFile]::OpenRead($installerPath)');
    expect(script).toContain('Archive entry escapes the portable staging directory');
    expect(script).not.toContain('Portable nested installers are not supported yet');
    expect(script).not.toContain('Zip package does not declare a nested installer');
    expect(script).toContain('if ($isNestedPortable -or $isPlainPortableArchive)');
    expect(script).toContain('Move-Item -LiteralPath $portableStageDir -Destination $installPath');
  });

  it('uses the non-admin PSADT log setting for user-scope packages', () => {
    const scriptPath = fileURLToPath(
      new URL('../../.github/scripts/Create-PSADTPackage.ps1', import.meta.url),
    );
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain("-Setting 'LogPathNoAdminRights'");
    expect(script).toContain('IntuneGet-PSADT-Bootstrap.log');
    expect(script).toContain('$env:LOCALAPPDATA\\IntuneGet\\Logs');
    expect(script).toContain('$env:WINDIR\\Logs\\Software');
    expect(script).toContain("`$envLocalAppData\\IntuneGet\\Logs");
    expect(script).not.toContain("-Setting 'LogPath' -ValueLiteral \"'C:\\ProgramData\\IntuneGet\\Logs'\"");
  });

  it('emits the PSADT progress dialog only when the package configuration enables it', () => {
    const scriptPath = fileURLToPath(
      new URL('../../.github/scripts/Create-PSADTPackage.ps1', import.meta.url),
    );
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('if ($progressConfig -and $progressConfig.enabled)');
    expect(script).toContain('"    Show-ADTInstallationProgress$progressParamsStr"');
    expect(script.match(/Show-ADTInstallationProgress/g)).toHaveLength(1);
  });

  it('captures the vendor registry entry instead of invoking Winget as SYSTEM for uninstall', () => {
    const scriptPath = fileURLToPath(
      new URL('../../.github/scripts/Create-PSADTPackage.ps1', import.meta.url),
    );
    const script = readFileSync(scriptPath, 'utf8');

    expect(script).toContain('$preInstallApplications = @(Get-ADTApplication');
    expect(script).toContain("-Name ''UninstallRegistryKey''");
    expect(script).toContain('Get-ADTApplication -FilterScript { $_.PSChildName -eq $capturedUninstallKey }');
    expect(script).toContain(
      '$uninstallHandle = Start-ADTProcess @uninstallProcessParameters',
    );
    expect(script).toContain('$uninstallHandle.Task.IsCompleted');
    expect(script).toContain('$uninstallHandle.Task.GetAwaiter().GetResult().ExitCode');
    expect(script).toContain("$psadtConfig.Contains('reviewedUninstallArguments')");
    expect(script).toContain('$registeredUninstallArguments += $reviewedArgument');
    expect(script).toContain("$psadtConfig.Contains('uninstallCompletionTimeoutMinutes')");
    expect(script).toContain(
      '$uninstallDeadline = [DateTime]::UtcNow.AddMinutes($uninstallCompletionTimeoutMinutes)'
    );
    expect(script).not.toContain('Start-ADTProcess -FilePath $wingetExe');
    expect(script).not.toContain('uninstall --id $wingetId');
  });
});

describe('Burn bundle PSADT generation', () => {
  it('prefers an exact registered Burn helper and retains the packaged fallback', () => {
    const job = packagingJob({
      winget_id: 'Python.Python.3.14',
      display_name: 'Python 3.14',
      installer_type: 'burn',
      installer_url: 'https://www.python.org/ftp/python/3.14.7/python-3.14.7-amd64.exe',
      uninstall_command:
        'REGISTRY_UNINSTALL_PRODUCT:{97b6de30-6082-48d1-9bb4-9f43296531a4}:Python 3.14',
    });

    const script = generator.getUninstallCommand.call(
      generator,
      job,
      'python-3.14.7-amd64.exe'
    );

    expect(script).toContain(
      "$configuredProductCode = '{97b6de30-6082-48d1-9bb4-9f43296531a4}'"
    );
    expect(script).toContain(
      '$_.PSChildName -eq $registeredUninstallRegistryKey'
    );
    expect(script).toContain(
      '[string[]]$registeredUninstallArguments = @($registeredApplication."$($registeredUninstallProperty)ArgumentList" | Where-Object'
    );
    expect(script).toContain("Join-Path $adtSession.DirFiles 'python-3.14.7-amd64.exe'");
    expect(script).toContain(
      '$registeredUninstallFile = [string]$registeredApplication."$($registeredUninstallProperty)FilePath"'
    );
    expect(script).toContain('$burnUninstaller = $registeredUninstallFile');
    expect(script).toContain('$burnUninstaller = $bundledUninstaller');
    expect(script).toContain('FilePath = $burnUninstaller');
    expect(script).toContain('WorkingDirectory = $burnUninstallWorkingDirectory');
    expect(script).toContain("WindowStyle = 'Hidden'");
    expect(script).toContain(
      'The Burn uninstall command did not remove registration [$registeredUninstallRegistryKey]'
    );
    expect(script).toContain('$uninstallDeadline = [DateTime]::UtcNow.AddMinutes(5)');
    expect(script).toContain('NoWait = $true');
    expect(script).toContain('WaitForMsiExec = $true');
    expect(script).toContain('$uninstallHandle = Start-ADTProcess @uninstallProcessParameters');
    expect(script).toContain('The Burn uninstall parent process exited with code');
    expect(script).toContain('foreach ($verificationAttempt in 1..5)');
    expect(script).not.toContain("Start-ADTMsiProcess -Action 'Uninstall'");
  });

  it('narrows duplicate bundle and chained-MSI display names to the bundle entry', () => {
    const job = packagingJob({
      winget_id: 'Formlabs.PreForm',
      display_name: 'PreForm',
      installer_type: 'burn',
      uninstall_command: 'REGISTRY_UNINSTALL:PreForm',
    });

    const verification = generator.getPostInstallVerificationBlock.call(
      generator,
      job,
      'PreForm'
    );

    expect(verification).toContain(
      "if ($selectedApplications.Count -gt 1 -and 'burn' -eq 'burn')"
    );
    expect(verification).toContain(
      '$bundleCandidates = @($selectedApplications | Where-Object {'
    );
    expect(verification).toContain('$isVisibleApplication -and -not $_.WindowsInstaller');
    expect(verification.indexOf('$selectedApplications.Count -gt 1')).toBeLessThan(
      verification.indexOf('$selectedApplications.Count -eq 1) { break }')
    );
  });

  it('keeps Burn-only duplicate-entry narrowing disabled for non-Burn packages', () => {
    const job = packagingJob({
      installer_type: 'inno',
      uninstall_command: 'REGISTRY_UNINSTALL:Example App',
    });

    const verification = generator.getPostInstallVerificationBlock.call(
      generator,
      job,
      'Example App'
    );

    expect(verification).toContain("$selectedApplications.Count -gt 1 -and 'inno' -eq 'burn'");
    expect(verification).not.toContain(
      "$selectedApplications.Count -gt 1 -and 'inno' -eq 'inno'"
    );
  });
});

describe('EXE product identity PSADT generation', () => {
  it('uses a reviewed exact non-MSI registry key for install capture and removal', () => {
    const job = packagingJob({
      winget_id: 'CodecGuide.K-LiteCodecPack.Full',
      display_name: 'K-Lite Codec Pack Full',
      installer_type: 'inno',
      uninstall_command:
        'REGISTRY_UNINSTALL_KEY:KLiteCodecPack_is1:K-Lite Codec Pack Full',
    });

    const snapshot = generator.getRegistryInstallSnapshotBlock.call(
      generator,
      job,
      'K-Lite Codec Pack Full'
    );
    const verification = generator.getPostInstallVerificationBlock.call(
      generator,
      job,
      'K-Lite Codec Pack Full'
    );
    const uninstall = generator.getUninstallCommand.call(
      generator,
      job,
      'klcp_full.exe'
    );

    expect(snapshot).toContain(
      "$configuredUninstallProductCode = 'KLiteCodecPack_is1'"
    );
    expect(verification).toContain(
      '[string]$_.PSChildName -eq $configuredUninstallProductCode'
    );
    expect(uninstall).toContain(
      "$configuredProductCode = 'KLiteCodecPack_is1'"
    );
    expect(uninstall).toContain(
      '$_.PSChildName -eq $configuredProductCode'
    );
    expect(uninstall).toContain("'inno' -eq 'inno'");
  });

  it('captures MSI identity when Winget leaves a PRODUCT_CODE placeholder', () => {
    const job = packagingJob({
      winget_id: 'Yealink.YealinkUSBConnect',
      display_name: 'Yealink USB Connect',
      installer_type: 'msi',
      uninstall_command: 'msiexec /x {PRODUCT_CODE} /qn /norestart',
    });

    const script = generator.generateDeployScript.call(generator, job, 'yealink.msi');
    const uninstall = generator.getUninstallCommand.call(generator, job, 'yealink.msi');

    expect(script).toContain('$preInstallApplications = @(Get-ADTApplication');
    expect(script).toContain('$capturedUninstallKey = [string]$selectedApplications[0].PSChildName');
    expect(uninstall).toContain('$capturedMsiProductCode');
    expect(uninstall).toContain("Start-ADTMsiProcess -Action 'Uninstall' -ProductCode $capturedMsiProductCode");
    expect(uninstall).not.toContain('{PRODUCT_CODE}');
    expect(uninstall).not.toContain("-ArgumentList '/c msiexec");
  });

  it('uses the same fail-closed architecture-label comparison as hosted packaging', () => {
    const verification = generator.getPostInstallVerificationBlock.call(
      generator,
      packagingJob({
        display_name: 'Mozilla Firefox',
        installer_type: 'nullsoft',
        uninstall_command: 'REGISTRY_UNINSTALL:Mozilla Firefox (en-US)',
      }),
      'Mozilla Firefox'
    );

    expect(verification).toContain('$configuredUninstallComparableName = ((');
    expect(verification).toContain('$architectureAgnosticMatches = @($changedApplications');
    expect(verification).toContain(
      'if ($architectureAgnosticMatches.Count -eq 1) { $selectedApplications = $architectureAgnosticMatches }'
    );
    expect(verification).toContain(
      '(x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)'
    );
    expect(verification.indexOf('$architectureAgnosticMatches')).toBeLessThan(
      verification.indexOf('$bundleCandidates')
    );
  });

  it('matches one publisher-decorated registry identity without widening the delta', () => {
    const verification = generator.getPostInstallVerificationBlock.call(
      generator,
      packagingJob({
        publisher: 'Microsoft',
        display_name: 'Microsoft SQL Server Management Studio 22',
        installer_type: 'exe',
        uninstall_command: 'REGISTRY_UNINSTALL:Microsoft SQL Server Management Studio 22',
      }),
      'Microsoft SQL Server Management Studio 22'
    );

    expect(verification).toContain("$configuredUninstallPublisherName = 'Microsoft'");
    expect(verification).toContain('$publisherAgnosticMatches = @($changedApplications');
    expect(verification).toContain(
      'if ($publisherAgnosticMatches.Count -eq 1) { $selectedApplications = $publisherAgnosticMatches }'
    );
    expect(verification.indexOf('$publisherAgnosticMatches')).toBeLessThan(
      verification.indexOf('$bundleCandidates')
    );
  });

  it('matches and removes one registry identity with the exact package-version suffix', () => {
    const job = packagingJob({
      winget_id: 'IPEVO.VisualizerLTSE',
      display_name: 'Visualizer LTSE',
      version: '1.2.73.0',
      installer_type: 'exe',
      uninstall_command: 'REGISTRY_UNINSTALL:Visualizer LTSE',
    });
    const verification = generator.getPostInstallVerificationBlock.call(
      generator,
      job,
      'Visualizer LTSE'
    );
    const uninstall = generator.getUninstallCommand.call(
      generator,
      job,
      'visualizer.exe'
    );

    expect(verification).toContain('$configuredUninstallVersionedName = if (');
    expect(verification).toContain('$versionSuffixedMatches = @($changedApplications');
    expect(verification).toContain(
      '[string]$_.DisplayVersion -eq $configuredUninstallVersion'
    );
    expect(uninstall).toContain('$configuredVersionedDisplayName = if (');
    expect(uninstall).toContain(
      "Get-ADTApplication -Name $configuredVersionedDisplayName -NameMatch 'Exact'"
    );
    expect(uninstall).toContain('[string]$_.DisplayVersion -eq $configuredVersion');
  });

  it('matches one localized registry identity without accepting helper entries', () => {
    const job = packagingJob({
      winget_id: 'Mozilla.Firefox.de',
      publisher: 'Mozilla',
      display_name: 'Mozilla Firefox (Deutsch)',
      installer_type: 'nullsoft',
      uninstall_command: 'REGISTRY_UNINSTALL:Mozilla Firefox (en-US)',
    });
    const script = generator.generateDeployScript.call(generator, job, 'firefox.exe');
    const verification = generator.getPostInstallVerificationBlock.call(
      generator,
      job,
      'Mozilla Firefox (Deutsch)'
    );

    expect(script).toContain("$configuredUninstallLocaleHint = 'de'");
    expect(verification).toContain('$configuredUninstallLocaleAgnosticName');
    expect(verification).toContain('$localeAgnosticMatches = @($changedApplications');
    expect(verification).toContain(
      'if ($localeAgnosticMatches.Count -eq 1) { $selectedApplications = $localeAgnosticMatches }'
    );
    expect(verification.indexOf('$localeAgnosticMatches')).toBeLessThan(
      verification.indexOf('$bundleCandidates')
    );
  });

  it('verifies and removes only the exact AppsAndFeatures product identity', () => {
    const job = packagingJob({
      winget_id: 'Adobe.Acrobat.Reader.64-bit',
      display_name: 'Adobe Acrobat Reader (64-bit)',
      installer_type: 'exe',
      uninstall_command:
        'REGISTRY_UNINSTALL_PRODUCT:{AC76BA86-1033-FF00-7760-BC15014EA700}:Adobe Acrobat Reader (64-bit)',
    });

    const verification = generator.getPostInstallVerificationBlock.call(
      generator,
      job,
      'Adobe Acrobat Reader (64-bit)'
    );
    const snapshot = generator.getRegistryInstallSnapshotBlock.call(
      generator,
      job,
      'Adobe Acrobat Reader (64-bit)'
    );
    const marker = generator.getRegistryMarkerCreation.call(generator, job);
    const uninstall = generator.getUninstallCommand.call(
      generator,
      job,
      'reader.exe'
    );

    expect(verification).toContain(
      '$_.PSChildName -eq $configuredUninstallProductCode'
    );
    expect(verification).toContain('$capturedUninstallKey = [string]$selectedApplications[0].PSChildName');
    expect(verification).toContain('foreach ($verificationAttempt in 1..30)');
    expect(verification).not.toContain('$existingNameMatches');
    expect(snapshot).toContain('$preInstallApplications = @(Get-ADTApplication');
    expect(marker).toContain("-Name 'UninstallRegistryKey' -Value $capturedUninstallKey");
    expect(uninstall).toContain(
      "$configuredProductCode = '{AC76BA86-1033-FF00-7760-BC15014EA700}'"
    );
    expect(uninstall).toContain('$registeredApplication.WindowsInstaller');
    expect(uninstall).toContain('$capturedMsiProductCode');
    expect(uninstall).toContain('[string]$registeredApplication.PSChildName');
    expect(uninstall).toContain('$uninstallHandle = Start-ADTProcess @uninstallProcessParameters');
    expect(uninstall).toContain('NoWait = $true');
    expect(uninstall).toContain("$isRegisteredMsiExec = $registeredUninstallLeaf -in @('msiexec', 'msiexec.exe')");
    expect(uninstall).toContain("$registeredUninstallFile = Join-Path $env:SystemRoot 'System32\\msiexec.exe'");
    expect(uninstall.indexOf('if ($isRegisteredMsiExec)')).toBeLessThan(
      uninstall.indexOf('if (-not (Test-Path -LiteralPath $registeredUninstallFile -PathType Leaf))')
    );
    expect(uninstall).toContain(
      'The vendor uninstall command did not remove registration [$registeredUninstallRegistryKey]'
    );
    expect(uninstall).toContain('$uninstallDeadline = [DateTime]::UtcNow.AddMinutes(5)');
    expect(uninstall).toContain('foreach ($verificationAttempt in 1..5)');
    expect(uninstall).toContain('refusing broad removal');
    expect(uninstall).not.toContain(
      "Start-ADTMsiProcess -Action 'Uninstall' -ProductCode '{AC76BA86-1033-FF00-7760-BC15014EA700}'"
    );

    const deployScript = generator.generateDeployScript.call(generator, job, 'reader.exe');
    expect(deployScript).toContain('$script:UninstallRebootExitCode = $null');
    expect(deployScript).toContain('Close-ADTSession -ExitCode $script:UninstallRebootExitCode');
  });

  it('emits apostrophe-safe registry identity strings', () => {
    const job = packagingJob({
      display_name: "Contoso O'Brien Agent",
      installer_type: 'exe',
      uninstall_command: "REGISTRY_UNINSTALL:Contoso O'Brien Agent",
    });

    const deployScript = generator.generateDeployScript.call(generator, job, 'setup.exe');
    expect(deployScript).toContain("$configuredUninstallDisplayName = 'Contoso O''Brien Agent'");
    expect(deployScript).toContain("$configuredDisplayName = 'Contoso O''Brien Agent'");
  });

  it('always verifies an exact product identity even when generic verification is disabled', () => {
    const job = packagingJob({
      installer_type: 'exe',
      uninstall_command:
        'REGISTRY_UNINSTALL_PRODUCT:{AC76BA86-1033-FF00-7760-BC15014EA700}:Adobe Acrobat Reader (64-bit)',
      package_config: { psadtConfig: { verifyInstall: false } },
    });

    expect(
      generator.getPostInstallVerificationBlock.call(generator, job, 'Adobe Acrobat Reader (64-bit)')
    ).toContain('$_.PSChildName -eq $configuredUninstallProductCode');
  });

  it('adds verified unattended switches when an EXE publishes only an interactive uninstall command', () => {
    const inno = generator.getUninstallCommand.call(
      generator,
      packagingJob({
        installer_type: 'inno',
        install_command: 'vendor.exe /VERYSILENT /NORESTART',
        uninstall_command:
          'REGISTRY_UNINSTALL_PRODUCT:{AC76BA86-1033-FF00-7760-BC15014EA700}:Vendor app',
      }),
      'vendor.exe'
    );
    const nullsoft = generator.getUninstallCommand.call(
      generator,
      packagingJob({
        installer_type: 'nullsoft',
        uninstall_command:
          'REGISTRY_UNINSTALL_PRODUCT:{AC76BA86-1033-FF00-7760-BC15014EA700}:Vendor app',
      }),
      'vendor.exe'
    );

    expect(inno).toContain("@('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-')");
    expect(nullsoft).toContain("$additionalUninstallArguments += '/S'");
    expect(inno).toContain("$safeManifestUninstallArguments = @('/VERYSILENT /NORESTART' -split '\\s+'");
  });

  it('uses the nested engine for ZIP-wrapped Inno uninstall normalization', () => {
    const uninstall = generator.getUninstallCommand.call(
      generator,
      packagingJob({
        installer_type: 'zip',
        install_command: 'MPC-BE.zip /VERYSILENT /NORESTART',
        uninstall_command: 'REGISTRY_UNINSTALL:MPC-BE x64 1.9.1',
        package_config: {
          nestedInstallerType: 'inno',
          nestedInstallerPath: 'MPC-BE.1.9.1.x64.exe',
          psadtConfig: {},
        },
      }),
      'MPC-BE.zip'
    );

    expect(uninstall).toContain("'inno' -eq 'inno'");
    expect(uninstall).not.toContain("'zip' -eq 'inno'");
  });

  it('uses the vendor-specific CutePDF silent uninstaller instead of Inno switches', () => {
    const uninstall = generator.getUninstallCommand.call(
      generator,
      packagingJob({
        installer_type: 'zip',
        install_command: 'CuteWriter.zip /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-',
        uninstall_command: 'REGISTRY_UNINSTALL:CutePDF Writer',
        package_config: {
          nestedInstallerType: 'inno',
          nestedInstallerPath: 'CuteWriter.exe',
          psadtConfig: {},
        },
      }),
      'CuteWriter.zip'
    );

    expect(uninstall).toContain("$registeredUninstallRegistryKey -ieq 'CutePDF Writer Installation'");
    expect(uninstall).toContain("$registeredUninstallLeaf -in @('unInstcpw.exe', 'unInstcpw64.exe')");
    expect(uninstall).toContain("$registeredUninstallArguments = @('/uninstall', '/s')");
    expect(uninstall).toContain(
      "if (-not $isCutePdfWriterUninstall -and (Split-Path -Leaf $registeredUninstallFile) -ine 'msiexec.exe'"
    );
    expect(uninstall).toContain('-not $isCutePdfWriterUninstall');
  });

  it('appends only bounded reviewed arguments to the exact registered vendor uninstaller', () => {
    const uninstall = generator.getUninstallCommand.call(
      generator,
      packagingJob({
        installer_type: 'exe',
        uninstall_command: 'REGISTRY_UNINSTALL:WinRAR',
        package_config: {
          psadtConfig: {
            reviewedUninstallArguments: ['/S', "vendor's-argument", '/S'],
          },
        },
      }),
      'winrar.exe'
    );

    expect(uninstall).toContain("$reviewedUninstallArguments = @('/S', 'vendor''s-argument')");
    expect(uninstall).toContain(
      "@($registeredUninstallArguments | Where-Object { [string]$_ -ieq $reviewedArgument }).Count -eq 0"
    );
    expect(uninstall.indexOf('$reviewedUninstallArguments = @(')).toBeLessThan(
      uninstall.indexOf('$uninstallHandle = Start-ADTProcess @uninstallProcessParameters')
    );
  });

  it('rejects unsafe reviewed uninstall argument collections', () => {
    expect(() => generator.getUninstallCommand.call(
      generator,
      packagingJob({
        installer_type: 'exe',
        uninstall_command: 'REGISTRY_UNINSTALL:Example',
        package_config: {
          psadtConfig: { reviewedUninstallArguments: ['--quiet\nRemove-Item C:\\'] },
        },
      }),
      'example.exe'
    )).toThrow('single-line');
  });

  it('guards only the reviewed newly spawned MSI uninstall helper', () => {
    const uninstall = generator.getUninstallCommand.call(
      generator,
      packagingJob({
        winget_id: 'Elgato.CameraHub',
        installer_type: 'msi',
        uninstall_command: 'REGISTRY_UNINSTALL:Elgato Camera Hub',
        package_config: {
          psadtConfig: {
            reviewedUninstallProcessGuard: {
              processName: 'Camera Hub.exe',
              argumentsPattern: '(?:^|\\s)--pre-uninstall(?:\\s|$).*--quit(?:\\s|$)',
              graceSeconds: 20,
            },
          },
        },
      }),
      'CameraHub.msi'
    );

    expect(uninstall).toContain("$reviewedGuardProcessName = 'Camera Hub.exe'");
    expect(uninstall).toContain(
      "$reviewedGuardArgumentsPattern = '(?:^|\\s)--pre-uninstall(?:\\s|$).*--quit(?:\\s|$)'"
    );
    expect(uninstall).toContain('$reviewedGuardGraceSeconds = 20');
    expect(uninstall).toContain('$_.CreationDate.ToUniversalTime() -ge $StartedAt');
    expect(uninstall).toContain('$current.Name -ieq $ProcessName');
    expect(uninstall).toContain('Stop-Process -Id $current.ProcessId -Force');
    expect(uninstall).toContain(
      "Start-ADTMsiProcess -Action 'Uninstall' -ProductCode $capturedMsiProductCode"
    );
  });

  it('rejects an unsafe reviewed MSI uninstall process guard', () => {
    expect(() => generator.getUninstallCommand.call(
      generator,
      packagingJob({
        installer_type: 'msi',
        uninstall_command: 'REGISTRY_UNINSTALL:Example',
        package_config: {
          psadtConfig: {
            reviewedUninstallProcessGuard: {
              processName: '..\\helper.exe',
              argumentsPattern: '--quit',
              graceSeconds: 20,
            },
          },
        },
      }),
      'example.msi'
    )).toThrow('executable leaf name');
  });

  it('extends registry-aware completion only for a reviewed vendor profile', () => {
    const uninstall = generator.getUninstallCommand.call(
      generator,
      packagingJob({
        winget_id: 'Microsoft.VisualStudio.Professional',
        installer_type: 'exe',
        uninstall_command: 'REGISTRY_UNINSTALL:Visual Studio Professional',
        package_config: {
          psadtConfig: {
            reviewedUninstallArguments: ['--quiet', '--norestart'],
            uninstallCompletionTimeoutMinutes: 15,
          },
        },
      }),
      'vs_Professional.exe'
    );

    expect(uninstall).toContain(
      "$reviewedUninstallArguments = @('--quiet', '--norestart')"
    );
    expect(uninstall).toContain(
      '$uninstallDeadline = [DateTime]::UtcNow.AddMinutes(15)'
    );
  });

  it('rejects unbounded vendor uninstall completion windows', () => {
    expect(() => generator.getUninstallCommand.call(
      generator,
      packagingJob({
        installer_type: 'exe',
        uninstall_command: 'REGISTRY_UNINSTALL:Example',
        package_config: {
          psadtConfig: { uninstallCompletionTimeoutMinutes: 31 },
        },
      }),
      'example.exe'
    )).toThrow('integer from 1 to 30');
  });

  it('uses the Adobe Creative Cloud desktop client unattended removal contract', () => {
    const uninstall = generator.getUninstallCommand.call(
      generator,
      packagingJob({
        installer_type: 'exe',
        install_command: 'Creative_Cloud_Set-Up.exe --mode=stub',
        uninstall_command: 'REGISTRY_UNINSTALL:Adobe Creative Cloud',
      }),
      'Creative_Cloud_Set-Up.exe'
    );

    expect(uninstall).toContain(
      "$isAdobeCreativeCloudUninstall = (Split-Path -Leaf $registeredUninstallFile) -ieq 'Creative Cloud Uninstaller.exe'"
    );
    expect(uninstall).toContain("$registeredUninstallArguments = @('-u', '--silent')");
    expect(uninstall).not.toContain("$registeredUninstallArguments = @('--mode=stub')");
  });

  it('fails closed when an exact product marker is malformed', () => {
    const uninstall = generator.getUninstallCommand.call(
      generator,
      packagingJob({
        installer_type: 'exe',
        uninstall_command:
          'REGISTRY_UNINSTALL_PRODUCT:not-a-guid:Vendor app {AC76BA86-1033-FF00-7760-BC15014EA700}',
      }),
      'vendor.exe'
    );

    expect(uninstall).toContain('exact vendor uninstall identity is malformed');
    expect(uninstall).not.toContain("Start-ADTMsiProcess -Action 'Uninstall'");
  });
});

describe('self-hosted MSIX PSADT generation', () => {
  const msixJob = (scope: 'user' | 'machine'): PackagingJob => packagingJob({
    winget_id: 'Microsoft.WindowsTerminal',
    display_name: 'Windows Terminal',
    version: '1.24.11911.0',
    installer_type: 'msix',
    installer_url: 'https://example.com/terminal.msixbundle',
    uninstall_command: 'MSIX_UNINSTALL:Microsoft.WindowsTerminal',
    install_scope: scope,
  });

  it('uses current-user AppX commands for user-scoped packages', () => {
    const job = msixJob('user');
    const install = generator.getInstallCommand.call(
      generator,
      job,
      'terminal.msixbundle',
      ''
    );
    const uninstall = generator.getUninstallCommand.call(
      generator,
      job,
      'terminal.msixbundle'
    );

    expect(install).toContain('Add-AppxPackage -Path $msixPath');
    expect(install).not.toContain('Add-AppxProvisionedPackage');
    expect(uninstall).toContain("Get-AppxPackage -Name 'Microsoft.WindowsTerminal'");
    expect(uninstall).not.toContain('-AllUsers');
    expect(uninstall).not.toContain('Get-AppxProvisionedPackage');
  });

  it('uses online provisioning only for machine-scoped packages', () => {
    const job = msixJob('machine');
    const install = generator.getInstallCommand.call(
      generator,
      job,
      'terminal.msixbundle',
      ''
    );
    const uninstall = generator.getUninstallCommand.call(
      generator,
      job,
      'terminal.msixbundle'
    );

    expect(install).toContain('Add-AppxProvisionedPackage -Online');
    expect(uninstall).toContain('Get-AppxProvisionedPackage -Online');
    expect(uninstall).toContain('Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers');
  });

  it('refuses a display-name fallback that is not an exact package identity', () => {
    const job = msixJob('user');
    job.uninstall_command = 'MSIX_UNINSTALL:Windows Terminal';

    expect(
      generator.getInstallCommand.call(generator, job, 'terminal.msixbundle', '')
    ).toContain('identity is missing or unsafe');
    expect(
      generator.getUninstallCommand.call(generator, job, 'terminal.msixbundle')
    ).toContain('refusing an ambiguous removal');
  });
});
