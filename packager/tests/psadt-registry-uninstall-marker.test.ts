import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JobProcessor } from '../src/job-processor';
import type { PackagingJob } from '../src/job-poller';
import { UTF8_BOM } from '../src/powershell-encoding';

// A registry uninstall marker is internal data that names an installed
// application. It must never be handed to cmd.exe as a command line, whatever
// characters the manifest display name contains.

const generator = JobProcessor.prototype as unknown as {
  generateDeployScript(job: PackagingJob, fileName: string): string;
};

function job(overrides: Partial<PackagingJob>): PackagingJob {
  return {
    id: 'marker-fixture', user_id: 'user', user_email: 'qa@example.com', tenant_id: 'tenant',
    winget_id: 'Contoso.App', version: '1.0.0', display_name: 'Contoso App', publisher: 'Contoso',
    architecture: 'x64', installer_type: 'exe', installer_url: 'https://example.com/setup.exe',
    installer_sha256: 'A'.repeat(64), install_command: '"setup.exe" /S',
    uninstall_command: 'REGISTRY_UNINSTALL:Contoso App', install_scope: 'machine', detection_rules: [],
    package_config: {}, status: 'queued', progress_percent: 0, created_at: '2026-10-10T00:00:00Z',
    ...overrides,
  };
}

const LINE_TERMINATORS: Record<string, string> = {
  LF: '\n',
  CR: '\r',
  CRLF: '\r\n',
  NEL: '\u0085',
  'LINE SEPARATOR': '\u2028',
  'PARAGRAPH SEPARATOR': '\u2029',
};

const CMD_EXE_LINE = /^.*cmd\.exe.*$/gm;

function cmdExeLines(script: string): string[] {
  return script.match(CMD_EXE_LINE) ?? [];
}

function expectNoMarkerOnCommandLine(script: string): void {
  for (const line of cmdExeLines(script)) {
    expect(line).not.toMatch(/REGISTRY_UNINSTALL/i);
  }
  expect(script).not.toMatch(/'\/c\s*REGISTRY_UNINSTALL/i);
}

// A PSModulePath inherited from pwsh 7 hides the Windows PowerShell 5.1
// modules, so the 5.1 child process builds its own default path.
const windowsPowerShellEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath')
);

const powershell51Available =
  process.platform === 'win32' &&
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], {
    encoding: 'utf8',
    env: windowsPowerShellEnv,
    timeout: 30_000,
  }).stdout?.trim() === '5';

describe('local packager registry uninstall marker', () => {
  for (const [name, terminator] of Object.entries(LINE_TERMINATORS)) {
    const displayName = `Contoso${terminator}& whoami`;

    it(`keeps a display name containing ${name} on the registry identity path`, () => {
      const script = generator.generateDeployScript(
        job({ uninstall_command: `REGISTRY_UNINSTALL:${displayName}` }),
        'setup.exe'
      );
      expectNoMarkerOnCommandLine(script);
      expect(script).toContain(`$configuredUninstallDisplayName = '${displayName}'`);
    });

    it(`keeps an exact product or key identity with ${name} in the display name`, () => {
      for (const marker of [
        `REGISTRY_UNINSTALL_PRODUCT:{12345678-1234-1234-1234-123456789ABC}:${displayName}`,
        `REGISTRY_UNINSTALL_KEY:Contoso App 1.0:${displayName}`,
      ]) {
        const script = generator.generateDeployScript(job({ uninstall_command: marker }), 'setup.exe');
        expectNoMarkerOnCommandLine(script);
        expect(script).toContain(`$configuredUninstallDisplayName = '${displayName}'`);
        expect(script).not.toContain('The exact vendor uninstall identity is malformed');
      }
    });
  }

  it('refuses any malformed registry uninstall marker instead of running it', () => {
    for (const marker of [
      'REGISTRY_UNINSTALL:',
      'REGISTRY_UNINSTALL Contoso & whoami',
      'REGISTRY_UNINSTALL;Contoso & whoami',
      ' REGISTRY_UNINSTALL:Contoso & whoami',
      'registry_uninstall:Contoso & whoami',
      'REGISTRY_UNINSTALL_PRODUCT:not-a-guid:Contoso & whoami',
    ]) {
      const script = generator.generateDeployScript(job({ uninstall_command: marker }), 'setup.exe');
      expectNoMarkerOnCommandLine(script);
      expect(script, JSON.stringify(marker)).toMatch(
        /throw "The (?:registry|exact vendor) uninstall identity is malformed/
      );
    }
  });

  it('refuses a malformed marker for an MSI job instead of using a GUID embedded in it', () => {
    for (const marker of [
      'REGISTRY_UNINSTALL_PRODUCT:invalid:{12345678-1234-1234-1234-123456789ABC}:Contoso App',
      'REGISTRY_UNINSTALL {12345678-1234-1234-1234-123456789ABC}',
    ]) {
      const script = generator.generateDeployScript(
        job({ installer_type: 'msi', install_command: '"setup.msi" /qn', uninstall_command: marker }),
        'setup.msi'
      );
      expectNoMarkerOnCommandLine(script);
      expect(script, marker).not.toContain("$configuredUninstallProductCode = '{12345678-1234-1234-1234-123456789ABC}'");
      expect(script, marker).not.toContain("-ProductCode '{12345678-1234-1234-1234-123456789ABC}'");
      expect(script, marker).toMatch(/throw "The (?:registry|exact vendor) uninstall identity is malformed/);
    }
  });

  it('keeps an Inno Setup registry key on the exact identity path', () => {
    const script = generator.generateDeployScript(
      job({
        installer_type: 'inno',
        uninstall_command: 'REGISTRY_UNINSTALL_KEY:{22222222-2222-2222-2222-222222222222}_is1:Inno App',
      }),
      'setup.exe'
    );
    expectNoMarkerOnCommandLine(script);
    expect(script).toContain("$configuredUninstallProductCode = '{22222222-2222-2222-2222-222222222222}_is1'");
    expect(script).toContain("$configuredUninstallDisplayName = 'Inno App'");
    expect(script).not.toContain('uninstall identity is malformed');
  });

  it('refuses a marker hidden behind invisible or lookalike characters', () => {
    const c = (code: number) => String.fromCharCode(code);
    // Full-width forms are the ASCII letters shifted by 0xFEE0.
    const fullWidth = (text: string) => [...text].map((ch) => c(ch.charCodeAt(0) + 0xfee0)).join('');
    for (const marker of [
      `${c(0x200b)}REGISTRY_UNINSTALL:Contoso & whoami`,
      `${c(0x85)}REGISTRY_UNINSTALL:Contoso & whoami`,
      `${c(0xfeff)}REGISTRY_UNINSTALL:Contoso & whoami`,
      `REGISTRY${c(0xad)}_UNINSTALL:Contoso & whoami`,
      `${fullWidth('REGISTRY_UNINSTALL')}:Contoso & whoami`,
      // U+E0020 TAG SPACE is an astral format character (two UTF-16 units).
      `REGISTRY${String.fromCodePoint(0xe0020)}_UNINSTALL:Contoso & whoami`,
      `${c(0x200b)}MSIX_UNINSTALL:Contoso & whoami`,
      'echo & REGISTRY_UNINSTALL:Contoso',
    ]) {
      for (const installerType of ['exe', 'msi']) {
        const script = generator.generateDeployScript(
          job({
            installer_type: installerType,
            uninstall_command: `${marker} {12345678-1234-1234-1234-123456789ABC}`,
          }),
          installerType === 'msi' ? 'setup.msi' : 'setup.exe'
        );
        const name = `${installerType} ${JSON.stringify(marker)}`;
        expect(cmdExeLines(script).filter((line) => line.includes("-ArgumentList '/c")), name).toEqual([]);
        expect(script, name).not.toContain("-ProductCode '{12345678-1234-1234-1234-123456789ABC}'");
        expect(script, name).not.toContain("$configuredUninstallProductCode = '{12345678-1234-1234-1234-123456789ABC}'");
        expect(script, name).toContain('throw "The registry uninstall identity is malformed; refusing to run it as a command."');
      }
    }
  });

  it('lets a custom uninstall command replace a malformed marker', () => {
    const script = generator.generateDeployScript(
      job({
        uninstall_command: `${String.fromCharCode(0x200b)}REGISTRY_UNINSTALL:Contoso`,
        package_config: { psadtConfig: { uninstallCommand: '"C:\\Contoso\\remove.exe" /quiet' } },
      }),
      'setup.exe'
    );
    expect(script).toContain("-ArgumentList '/c \"C:\\Contoso\\remove.exe\" /quiet'");
    expect(script).not.toContain('uninstall identity is malformed');
  });

  it('does not mistake a vendor uninstaller named like the marker for a marker', () => {
    const script = generator.generateDeployScript(
      job({ uninstall_command: '"C:\\Contoso\\registry_uninstaller.exe" /S' }),
      'setup.exe'
    );
    expect(script).toContain("-ArgumentList '/c \"C:\\Contoso\\registry_uninstaller.exe\" /S'");
    expect(script).not.toContain('uninstall identity is malformed');
  });

  it('still runs a plain vendor uninstall command through cmd.exe', () => {
    const script = generator.generateDeployScript(
      job({ uninstall_command: '"C:\\Program Files\\Contoso\\uninstall.exe" /S' }),
      'setup.exe'
    );
    expect(cmdExeLines(script).some((line) => line.includes("'/c \"C:\\Program Files\\Contoso\\uninstall.exe\" /S'")))
      .toBe(true);
  });

  it.runIf(powershell51Available)(
    'parses in Windows PowerShell 5.1 from disk with the exact display name',
    () => {
      const directory = mkdtempSync(join(tmpdir(), 'intuneget-marker-ps51-'));
      try {
        const names = Object.values(LINE_TERMINATORS).map((terminator) => `Contoso ё${terminator}& whoami`);
        const expectedPath = join(directory, 'expected.json');
        writeFileSync(expectedPath, JSON.stringify(names), 'utf8');
        names.forEach((displayName, index) => {
          const script = generator.generateDeployScript(
            job({ uninstall_command: `REGISTRY_UNINSTALL:${displayName}` }),
            'setup.exe'
          );
          // Written exactly as JobProcessor writes Invoke-AppDeployToolkit.ps1.
          writeFileSync(join(directory, `script-${index}.ps1`), `${UTF8_BOM}${script}`, 'utf8');
        });
        const check = join(directory, 'Check.ps1');
        writeFileSync(check, `${UTF8_BOM}$ErrorActionPreference = 'Stop'
$expected = [IO.File]::ReadAllText('${expectedPath}', [Text.Encoding]::UTF8) | ConvertFrom-Json
for ($index = 0; $index -lt $expected.Count; $index++) {
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path '${directory}' "script-$index.ps1"), [ref]$tokens, [ref]$errors)
    if ($errors.Count -gt 0) { throw "script-$index parse errors: $($errors[0].Message)" }
    $assignment = $ast.Find({
        param($node)
        $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
        $node.Left.Extent.Text -eq '$configuredUninstallDisplayName'
    }, $true)
    if ($null -eq $assignment) { throw "script-$index has no configured display name" }
    $value = $assignment.Right.Expression.Value
    if ($value -cne $expected[$index]) { throw "script-$index display name mismatch" }
    $commandLines = @($ast.FindAll({
        param($node)
        $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and
        $node.Value -match '^/c\\s*REGISTRY_UNINSTALL'
    }, $true))
    if ($commandLines.Count -gt 0) { throw "script-$index passes the marker to cmd.exe" }
}
'ok'
`, 'utf8');
        const result = spawnSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', check],
          { encoding: 'utf8', env: windowsPowerShellEnv, timeout: 60_000 }
        );
        expect(`${result.stdout}${result.stderr}`.trim()).toBe('ok');
        // The generated script on disk keeps its byte order mark.
        expect([...readFileSync(join(directory, 'script-0.ps1')).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    60_000
  );
});
