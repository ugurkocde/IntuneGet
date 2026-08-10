import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JobProcessor } from '../src/job-processor';
import type { PackagingJob } from '../src/job-poller';

type ScriptGenerator = {
  getInstallCommand(job: PackagingJob, fileName: string, silentSwitches: string): string;
  getUninstallCommand(job: PackagingJob, fileName: string): string;
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
    expect(script).toContain("if ($installerTypeLower -eq 'portable' -or $isNestedPortable)");
    expect(script).toContain('[System.IO.Compression.ZipFile]::OpenRead($installerPath)');
    expect(script).toContain('Archive entry escapes the portable staging directory');
    expect(script).not.toContain('Portable nested installers are not supported yet');
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
    expect(script).toContain('$uninstallHandle.Process.HasExited');
    expect(script).not.toContain('Start-ADTProcess -FilePath $wingetExe');
    expect(script).not.toContain('uninstall --id $wingetId');
  });
});

describe('Burn bundle PSADT generation', () => {
  it('reuses the packaged bundle with the registered quiet uninstall arguments', () => {
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

    expect(script).toContain("$_.PSChildName -eq '{97b6de30-6082-48d1-9bb4-9f43296531a4}'");
    expect(script).toContain(
      '[string[]]$registeredUninstallArguments = @($registeredApplication."$($registeredUninstallProperty)ArgumentList")'
    );
    expect(script).toContain("Join-Path $adtSession.DirFiles 'python-3.14.7-amd64.exe'");
    expect(script).toContain('-WorkingDirectory $adtSession.DirFiles -CreateNoWindow');
    expect(script).not.toContain("Start-ADTMsiProcess -Action 'Uninstall'");
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
