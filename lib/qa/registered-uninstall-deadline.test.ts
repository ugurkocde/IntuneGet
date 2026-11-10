import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), '.github/scripts/Create-PSADTPackage.ps1'), 'utf8');
const failureOffset = source.indexOf('throw "The vendor uninstall command did not remove registration');
const start = source.lastIndexOf("            '    } elseif ($remainingApplications.Count -gt 0) {'", failureOffset);
const end = source.indexOf("            '    }'", start + 70);
const block = source.slice(start, end + "            '    }'".length).split(/\r?\n/)
  .map(line => /^\s*'((?:[^']|'')*)'\s*,?$/.exec(line)?.[1]?.replaceAll("''", "'"))
  .filter((line): line is string => line !== undefined).join('\n')
  .replace('} elseif ($remainingApplications.Count -gt 0)', 'if ($remainingApplications.Count -gt 0)');

for (const shell of ['pwsh', 'powershell']) {
  describe(`registered uninstall deadline telemetry (${shell})`, () => {
    for (const scenario of ['running', 'completed', 'task-fault', 'cim-fault', 'absent-exe', 'bad-exit', 'count-cap', 'unsafe-root', 'removed']) {
      it.runIf(process.platform === 'win32')(scenario, () => {
        const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', String.raw`
$ErrorActionPreference = 'Stop'
$script:messages = [Collections.Generic.List[string]]::new()
function Write-ADTLogEntry { param($Message, $Severity, $Source) $script:messages.Add([string]$Message) }
function Test-Path { param($LiteralPath, $PathType, $ErrorAction) return ('${scenario}' -ne 'absent-exe') }
function Get-CimInstance { param($ClassName, $OperationTimeoutSec, $ErrorAction)
  if ('${scenario}' -eq 'cim-fault') { throw 'PRIVATE_SENTINEL' }
  if ('${scenario}' -eq 'count-cap') { 1..102 | ForEach-Object { [pscustomobject]@{ExecutablePath='C:\PRIVATE_SENTINEL\App\child.exe'} } } else { [pscustomobject]@{ExecutablePath='C:\PRIVATE_SENTINEL\App\child.exe'} }
  [pscustomobject]@{ExecutablePath=(Join-Path ([IO.Path]::GetTempPath()) '_iu12.tmp')}
  [pscustomobject]@{ExecutablePath='C:\Unrelated\PRIVATE_SENTINEL.exe'}
}
$remainingApplications = if ('${scenario}' -eq 'removed') { @() } else { @(1) }
$registeredUninstallRegistryKey = 'Fixture_is1'
$registeredUninstallFile = 'C:\PRIVATE_SENTINEL\App\unins000.exe'
$registeredApplication = [pscustomobject]@{InstallLocation=$(if ('${scenario}' -eq 'unsafe-root') { 'C:\' } else { 'C:\PRIVATE_SENTINEL\App' })}
$task = [Threading.Tasks.TaskCompletionSource[object]]::new()
if ('${scenario}' -eq 'bad-exit') { $task.SetResult([pscustomobject]@{ExitCode='PRIVATE_SENTINEL'}) }
if ('${scenario}' -eq 'completed') { $task.SetResult([pscustomobject]@{ExitCode=5}) }
if ('${scenario}' -eq 'task-fault') { $task.SetException([Exception]::new('PRIVATE_SENTINEL')) }
$uninstallHandle = @{Task=$task.Task}
$failure = $null
try {
${block}
} catch { $failure=$_.Exception.Message }
[pscustomobject]@{messages=$script:messages.ToArray(); failure=$failure} | ConvertTo-Json -Compress
`], { encoding: 'utf8', timeout: 30_000 });
        expect(result.status, result.stderr).toBe(0);
        const actual = JSON.parse(result.stdout);
        if (scenario === 'removed') {
          expect(actual.failure).toBeNull(); expect(actual.messages).toEqual([]); return;
        }
        expect(actual.failure).toBe('The vendor uninstall command did not remove registration [Fixture_is1] before the completion deadline.');
        expect(actual.messages).toHaveLength(1);
        const line = actual.messages[0];
        expect(line).not.toMatch(/PRIVATE_SENTINEL|[A-Z]:\\/i);
        expect(line.length).toBeLessThanOrEqual(160);
        expect(line).toContain(scenario === 'completed' ? 'task=True exit=5' : ['task-fault', 'bad-exit'].includes(scenario) ? 'task=True exit=unknown' : 'task=False exit=none');
        expect(line).toContain(scenario === 'absent-exe' ? 'exe=False' : 'exe=True');
        expect(line).toContain(['cim-fault', 'unsafe-root'].includes(scenario) ? 'procs=unknown tmp=unknown' : scenario === 'count-cap' ? 'procs=100+ tmp=True' : 'procs=1 tmp=True');
      });
    }
  });
}

