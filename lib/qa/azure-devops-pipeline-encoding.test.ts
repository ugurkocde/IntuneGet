import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { char, pwshAvailable, summarizePowerShell } from '@/lib/__tests__/powershell-ast-helper';

// Security hardening of generated PowerShell in the experimental Azure DevOps
// pipeline: parameters must never become script source text, and the
// generated Invoke-AppDeployToolkit.ps1 must embed every value exactly.

interface PipelineStep {
  displayName?: string;
  inputs?: { script?: string; inlineScript?: string };
}

const pipeline = parse(readFileSync(resolve(process.cwd(), '.azuredevops/packaging-pipeline.yml'), 'utf8')) as {
  variables: Array<{ name: string; value: string }>;
  stages: Array<{ jobs: Array<{ steps: PipelineStep[] }> }>;
};
const steps = pipeline.stages.flatMap((stage) => stage.jobs.flatMap((job) => job.steps));
const scriptOf = (step: PipelineStep) => step.inputs?.script ?? step.inputs?.inlineScript ?? '';

const windowsPowerShellAvailable =
  process.platform === 'win32' &&
  spawnSync('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;

const quotes = [0x27, 0x2018, 0x2019, 0x201a, 0x201b, 0x22, 0x201c, 0x201d, 0x201e].map(char).join('');
const LINE = `q${quotes} tick\`t\`$ $(Get-Date) \${env:TEMP} $HOME <# c #>`;
const MULTILINE = `${LINE}\n'@\n"@\nend`;

function generateDeploymentScript(shell: 'pwsh' | 'powershell.exe', values: Record<string, string>): string {
  const generatorStep = steps.find((step) => step.displayName === 'Generate Invoke-AppDeployToolkit.ps1');
  if (!generatorStep) throw new Error('The generator step was not found.');
  const directory = mkdtempSync(join(tmpdir(), 'intuneget-ado-'));
  try {
    // Azure DevOps replaces these macros before the script runs.
    const script = scriptOf(generatorStep)
      .replace('"$(Build.SourcesDirectory)\\package"', `'${directory.replace(/'/g, "''")}'`)
      .split('$(PSADT_VERSION)').join('4.1.8')
      .replace('$deployScript = "$packageDir\\Invoke-AppDeployToolkit.ps1"', '$deployScript = Join-Path $packageDir \'Invoke-AppDeployToolkit.ps1\'');
    const scriptPath = join(directory, 'generator.ps1');
    writeFileSync(scriptPath, `\uFEFF${script}`, 'utf8');
    const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], {
      encoding: 'utf8',
      env: { ...process.env, ...values },
      timeout: 60_000,
    });
    if (result.status !== 0) {
      throw new Error(`Pipeline generator failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
    }
    return readFileSync(join(directory, 'Invoke-AppDeployToolkit.ps1'), 'utf8').replace(/^\uFEFF/, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const valuesFor = (adversarial: boolean) => {
  const v = (field: string, text: string) => (adversarial ? `${field} ${text}` : `${field} plain`);
  return {
    IG_DISPLAY_NAME: v('Name', MULTILINE),
    IG_PUBLISHER: v('Vendor', MULTILINE),
    IG_VERSION: v('1.0', MULTILINE),
    IG_WINGET_ID: v('Contoso.App', LINE),
    IG_SILENT_SWITCHES: v('/S', MULTILINE),
    IG_UNINSTALL_COMMAND: v('uninstall.exe /S', MULTILINE),
    IG_INSTALLER_TYPE: 'exe',
    INSTALLERFILENAME: `${v('setup', LINE)}.exe`,
  };
};

describe('Azure DevOps packaging pipeline encoding', () => {
  it('passes parameters to scripts only through environment variables', () => {
    for (const step of steps) {
      const script = scriptOf(step);
      expect(script, step.displayName).not.toContain('${{');
      expect(script, step.displayName).not.toMatch(/\$\((?:InstallerPath|InstallerFileName|BlobSasUrl)\)/);
    }
    const names = pipeline.variables.map((variable) => variable.name);
    for (const name of ['IG_JOB_ID', 'IG_CALLBACK_URL', 'IG_WINGET_ID', 'IG_DISPLAY_NAME', 'IG_PUBLISHER',
      'IG_VERSION', 'IG_INSTALLER_URL', 'IG_INSTALLER_SHA256', 'IG_INSTALLER_TYPE', 'IG_SILENT_SWITCHES',
      'IG_UNINSTALL_COMMAND']) {
      expect(names).toContain(name);
    }
  });

  for (const shell of ['pwsh', 'powershell.exe'] as const) {
    const available = shell === 'pwsh' ? pwshAvailable : windowsPowerShellAvailable && pwshAvailable;
    it.runIf(available)(`embeds every value exactly in the generated script (${shell})`, () => {
      const [benign, adversarial] = summarizePowerShell([
        generateDeploymentScript(shell, valuesFor(false)),
        generateDeploymentScript(shell, valuesFor(true)),
      ]);
      expect(benign.errors).toEqual([]);
      expect(adversarial.errors).toEqual([]);
      expect(adversarial.shape).toEqual(benign.shape);
      expect(adversarial.comments.length).toBe(benign.comments.length);
      for (const [summary, values] of [[benign, valuesFor(false)], [adversarial, valuesFor(true)]] as const) {
        expect(summary.strings).toContain(values.IG_DISPLAY_NAME);
        expect(summary.strings).toContain(values.IG_PUBLISHER);
        expect(summary.strings).toContain(values.IG_VERSION);
        expect(summary.strings).toContain(`${values.IG_DISPLAY_NAME} ${values.IG_VERSION}`);
        expect(summary.strings).toContain(values.IG_SILENT_SWITCHES);
        expect(summary.strings).toContain(values.IG_UNINSTALL_COMMAND);
        expect(summary.strings).toContain(`$($adtSession.DirFiles)\\${values.INSTALLERFILENAME}`);
      }
    }, 120_000);
  }
});
