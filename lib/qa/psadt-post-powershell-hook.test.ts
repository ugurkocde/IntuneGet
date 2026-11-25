import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pwshAvailable, summarizePowerShell } from '@/lib/__tests__/powershell-ast-helper';
import { JobProcessor } from '../../packager/src/job-processor';
import type { PackagingJob } from '../../packager/src/job-poller';

// Only the trusted generator runs, using inert package/installer fixtures.
// Hook text and the generated deployment script are parsed, never invoked.
const generator = resolve('.github/scripts/Create-PSADTPackage.ps1');
function build(config: Record<string, unknown>) {
  const parent = realpathSync(tmpdir());
  const root = mkdtempSync(join(parent, 'intuneget-ps-hook-'));
  try {
    for (const d of ['PSAppDeployToolkit', 'Config', 'Strings', 'Assets']) mkdirSync(join(root, 'psadt', d), { recursive: true });
    writeFileSync(join(root, 'psadt/Config/Config.psd1'), "@{Toolkit=@{CompanyName='Fixture'}}");
    writeFileSync(join(root, 'psadt/Strings/strings.psd1'), "@{CloseAppsPrompt=@{CustomMessage=''}}");
    writeFileSync(join(root, 'psadt/Invoke-AppDeployToolkit.exe'), 'inert fixture');
    writeFileSync(join(root, 'setup.bin'), 'inert fixture');
    writeFileSync(join(root, 'Send-Callback.ps1'), 'function Send-Callback {param($Body,$CallbackUrl,$CallbackSecret)}');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|PSMODULEPATH)$/i.test(key)));
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', generator], {
      cwd: root, encoding: 'utf8', timeout: 60_000,
      env: { ...env, GITHUB_WORKSPACE: root, INPUT_JOB_ID: 'hook-fixture', INPUT_CALLBACK_URL: 'https://example.invalid/callback',
        INPUT_DISPLAY_NAME: 'Hook Fixture', INPUT_PUBLISHER: 'Synthetic', INPUT_VERSION: '1.0.0', INPUT_WINGET_ID: 'Synthetic.Hook',
        INPUT_INSTALLER_TYPE: 'exe', INPUT_INSTALL_SCOPE: 'machine', INPUT_SILENT_SWITCHES: '/S', INPUT_INSTALLER_SUCCESS_CODES: '[]',
        INPUT_UNINSTALL_COMMAND: 'REGISTRY_UNINSTALL:Hook Fixture', INSTALLER_PATH: join(root, 'setup.bin'), INSTALLER_FILENAME: 'setup.exe',
        PSADT_CONFIG: JSON.stringify(config) },
    });
    let script = '';
    try { script = readFileSync(join(root, 'package/Invoke-AppDeployToolkit.ps1'), 'utf8'); } catch { /* failure must not emit a deployment */ }
    return { status: result.status, script, log: result.stdout + result.stderr };
  } finally {
    const target = realpathSync(root);
    if (!target.startsWith(parent + sep) || !target.split(sep).at(-1)?.startsWith('intuneget-ps-hook-')) throw new Error('Unsafe fixture cleanup');
    rmSync(target, { recursive: true, force: true });
  }
}

const hooks = ['postInstallPowerShell', 'postUninstallPowerShell'] as const;
function inspectHook(script: string, variable: string, shell = 'pwsh') {
  // This fixed helper parses source received as data on stdin. It never invokes it.
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))
if ($source.Length -gt 0 -and $source[0] -eq [char]0xFEFF) { $source=$source.Substring(1) }
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw 'Generated source has parse errors' }
$assign=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and $n.Left -is [Management.Automation.Language.VariableExpressionAst] -and $n.Left.VariablePath.UserPath -eq '${variable}'},$true))
if ($assign.Count -ne 1) { throw 'Hook assignment not unique' }
$node=$assign[0]; $parent=$node.Parent
while ($parent -and $parent -isnot [Management.Automation.Language.FunctionDefinitionAst]) { $parent=$parent.Parent }
if (-not $parent) { throw 'Hook is outside deployment function' }
$literal=@($node.Right.FindAll({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst]},$true))
$call=@($parent.FindAll({param($n) $n -is [Management.Automation.Language.CommandAst] -and $n.Extent.StartOffset -gt $node.Extent.EndOffset},$true) | Sort-Object {$_.Extent.StartOffset})[0]
$insideTry=$false; $p=$call.Parent
while ($p -and $p -ne $parent) { if ($p -is [Management.Automation.Language.TryStatementAst]) { $insideTry=$true }; $p=$p.Parent }
[pscustomobject]@{function=$parent.Name;literal=$literal[0].Value;kind=$literal[0].StringConstantType.ToString();operator=$call.InvocationOperator.ToString();insideTry=$insideTry} | ConvertTo-Json -Compress
`], { input: Buffer.from(script).toString('base64'), encoding: 'utf8', timeout: 30_000 });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim()) as { function: string; literal: string; kind: string; operator: string; insideTry: boolean };
}
describe.runIf(pwshAvailable && process.platform === 'win32')('hosted in-session post PowerShell', () => {
  it.each(hooks)('embeds %s exactly and invokes a child scope before the marker', (field) => {
    const hook = "Write-ADTLogEntry -Message 'literal $env:PATH ` tick ‘smart’'\n# '@ and \"@ remain comments\nreturn";
    const out = build({ [field]: hook });
    expect(out.status, out.log).toBe(0);
    const ast = summarizePowerShell([out.script])[0];
    expect(ast.errors).toEqual([]);
    expect(ast.strings).toContain(hook);
    const name = field === 'postInstallPowerShell' ? 'PostInstall' : 'PostUninstall';
    expect(inspectHook(out.script, `intuneGet${name}Script`)).toEqual({
      function: field === 'postInstallPowerShell' ? 'Install-ADTDeployment' : 'Uninstall-ADTDeployment',
      literal: hook, kind: 'SingleQuoted', operator: 'Ampersand', insideTry: false,
    });
    expect(inspectHook(out.script, `intuneGet${name}Script`, 'powershell.exe').literal).toBe(hook);
    const assignment = out.script.indexOf(`$intuneGet${name}Script = `);
    const call = out.script.indexOf(`& ([System.Management.Automation.ScriptBlock]::Create($intuneGet${name}Script))`);
    const marker = out.script.indexOf(field === 'postInstallPowerShell' ? "-Name 'DisplayName'" : '# Remove IntuneGet detection marker', call);
    expect(assignment).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(assignment);
    expect(marker).toBeGreaterThan(call);
    expect(out.log).not.toContain('literal $env:PATH');
  }, 60_000);

  it('leaves absent, empty and whitespace defaults byte identical', () => {
    const base = build({});
    expect(base.status, base.log).toBe(0);
    // Golden from the identical inert fixture on the pre-hook generator.
    expect(createHash('sha256').update(base.script).digest('hex')).toBe('eddddd32845d07d6171b5b8a82ac6dcb0d8b5a9d94c03460cb1e13c72f40682c');
    for (const config of [{ postInstallPowerShell: '', postUninstallPowerShell: '' }, { postInstallPowerShell: ' \r\n ', postUninstallPowerShell: '\t' }]) {
      const out = build(config);
      expect(out.status, out.log).toBe(0);
      expect(out.script).toBe(base.script);
    }
  }, 60_000);

  it('retains legacy cmd flattening and puts hooks after commands', () => {
    const out = build({ postInstallCommands: ['echo one\ntwo'], postUninstallCommands: ['echo old'], postInstallPowerShell: 'Write-ADTLogEntry -Message 1', postUninstallPowerShell: 'Write-ADTLogEntry -Message 2' });
    expect(out.status, out.log).toBe(0);
    expect(out.script).toContain("-ArgumentList '/c echo one two'");
    expect(out.script.indexOf("-ArgumentList '/c echo one two'")).toBeLessThan(out.script.indexOf('$intuneGetPostInstallScript ='));
    expect(out.script.indexOf("-ArgumentList '/c echo old'")).toBeLessThan(out.script.indexOf('$intuneGetPostUninstallScript ='));
  }, 60_000);

  it('round-trips a literal here-string with every quote variant and a surrogate pair', () => {
    const quotes = [0x27, 0x2018, 0x2019, 0x201a, 0x201b, 0x22, 0x201c, 0x201d, 0x201e].map(x => String.fromCharCode(x)).join('');
    const hook = `$note = @'\n${quotes} dollar $x backtick \` $(never-invoked) 😀\n'@\nWrite-ADTLogEntry -Message $note`;
    const out = build({ postInstallPowerShell: hook, postUninstallPowerShell: hook });
    expect(out.status, out.log).toBe(0);
    const ast = summarizePowerShell([out.script])[0];
    expect(ast.errors).toEqual([]);
    expect(ast.strings.filter(x => x === hook)).toHaveLength(2);
    expect(out.log).not.toContain('never-invoked');
  }, 60_000);

  it.each([42, {}, 'x'.repeat(8193), 'secret_sentinel\0', 'secret_sentinel\uD800', 'secret_sentinel (', 'using assembly secret_sentinel', '#requires -Version 7\nsecret_sentinel', 'exit 0', 'break', 'continue', 'break outside'])('rejects malformed or session-escaping input without leaking text: case %#', (value) => {
    const out = build({ postInstallPowerShell: value });
    expect(out.status).not.toBe(0);
    expect(out.script).toBe('');
    expect(out.log).not.toContain('secret_sentinel');
  }, 60_000);

  it('accepts a bounded string and loop-local control flow without executing it', () => {
    const hook = "foreach ($x in 1..2) { if ($x -eq 1) { continue }; break }; return";
    const out = build({ postInstallPowerShell: hook, postUninstallPowerShell: '# ' + 'x'.repeat(8190) });
    expect(out.status, out.log).toBe(0);
    expect(summarizePowerShell([out.script])[0].errors).toEqual([]);
  }, 60_000);
});

describe('self-hosted hook guard', () => {
  const local = JobProcessor.prototype as unknown as { generateDeployScript(job: PackagingJob, file: string): string };
  const job = (config: Record<string, unknown>) => ({ id: 'hook', winget_id: 'Synthetic.Hook', version: '1.0', display_name: 'Hook', publisher: 'Synthetic', architecture: 'x64', installer_type: 'exe', install_command: 'setup.exe /S', uninstall_command: 'REGISTRY_UNINSTALL:Hook', package_config: { psadtConfig: config }, detection_rules: [] }) as unknown as PackagingJob;
  it.each(hooks)('refuses unsupported %s instead of silently dropping it', field => {
    expect(() => local.generateDeployScript(job({ [field]: 'Write-ADTLogEntry -Message 1' }), 'setup.exe')).toThrow(/PowerShell hook.*not supported/i);
  });
  it('does not alter the self-hosted default script for empty hooks', () => {
    expect(local.generateDeployScript(job({ postInstallPowerShell: '', postUninstallPowerShell: ' \t' }), 'setup.exe')).toBe(local.generateDeployScript(job({}), 'setup.exe'));
  });
});
