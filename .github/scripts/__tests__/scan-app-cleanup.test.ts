import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scanner = process.env.SCANNER_CLEANUP_BASELINE ?? fileURLToPath(new URL('../scan-app.ps1', import.meta.url));
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SystemRoot|WINDIR|TEMP|TMP|PATHEXT|ProgramFiles|ProgramFiles\(x86\)|ProgramW6432|PSModulePath)$/i.test(key)));
const available = process.platform === 'win32' && spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'],
  { env: cleanEnv, timeout: 10000, windowsHide: true }).status === 0;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

// Only load function definitions and the finally block. Every process invocation
// is mocked, so neither WinGet nor a vendor installer can run on the test host.
function fixture(body: string) {
  const directory = mkdtempSync(join(tmpdir(), 'scanner-cleanup-'));
  const script = `
trap { [Console]::Error.WriteLine($_.ToString()); exit 1 }
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(${quote(scanner)}, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Source parse failed' }
foreach ($node in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
 . ([scriptblock]::Create($node.Extent.Text))
}
$env:ProgramFiles = 'C:\\Program Files'
\${env:ProgramFiles(x86)} = 'C:\\Program Files (x86)'
function New-Result([string]$Edition) {
 $path = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\' + $Edition
 @{ status='completed'; error=$null; install_path=$path; quiet_uninstall_string=$null;
    uninstall_string='"C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\setup.exe" uninstall --installPath "' + $path + '"';
    registry_changes=@{ app_registry_entry=@{ detection_method='new_key' } } }
}
function Start-Process { throw 'Real process execution is forbidden in this fixture' }
function Get-Command { throw 'Real executable lookup is forbidden in this fixture' }
$finally = ($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] } | Select-Object -Last 1).Finally
$cleanupBody = ($finally.Statements | ForEach-Object { $_.Extent.Text }) -join "\n"
$OutputPath = ${quote(join(directory, 'result.json'))}
$startedAt = Get-Date
${body}
`;
  try {
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', env: cleanEnv, timeout: 15000, windowsHide: true, maxBuffer: 256 * 1024 });
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    return JSON.parse(result.stdout.trim());
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

describe.runIf(available)('scanner Visual Studio cleanup', () => {
  it('uses the selected constant executable through the existing bounded runner', () => {
    const value = fixture(`
$script:launch=$null
function Start-Process {
 param([string]$FilePath,[string[]]$ArgumentList,[switch]$PassThru,[switch]$NoNewWindow,[string]$RedirectStandardOutput,[string]$RedirectStandardError)
 $script:launch=@{file=$FilePath;args=$ArgumentList}
 Set-Content -LiteralPath $RedirectStandardOutput -Value ''
 Set-Content -LiteralPath $RedirectStandardError -Value ''
 $process=[pscustomobject]@{ExitCode=0}
 $process | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value { param($Milliseconds) $true }
 return $process
}
$command=Get-ScannerCleanupInvocation -WingetId 'Microsoft.VisualStudio.2022.Enterprise' -Result (New-Result 'Enterprise') -InstalledByScan $true
$outcome=Invoke-Winget @command -TimeoutSeconds 300
@{launch=$script:launch;outcome=$outcome} | ConvertTo-Json -Depth 8
`);
    expect(value.launch.file).toBe('C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\setup.exe');
    expect(value.launch.args.slice(-2)).toEqual(['--quiet', '--norestart']);
    expect(value.outcome.ExitCode).toBe(0);
    expect(value.outcome.TimedOut).toBe(false);
  });

  it('builds quiet arguments only for the two exact newly installed identities', () => {
    const results = fixture(`
@('Enterprise','Community') | ForEach-Object {
 $r = New-Result $_
 Get-ScannerCleanupInvocation -WingetId ('Microsoft.VisualStudio.2022.' + $_) -Result $r -InstalledByScan $true
} | ConvertTo-Json -Depth 8
`);
    for (const [index, edition] of ['Enterprise', 'Community'].entries()) {
      expect(results[index]).toEqual({
        FilePath: 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\setup.exe',
        Arguments: ['uninstall', '--installPath', `"C:\\Program Files\\Microsoft Visual Studio\\2022\\${edition}"`, '--quiet', '--norestart'],
      });
    }
  });

  it('keeps mismatched or unqualified data on the original WinGet path', () => {
    const values = fixture(`
$cases = @(
 @{name='not-installed'; installed=$false},
 @{name='different-app'; id='Other.App'},
 @{name='different-edition'; id='Microsoft.VisualStudio.2022.Professional'},
 @{name='fallback'; field='detection'; value='fallback_search'},
 @{name='quiet-present'; field='quiet'; value='anything'},
 @{name='quiet-empty'; field='quiet'; value=''},
 @{name='relative-exe'; field='uninstall'; value='setup.exe uninstall --installPath "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise"'},
 @{name='unc-exe'; field='uninstall'; value='"\\\\server\\setup.exe" uninstall --installPath "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise"'},
 @{name='other-exe'; field='uninstall'; value='"C:\\Other\\setup.exe" uninstall --installPath "C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise"'},
 @{name='trailing-args'; field='suffix'; value=' --force'},
 @{name='edition-mismatch'; field='path'; value='C:\\Program Files\\Microsoft Visual Studio\\2022\\Community'},
 @{name='traversal'; field='path'; value='C:\\Program Files\\Microsoft Visual Studio\\2022\\x\\..\\Enterprise'}
)
@($cases | ForEach-Object {
 $case=$_; $r = New-Result 'Enterprise'; $id='Microsoft.VisualStudio.2022.Enterprise'; $installed=$true
 if ($case.ContainsKey('installed')) { $installed=$case.installed }
 if ($case.id) { $id=$case.id }
 switch ($case.field) {
  'detection' { $r.registry_changes.app_registry_entry.detection_method=$case.value }
  'quiet' { $r.quiet_uninstall_string=$case.value }
  'uninstall' { $r.uninstall_string=$case.value }
  'suffix' { $r.uninstall_string += $case.value }
  'path' { $r.install_path=$case.value }
 }
 @{ name=$case.name; invocation=(Get-ScannerCleanupInvocation -WingetId $id -Result $r -InstalledByScan $installed) }
}) | ConvertTo-Json -Depth 8
`);
    expect(values).toHaveLength(12);
    for (const value of values) {
      expect(value.invocation.FilePath, value.name).toBeUndefined();
      expect(value.invocation.Arguments).toContain('--id');
      expect(value.invocation.Arguments).not.toContain('--quiet');
    }
  });

  it('requires successful removal and keeps failures, limits and other apps unchanged', () => {
    const values = fixture(`
$cases = @(
 @{ name='removed'; exit=0; listExit=-1978335212; list='No installed package found matching input criteria.' },
 @{ name='still-listed'; exit=0; listExit=0; list='Visual Studio Enterprise 2022' },
 @{ name='list-error'; exit=0; listExit=1; list='No installed package found matching input criteria.' },
 @{ name='list-timeout'; exit=0; listExit=-1978335212; list='No installed package found matching input criteria.'; listTimeout=$true },
 @{ name='reboot'; exit=3010; listExit=0; list='' },
 @{ name='timeout'; exit=-1; listExit=0; list='' },
 @{ name='other-app'; exit=0; id='Other.App'; listExit=0; list='' },
 @{ name='not-installed'; exit=0; installed=$false; listExit=0; list='' }
)
@($cases | ForEach-Object {
 $scenario=$_; $result=New-Result 'Enterprise'; $WingetId='Microsoft.VisualStudio.2022.Enterprise'; $installedByScan=$true
 if ($scenario.id) { $WingetId=$scenario.id }
 if ($scenario.ContainsKey('installed')) { $installedByScan=$scenario.installed }
 $calls=[Collections.Generic.List[object]]::new()
 function Invoke-Winget {
  param([string[]]$Arguments,[int]$TimeoutSeconds,[switch]$CaptureOnTimeout,[string]$FilePath)
  $calls.Add(@{args=$Arguments;timeout=$TimeoutSeconds;capture=[bool]$CaptureOnTimeout;file=$FilePath})
  if ($Arguments[0] -eq 'list') { return @{ExitCode=$scenario.listExit;TimedOut=[bool]$scenario.listTimeout;Output=$scenario.list} }
  @{ExitCode=$scenario.exit;TimedOut=($scenario.exit -eq -1);Output='mock cleanup'}
 }
 . ([scriptblock]::Create($cleanupBody))
 @{ name=$scenario.name; result=$result; calls=@($calls.ToArray()) }
}) | ConvertTo-Json -Depth 12
`);
    for (const value of values) {
      const success = ['removed', 'other-app', 'not-installed'].includes(value.name);
      expect(value.result.status, value.name).toBe(success ? 'completed' : 'failed');
      if (!success) expect(value.result.error).toContain('Cleanup failed');
      if (value.name === 'not-installed') {
        expect(value.calls).toEqual([]);
      } else {
        expect(value.calls[0].timeout).toBe(300);
        expect(value.calls[0].capture).toBe(true);
      }
      if (value.name === 'other-app') {
        expect(value.calls[0].args).toEqual(['uninstall', '--id', 'Other.App', '--exact', '--silent', '--accept-source-agreements', '--disable-interactivity']);
        expect(value.calls[0].file).toBe('');
      }
    }
    expect(values.find((x: { name: string }) => x.name === 'removed').calls[1].timeout).toBe(90);
  });
});
