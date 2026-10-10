import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { JobProcessor } from '../src/job-processor';
import type { PackagingJob } from '../src/job-poller';

const generator = JobProcessor.prototype as unknown as {
  generateDeployScript(job: PackagingJob, fileName: string): string;
};

function packagingJob(installCommand: string, overrides: Partial<PackagingJob> = {}): PackagingJob {
  return {
    id: 'override-fixture', user_id: 'user', user_email: 'qa@example.com', tenant_id: 'tenant',
    winget_id: 'Oracle.JavaRuntimeEnvironment', version: '8.0.5010.8', display_name: 'Java 8 Update 501',
    publisher: 'Oracle', architecture: 'x64', installer_type: 'exe',
    installer_url: 'https://javadl.oracle.com/webapps/download/AutoDL?BundleId=253458',
    installer_sha256: 'A'.repeat(64),
    install_command: '"AutoDL.exe" /s REBOOT=0 SPONSORS=0 AUTO_UPDATE=0',
    uninstall_command: 'REGISTRY_UNINSTALL:Java 8 Update 501',
    install_scope: 'machine', detection_rules: [], package_config: { psadtConfig: { installCommand } },
    status: 'queued', progress_percent: 0, created_at: '2026-10-10T00:00:00Z',
    ...overrides,
  };
}

const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
  { encoding: 'utf8', timeout: 15_000 }).status === 0;

// Reads every Start-ADTProcess call in Install-ADTDeployment through the
// PowerShell parser, so each asserted ArgumentList is the exact runtime value.
// The generated deployment script is parsed as text, never invoked.
function installProcessCalls(deployment: string): Array<{ FilePath: string; ArgumentList: string }> {
  const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(deployment).toString('base64')}'))
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | ForEach-Object { $_.Message } | Out-String) }
$install = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Install-ADTDeployment' }, $true)
$calls = @($install.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Start-ADTProcess' }, $true) | ForEach-Object {
  $elements = @($_.CommandElements)
  $values = @{}
  for ($index = 1; $index -lt $elements.Count - 1; $index++) {
    if ($elements[$index] -is [System.Management.Automation.Language.CommandParameterAst]) {
      $value = $elements[$index + 1]
      $values[$elements[$index].ParameterName] = if ($value -is [System.Management.Automation.Language.StringConstantExpressionAst]) { $value.Value } else { $value.Extent.Text }
    }
  }
  [pscustomobject]@{ FilePath = [string]$values['FilePath']; ArgumentList = [string]$values['ArgumentList'] }
})
ConvertTo-Json -InputObject $calls -Compress`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'], { input: script, encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) {
    throw new Error(`Could not read the generated install calls:\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout.trim());
}

describe('local install command override', () => {
  it('runs an override of the packaged installer natively with the edited arguments', () => {
    const deployment = generator.generateDeployScript(
      packagingJob('"AutoDL.exe" /s REBOOT=0 SPONSORS=0 AUTO_UPDATE=0 REMOVEOUTOFDATEJRES=1'),
      'installer.exe'
    );

    // The URL has no extension: the UI shows AutoDL.exe, the packager stores installer.exe.
    expect(deployment).toContain(
      "Start-ADTProcess -FilePath \"$($adtSession.DirFiles)\\installer.exe\" -ArgumentList '/s REBOOT=0 SPONSORS=0 AUTO_UPDATE=0 REMOVEOUTOFDATEJRES=1' -WindowStyle Hidden -WaitForMsiExec"
    );
    expect(deployment).not.toContain('System32\\cmd.exe');
  });

  it('matches the stored installer name without quotes and case-insensitively', () => {
    const deployment = generator.generateDeployScript(
      packagingJob('INSTALLER.EXE /s REBOOT=0', {
        installer_url: 'https://example.com/downloads/installer.exe',
      }),
      'installer.exe'
    );

    expect(deployment).toContain("-ArgumentList '/s REBOOT=0' -WindowStyle Hidden -WaitForMsiExec");
    expect(deployment).not.toContain('System32\\cmd.exe');
  });

  it('runs any other command verbatim through cmd.exe without stripping its quotes', () => {
    const deployment = generator.generateDeployScript(
      packagingJob('"other.exe" /s "C:\\Data Files\\setup.cfg"'),
      'installer.exe'
    );

    expect(deployment).toContain(
      "Start-ADTProcess -FilePath \"$env:SystemRoot\\System32\\cmd.exe\" -ArgumentList '/s /c \"\"other.exe\" /s \"C:\\Data Files\\setup.cfg\"\"' -WorkingDirectory $adtSession.DirFiles -WindowStyle Hidden"
    );
  });

  it('keeps cmd.exe semantics for an installer override that chains commands', () => {
    const deployment = generator.generateDeployScript(
      packagingJob('"AutoDL.exe" /s && echo installed'),
      'installer.exe'
    );

    expect(deployment).toContain("-ArgumentList '/s /c \"\"AutoDL.exe\" /s && echo installed\"'");
  });

  it('keeps an MSI override on the cmd.exe path', () => {
    const deployment = generator.generateDeployScript(
      packagingJob('"setup.msi" /qn PROPERTY=1', {
        installer_type: 'msi', installer_url: 'https://example.com/setup.msi',
      }),
      'setup.msi'
    );

    expect(deployment).toContain("-ArgumentList '/s /c \"\"setup.msi\" /qn PROPERTY=1\"'");
  });

  it.runIf(pwshAvailable)('passes quoted and apostrophe arguments to the installer exactly', () => {
    const deployment = generator.generateDeployScript(
      packagingJob('"AutoDL.exe" /s INSTALLDIR="C:\\Program Files\\Contoso\'s Java"'),
      'installer.exe'
    );

    expect(installProcessCalls(deployment)).toEqual([{
      FilePath: '"$($adtSession.DirFiles)\\installer.exe"',
      ArgumentList: '/s INSTALLDIR="C:\\Program Files\\Contoso\'s Java"',
    }]);
  });

  it.runIf(pwshAvailable)('encodes typographic single quotes so an override cannot leave its PowerShell string', () => {
    const leftQuote = String.fromCharCode(0x2018);
    const rightQuote = String.fromCharCode(0x2019);
    const override = `"AutoDL.exe" /s NAME=${rightQuote}; Write-Host injected; ${leftQuote}`;
    const deployment = generator.generateDeployScript(packagingJob(override), 'installer.exe');

    expect(installProcessCalls(deployment)).toEqual([{
      FilePath: '"$env:SystemRoot\\System32\\cmd.exe"',
      ArgumentList: `/s /c "${override}"`,
    }]);
  });

  it('keeps cmd.exe semantics for an installer override that uses the caret escape', () => {
    const deployment = generator.generateDeployScript(packagingJob('"AutoDL.exe" /s NAME=a^b'), 'installer.exe');

    expect(deployment).toContain("-ArgumentList '/s /c \"\"AutoDL.exe\" /s NAME=a^b\"'");
  });

  it.runIf(pwshAvailable)('expands %VAR% references in native override arguments as cmd.exe did', () => {
    const deployment = generator.generateDeployScript(
      packagingJob('"AutoDL.exe" /s INSTALLDIR="%ProgramFiles%\\Contoso\'s App"'),
      'installer.exe'
    );

    expect(installProcessCalls(deployment)).toEqual([{
      FilePath: '"$($adtSession.DirFiles)\\installer.exe"',
      ArgumentList: '$effectiveInstallerArguments',
    }]);
    expect(runInstallLines(deployment, /^\s*\$effectiveInstallerArguments = /, '$effectiveInstallerArguments'))
      .toBe(`/s INSTALLDIR="${PROGRAM_FILES}\\Contoso's App"`);
  });

  it.runIf(pwshAvailable)('passes apostrophes, braces and %VAR% in Inno override arguments to the installer exactly', () => {
    const deployment = generator.generateDeployScript(
      packagingJob('"setup.exe" /DIR="{autopf}\\Bob\'s App" /GROUP="%ProgramFiles%"', {
        installer_type: 'inno', installer_url: 'https://example.com/setup.exe',
      }),
      'setup.exe'
    );

    expect(runInstallLines(deployment, /^\s*\$innoArguments = /, '$innoArguments'))
      .toBe(`/DIR="{autopf}\\Bob's App" /GROUP="${PROGRAM_FILES}" /SP- /LOG="${INNO_LOG}"`);
  });

  it.runIf(pwshAvailable)('keeps generated Inno switches with apostrophes and braces exact', () => {
    const deployment = generator.generateDeployScript(
      packagingJob('', {
        installer_type: 'inno', installer_url: 'https://example.com/setup.exe',
        install_command: '"setup.exe" /VERYSILENT /DIR="{autopf}\\Bob\'s App"', package_config: {},
      }),
      'setup.exe'
    );

    expect(runInstallLines(deployment, /^\s*\$innoArguments = /, '$innoArguments'))
      .toBe(`/VERYSILENT /DIR="{autopf}\\Bob's App" /SP- /LOG="${INNO_LOG}"`);
  });
});

const PROGRAM_FILES = 'C:\\Fixture Program Files';
const INNO_LOG = 'C:\\Fixture Temp\\IntuneGet-Inno-Install.log';

// Executes only the generated argument assignment lines, with fixed
// environment values, and returns the resulting argument string.
function runInstallLines(deployment: string, linePattern: RegExp, variable: string): string {
  const lines = deployment.split(/\r?\n/).filter((line) => linePattern.test(line)).join('\n');
  const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
$env:ProgramFiles = '${PROGRAM_FILES}'
$innoLogPath = '${INNO_LOG}'
${lines}
${variable}`;
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'], { input: script, encoding: 'utf8', timeout: 30_000 });
  if (result.status !== 0) {
    throw new Error(`Generated argument lines failed:\n${lines}\n${result.stderr}`);
  }
  return result.stdout.trim();
}
