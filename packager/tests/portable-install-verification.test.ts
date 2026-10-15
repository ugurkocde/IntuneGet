import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { JobProcessor } from '../src/job-processor';
import type { PackagingJob } from '../src/job-poller';

type Generator = {
  getInstallCommand(job: PackagingJob, file: string, silent: string): string;
  getPostInstallVerificationBlock(job: PackagingJob, name: string): string;
};
const generator = JobProcessor.prototype as unknown as Generator;
const quote = (value: string) => value.replaceAll("'", "''");

function portableJob(verifyInstall: boolean): PackagingJob {
  return {
    id: 'synthetic-portable', user_id: 'synthetic', user_email: '', tenant_id: '',
    winget_id: 'Example.Portable', version: '1.0.0', display_name: 'Portable Fixture',
    publisher: 'Example', architecture: 'x64', installer_type: 'zip',
    installer_url: 'https://example.invalid/portable.zip', installer_sha256: 'A'.repeat(64),
    install_command: '', uninstall_command: 'REGISTRY_UNINSTALL:Portable Fixture',
    install_scope: 'machine', detection_rules: [], status: 'queued', progress_percent: 0,
    created_at: '2026-01-01T00:00:00Z',
    package_config: {
      nestedInstallerType: 'portable', nestedInstallerPath: 'portable.exe',
      psadtConfig: { verifyInstall },
    },
  };
}

function executeSyntheticInstall(verifyInstall: boolean, verifyPermissions: boolean, usersRights = 'ReadAndExecute', nestedPath: string | null = 'portable.exe') {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, 'intuneget-portable-contract-'));
  const job = portableJob(verifyInstall);
  job.package_config = {
    nestedInstallerType: 'portable',
    ...(nestedPath === null ? {} : { nestedInstallerPath: nestedPath }),
    psadtConfig: { verifyInstall },
  };
  const install = generator.getInstallCommand.call(generator, job, 'portable.zip', '');
  const verification = verifyPermissions ? '' :
    generator.getPostInstallVerificationBlock.call(generator, job, job.display_name);
  const script = `
$ErrorActionPreference = 'Stop'
$fixtureRoot = '${quote(root)}'
$env:ProgramFiles = Join-Path $fixtureRoot 'program-files'
$env:TEMP = Join-Path $fixtureRoot 'temp'
$source = Join-Path $fixtureRoot 'source'
$files = Join-Path $fixtureRoot 'files'
$null = New-Item -ItemType Directory -Path $env:ProgramFiles,$env:TEMP,$source,$files
# Synthetic text only. Nothing downloaded or executed as an installer.
Set-Content -LiteralPath (Join-Path $source 'portable.exe') -Value 'inert fixture'
Compress-Archive -LiteralPath (Join-Path $source 'portable.exe') -DestinationPath (Join-Path $files 'portable.zip')
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$users = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
foreach ($directory in @($env:ProgramFiles,$env:TEMP)) {
    $acl = [System.Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true,$false)
    $acl.SetOwner($owner)
    $flags = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
    $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($owner,'FullControl',$flags,'None','Allow'))
    if ($directory -eq $env:ProgramFiles) {
        $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($users,'${quote(usersRights)}',$flags,'None','Allow'))
        foreach ($appSid in @('S-1-15-2-1','S-1-15-2-2')) {
            $appIdentity = [System.Security.Principal.SecurityIdentifier]::new($appSid)
            $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($appIdentity,'ReadAndExecute',$flags,'None','Allow'))
        }
    }
    Set-Acl -LiteralPath $directory -AclObject $acl
}
$adtSession = @{ DirFiles = $files; AppVersion = '1.0.0' }
$preInstallApplications = @()
$configuredUninstallDisplayName = 'Portable Fixture'
$configuredUninstallProductCode = ''
$configuredUninstallLocaleHint = ''
function Get-ADTApplication { param($ErrorAction) return @() }
function Start-Sleep { param($Seconds) }
function Write-ADTLogEntry { param($Message,$Source,$Severity) }
${install}
if (-not (Test-Path -LiteralPath (Join-Path $installPath 'portable.exe') -PathType Leaf)) {
    throw 'Synthetic extraction did not produce the declared file'
}
${verification}
${verifyPermissions ? `
$rules = @((Get-Acl -LiteralPath (Join-Path $installPath 'portable.exe')).GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) |
    Where-Object { $_.IdentityReference.Value -eq $users.Value -and $_.AccessControlType -eq 'Allow' })
$rights = [System.Security.AccessControl.FileSystemRights]0
foreach ($rule in $rules) { $rights = $rights -bor $rule.FileSystemRights }
$required = [System.Security.AccessControl.FileSystemRights]::ReadAndExecute
$write = [System.Security.AccessControl.FileSystemRights]'Write,Delete,ChangePermissions,TakeOwnership'
if (($rights -band $required) -ne $required -or ($rights -band $write) -ne 0) {
    throw 'Portable file lacks Users read/execute or grants Users write'
}
` : ''}
Write-Output 'SYNTHETIC_PORTABLE_OK'
`;
  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/secret|token|api.?key|password|supabase|database_url|cron|github|vercel|git_config|git_trace|git_curl_verbose|gh_debug/i.test(key)) delete env[key];
    }
    return spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env, encoding: 'utf8', timeout: 20_000,
    });
  } finally {
    // Delete only this test's resolved, newly created directory under the named temp root.
    const target = realpathSync(root);
    if (!target.startsWith(resolve(parent) + sep) || !target.includes('intuneget-portable-contract-')) {
      throw new Error('Unsafe synthetic fixture cleanup path');
    }
    rmSync(target, { recursive: true, force: true });
  }
}

describe('portable installation verification and inherited permissions', () => {
  it.runIf(process.platform === 'win32').each([null, '', '   ', 'portable.exe'])(
    'keeps local portable extraction valid with nested path %s', (nestedPath) => {
      const result = executeSyntheticInstall(true, false, 'ReadAndExecute', nestedPath);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('SYNTHETIC_PORTABLE_OK');
    },
  );
  it.runIf(process.platform === 'win32').each([false, true])(
    'verifies the actual extracted portable file without requiring ARP, verifyInstall=%s',
    (verifyInstall) => {
      const result = executeSyntheticInstall(verifyInstall, false);
      expect(result.error).toBeUndefined();
      expect(result.stderr, 'generated verification must accept the installed portable file').toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('SYNTHETIC_PORTABLE_OK');
    },
  );
  it.runIf(process.platform === 'win32')('inherits destination Users read/execute without Users write', () => {
    const result = executeSyntheticInstall(false, true);
    expect(result.error).toBeUndefined();
    expect(result.stderr, 'same-volume staging must preserve destination read/execute').toBe('');
    expect(result.status).toBe(0);
  });
  it.runIf(process.platform === 'win32')('fails closed when the destination grants standard users write access', () => {
    const result = executeSyntheticInstall(false, false, 'ReadAndExecute,Write');
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('must not grant standard users write access');
  });

});
