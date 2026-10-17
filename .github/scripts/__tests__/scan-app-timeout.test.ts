import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const scanner = fileURLToPath(new URL('../scan-app.ps1', import.meta.url));
const available = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { timeout: 10000 }).status === 0;
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(PATH|SystemRoot|WINDIR|TEMP|TMP|PATHEXT|ProgramFiles|ProgramFiles\(x86\)|ProgramW6432|PSModulePath)$/i.test(key)));

/**
 * Runs trusted scanner functions using benign processes and a private fixture.
 * The clean child environment carries no credentials; CIM cases need Windows.
 */
function run(body: string, source = scanner, withoutInheritedTemp = false) {
  const directory = mkdtempSync(join(tmpdir(), 'scanner-PRIVATE_CANARY-'));
  const script = `
trap { [Console]::Error.WriteLine($_.ToString()); exit 1 }
$ErrorActionPreference = 'Stop'
${withoutInheritedTemp ? '$env:TEMP = $null; $env:TMP = $null' : ''}
$env:LOCALAPPDATA = ${quote(directory)}
$env:TEMP = $env:TMP = ${quote(directory)}
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(${quote(source)}, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Source parse failed' }
foreach ($node in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($node.Extent.Text))
}
$shell = (Get-Process -Id $PID).Path
function Get-Command { param([string]$Name) if ($Name -ne 'winget') { throw 'Unexpected lookup' }; @{ Source = $shell } }
$launched = [Collections.Generic.List[Diagnostics.Process]]::new()
function Start-Process {
 param([string]$FilePath, [string[]]$ArgumentList, [switch]$PassThru, [switch]$NoNewWindow, [string]$RedirectStandardOutput, [string]$RedirectStandardError)
 $started = Microsoft.PowerShell.Management\\Start-Process @PSBoundParameters
 $launched.Add($started)
 return $started
}
$directory = ${quote(directory)}
$diag = Join-Path $directory 'Packages/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe/LocalState/DiagOutputDir'
function Read-Captures { @(Get-ChildItem -LiteralPath $diag -Filter '*.json' -ErrorAction SilentlyContinue | ForEach-Object { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json }) }
try { ${body} } finally {
 foreach ($started in $launched) { try { if (-not $started.HasExited) { $started.Kill() }; $started.Dispose() } catch { } }
}
exit 0
`;
  try {
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { encoding: 'utf8', env: cleanEnv, timeout: 20000, windowsHide: true, maxBuffer: 256 * 1024 });
    expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
    return JSON.parse(result.stdout.trim());
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

const timeout = `
$capture = @{}
if ((Microsoft.PowerShell.Core\\Get-Command Invoke-Winget).Parameters.ContainsKey('CaptureOnTimeout')) { $capture.CaptureOnTimeout = $true }
$outcome = Invoke-Winget -Arguments @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30') -TimeoutSeconds 1 @capture
`;

describe.runIf(available)('scanner timeout diagnostics', () => {
  it('runs the benign process fixture without inherited TEMP or TMP', () => {
    const value = run(`
$outcome = Invoke-Winget -Arguments @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30') -TimeoutSeconds 1
@{ outcome=$outcome; captures=@(Read-Captures) } | ConvertTo-Json -Depth 5
`, scanner, true);
    expect(value.outcome).toEqual({ ExitCode: -1, TimedOut: true, Output: 'Timed out after 1 seconds' });
    expect(value.captures).toEqual([]);
  });

  it.runIf(process.platform === 'win32')('writes a private capture on timeout and preserves the original error', () => {
    const value = run(`${timeout}
@{ outcome = $outcome; captures = @(Read-Captures) } | ConvertTo-Json -Depth 8
`, process.env.SCANNER_TIMEOUT_BASELINE ? resolve(process.env.SCANNER_TIMEOUT_BASELINE) : scanner);
    expect(value.outcome).toEqual({ ExitCode: -1, TimedOut: true, Output: 'Timed out after 1 seconds' });
    expect(value.captures).toHaveLength(1);
    expect(value.captures[0].root_identity_verified).toBe(true);
    expect(value.captures[0].completeness).toBe(false);
    expect(value.captures[0].root_image_is_winget).toBe(false);
    expect(JSON.stringify(value.captures)).not.toContain('PRIVATE_CANARY');
  });

  it.runIf(process.platform === 'win32')('observes only a verified sleeping child without killing that child', () => {
    const value = run(`
$sleep = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes('Start-Sleep -Seconds 30'))
$childCode = '$c = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList "-NoProfile -NonInteractive -EncodedCommand ${'${sleep}'}" -PassThru -NoNewWindow; @{ id=$c.Id; ticks=$c.StartTime.ToUniversalTime().Ticks } | ConvertTo-Json | Set-Content -LiteralPath "${'${directory}'}/child.json"; Start-Sleep -Seconds 30'
$childCode = $childCode.Replace('${'${sleep}'}', $sleep).Replace('${'${directory}'}', $directory)
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($childCode))
try {
 $outcome = Invoke-Winget -Arguments @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) -TimeoutSeconds 2 -CaptureOnTimeout
 $childRecord = Get-Content -LiteralPath (Join-Path $directory 'child.json') -Raw | ConvertFrom-Json
 $child = [Diagnostics.Process]::GetProcessById($childRecord.id)
 @{ capture = @(Read-Captures)[0]; childStillAlive = -not $child.HasExited; outcome = $outcome } | ConvertTo-Json -Depth 8
} finally {
 if ($child -and $child.StartTime.ToUniversalTime().Ticks -eq $childRecord.ticks) { $child.Kill(); $child.Dispose() }
}
`);
    expect(value.capture.captured).toBe(true);
    expect(value.capture.descendant_count).toBe(1);
    expect(value.capture.children[0]).toEqual({ depth: 1, alive_at_probe: true, has_main_window: null });
    expect(value.childStillAlive).toBe(true);
    expect(value.outcome.ExitCode).toBe(-1);
  });

  it.each(['throw', 'hang', 'invalid'])('contains helper %s without changing timeout reporting', scenario => {
    const helper = scenario === 'throw' ? "throw 'PRIVATE_CANARY'" : scenario === 'hang' ? 'Start-Sleep -Seconds 30' : "'PRIVATE_CANARY'";
    const value = run(`
function Get-ScannerTimeoutCaptureScript { param([int]$RootProcessId, [long]$RootStartedUtcTicks) ${quote(helper)} }
$watch = [Diagnostics.Stopwatch]::StartNew()
${timeout}
@{ outcome = $outcome; captures = @(Read-Captures); seconds = $watch.Elapsed.TotalSeconds; rootStopped = $launched[0].WaitForExit(1000) } | ConvertTo-Json -Depth 8
`);
    expect(value.outcome).toEqual({ ExitCode: -1, TimedOut: true, Output: 'Timed out after 1 seconds' });
    expect(value.captures).toHaveLength(1);
    expect(value.captures[0].captured).toBe(false);
    expect(value.captures[0].capture_error).toBe(true);
    expect(value.rootStopped).toBe(true);
    expect(value.seconds).toBeLessThan(7);
    expect(JSON.stringify(value.captures)).not.toContain('PRIVATE_CANARY');
  });

  it('rejects missing or reused roots and earlier children while bounding the tree', () => {
    const value = run(`
$start = [DateTime]::UtcNow
$root = @{ ProcessId = 100; ParentProcessId = 1; CreationDate = $start }
$old = @{ ProcessId = 101; ParentProcessId = 100; CreationDate = $start.AddSeconds(-1) }
$good = @{ ProcessId = 102; ParentProcessId = 100; CreationDate = $start.AddSeconds(1) }
$rows = @($root, $old, $good)
$selected = Select-ScannerTimeoutProcesses -Rows $rows -RootProcessId 100 -RootStartedUtcTicks $start.Ticks
$many = @($root) + @(1..20 | ForEach-Object { @{ ProcessId = 100 + $_; ParentProcessId = 100; CreationDate = $start.AddSeconds($_) } })
$bounded = Select-ScannerTimeoutProcesses -Rows $many -RootProcessId 100 -RootStartedUtcTicks $start.Ticks
$deep = @($root) + @(1..6 | ForEach-Object { @{ ProcessId = 100 + $_; ParentProcessId = 99 + $_; CreationDate = $start.AddSeconds($_) } })
$depth = Select-ScannerTimeoutProcesses -Rows $deep -RootProcessId 100 -RootStartedUtcTicks $start.Ticks
@{ accepted = @($selected.Children | ForEach-Object { $_.Row.ProcessId }); missing = $null -eq (Select-ScannerTimeoutProcesses -Rows @() -RootProcessId 100 -RootStartedUtcTicks $start.Ticks);
 reused = $null -eq (Select-ScannerTimeoutProcesses -Rows $rows -RootProcessId 100 -RootStartedUtcTicks $start.AddSeconds(-10).Ticks);
 count = $bounded.Children.Count; truncated = $bounded.Truncated; depths = @($depth.Children.Depth); depthTruncated = $depth.Truncated } | ConvertTo-Json -Depth 8
`);
    expect(value.accepted).toEqual([102]);
    expect(value.missing).toBe(true);
    expect(value.reused).toBe(true);
    expect(value.count).toBe(16);
    expect(value.truncated).toBe(true);
    expect(value.depths).toEqual([1, 2, 3, 4]);
    expect(value.depthTruncated).toBe(true);
  });

  it('rebuilds only allowlisted values and rejects invalid known fields', () => {
    const value = run(`
$inputValue = @{ schema=1; captured=$true; capture_error=$false; root_identity_verified=$true; root_alive=$true; root_image_is_winget=$false; completeness=$false; descendant_count=1; truncated=$false; private='PRIVATE_CANARY'; children=@(@{depth=1;alive_at_probe=$true;has_main_window=$null;command='PRIVATE_CANARY'}) }
$safe = ConvertTo-ScannerTimeoutCapture -Json ($inputValue | ConvertTo-Json -Depth 5)
$inputValue.children[0].has_main_window = $false
$rejected = $false
try { ConvertTo-ScannerTimeoutCapture -Json ($inputValue | ConvertTo-Json -Depth 5) | Out-Null } catch { $rejected = $true }
@{ safe=$safe; rejected=$rejected } | ConvertTo-Json -Depth 8
`);
    expect(JSON.stringify(value.safe)).not.toContain('PRIVATE_CANARY');
    expect(Object.keys(value.safe).sort()).toEqual(['schema', 'captured', 'capture_error', 'root_identity_verified', 'root_alive', 'root_image_is_winget', 'completeness', 'descendant_count', 'truncated', 'children'].sort());
    expect(value.rejected).toBe(true);
  });

  it('does not infer removal from an empty tree and rejects a false schema type', () => {
    const value = run(`
$inputValue = @{ schema=1; captured=$true; capture_error=$false; root_identity_verified=$true; root_alive=$true; root_image_is_winget=$false; completeness=$false; descendant_count=0; truncated=$false; children=@() }
$safe = ConvertTo-ScannerTimeoutCapture -Json ($inputValue | ConvertTo-Json -Depth 5)
$inputValue.schema = $true
$rejected = $false
try { ConvertTo-ScannerTimeoutCapture -Json ($inputValue | ConvertTo-Json -Depth 5) | Out-Null } catch { $rejected = $true }
@{ safe=$safe; rejected=$rejected } | ConvertTo-Json -Depth 8
`);
    expect(value.safe.descendant_count).toBe(0);
    expect(value.safe.completeness).toBe(false);
    expect(value.safe.children).toEqual([]);
    expect(value.rejected).toBe(true);
  });

  it.each([false, true])('writes no capture on success (capture opt in %s)', enabled => {
    const value = run(`
$outcome = Invoke-Winget -Arguments @('-NoProfile', '-NonInteractive', '-Command', 'exit 0') -TimeoutSeconds 5 ${enabled ? '-CaptureOnTimeout' : ''}
@{ outcome=$outcome; captures=@(Read-Captures) } | ConvertTo-Json -Depth 5
`);
    expect(value.captures).toEqual([]);
    expect(value.outcome.ExitCode).toBe(0);
    expect(value.outcome.TimedOut).toBe(false);
  });

  it('keeps install and list timeouts outside capture and opts in only cleanup', () => {
    const value = run(`
$outcome = Invoke-Winget -Arguments @('-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 30') -TimeoutSeconds 1
@{ outcome=$outcome; captures=@(Read-Captures) } | ConvertTo-Json -Depth 5
`);
    expect(value.captures).toEqual([]);
    expect(value.outcome.TimedOut).toBe(true);
    const calls = readFileSync(scanner, 'utf8').split('\n').filter(line => /\$(?:install|uninstall|existing) = Invoke-Winget/.test(line));
    expect(calls.filter(line => line.includes('-CaptureOnTimeout'))).toHaveLength(1);
    expect(calls.find(line => line.includes('-CaptureOnTimeout'))).toContain('$uninstall =');
  });
});
