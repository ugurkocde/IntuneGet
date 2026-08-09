import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JobProcessor } from '../src/job-processor';
import type { PackagingJob } from '../src/job-poller';

type ScriptGenerator = {
  getInstallCommand(job: PackagingJob, fileName: string, silentSwitches: string): string;
  getUninstallCommand(job: PackagingJob): string;
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
  return generator.getUninstallCommand.call(generator, job);
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
    expect(script).toContain("`$envLocalAppData\\IntuneGet\\Logs");
    expect(script).not.toContain("-Setting 'LogPath' -ValueLiteral \"'C:\\ProgramData\\IntuneGet\\Logs'\"");
  });
});
