import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { JobProcessor } from '../src/job-processor';
import type { PackagingJob } from '../src/job-poller';

const generator = JobProcessor.prototype as unknown as {
  getPostInstallVerificationBlock(job: PackagingJob, name: string): string;
  generateDeployScript(job: PackagingJob, fileName: string): string;
};
const job: PackagingJob = {
  id: 'regex-fixture', user_id: 'user', user_email: 'qa@example.com', tenant_id: 'tenant',
  winget_id: 'Example.Runtime', version: '10.0.12', display_name: 'Example Runtime',
  publisher: 'Microsoft Corporation', architecture: 'x64', installer_type: 'burn',
  installer_url: 'https://example.com/runtime.exe', installer_sha256: 'A'.repeat(64),
  install_command: '', uninstall_command: 'REGISTRY_UNINSTALL:Example Runtime',
  install_scope: 'machine', detection_rules: [], package_config: {}, status: 'queued',
  progress_percent: 0, created_at: '2026-10-08T00:00:00Z',
};
const block = generator.getPostInstallVerificationBlock(job, job.display_name);
const comparableLines = block.split('\n').map(line => line.trim()).filter(line =>
  /^\$(?:configuredUninstallComparableName|candidateComparableName) = /.test(line));
const publisherLines = block.split('\n').map(line => line.trim()).filter(line =>
  /^\(\$(?:configuredUninstallComparableName|candidateComparableName) -replace /.test(line));

function runPureScript(shell: string, script: string) {
  // Read one complete synthetic harness, avoiding Windows command length limits.
  // The generated deployment script is parsed as text, never invoked.
  return spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command',
    '& ([scriptblock]::Create([Console]::In.ReadToEnd()))'],
  { input: script, encoding: 'utf8', timeout: 30_000 });
}

describe('local registry verification regexes', () => {
  it('preserves all regex escapes in the actual generated normalization expressions', () => {
    expect(comparableLines).toHaveLength(4);
    expect(publisherLines).toHaveLength(2);
    for (const line of comparableLines) {
      expect(line).toContain(String.raw`-replace '\(\s*\)', ''`);
      expect(line).toContain(String.raw`-replace '\(\s+', '('`);
      expect(line).toContain(String.raw`-replace '\s+\)', ')'`);
      expect(line).toContain(String.raw`-replace '\s{2,}', ' '`);
    }
    for (const line of publisherLines) expect(line).toContain(String.raw`'(?:\s+|[._-]+)'`);
  });

  it('rejects single-backslash regex escapes in generator template tokens', () => {
    const source = readFileSync(new URL('../src/job-processor.ts', import.meta.url), 'utf8');
    const file = ts.createSourceFile('job-processor.ts', source, ts.ScriptTarget.Latest, true);
    const violations: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const raw = node.getText(file);
        if (/(?<!\\)(?:\\\\)*\\[()sSdDwWbB]/.test(raw)) {
          violations.push(`line ${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    expect(violations).toEqual([]);
  });

  for (const shell of ['pwsh', 'powershell.exe']) {
    const available = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'],
      { encoding: 'utf8', timeout: 15_000 }).status === 0;
    it.runIf(available)(`executes every emitted expression on ${shell} without changing identity text`, () => {
      const cases = [
        { name: 'Microsoft Windows Desktop Runtime - 10.0.12 (x64)', comparable: 'Microsoft Windows Desktop Runtime - 10.0.12', stripped: 'Microsoft Windows Desktop Runtime - 10.0.12' },
        { name: 'Business Suites ()', comparable: 'Business Suites', stripped: 'Business Suites' },
        { name: 'Contoso   Tools ( Preview )', comparable: 'Contoso Tools (Preview)', stripped: 'Contoso Tools (Preview)' },
        { name: 'Microsoft Corporation Runtime (x86)', comparable: 'Microsoft Corporation Runtime', stripped: 'Runtime' },
        { name: 'Microsoft Corporation.Runtime', comparable: 'Microsoft Corporation.Runtime', stripped: 'Runtime' },
        { name: 'Microsoft CorporationTools', comparable: 'Microsoft CorporationTools', stripped: 'Microsoft CorporationTools' },
      ];
      const expressions = comparableLines.map(line => line.slice(line.indexOf(' = ') + 3));
      const script = `$ErrorActionPreference = 'Stop'
        $cases = '${JSON.stringify(cases)}' | ConvertFrom-Json
        $results = @(foreach ($case in $cases) {
          $configuredUninstallDisplayName = $case.name
          $candidateDisplayName = $case.name
          $_ = [pscustomobject]@{ DisplayName = $case.name }
          $configuredUninstallPublisherName = 'Microsoft Corporation'
          $configuredUninstallComparableName = ${expressions[0]}
          $candidateComparableName = $configuredUninstallComparableName
          [pscustomobject]@{
            Comparable = @(${expressions.join(';\n')})
            Stripped = @(${publisherLines.join(';\n')})
          }
        })
        ConvertTo-Json -InputObject $results -Depth 5 -Compress`;
      const result = runPureScript(shell, script);
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual(cases.map(item => ({
        Comparable: Array(4).fill(item.comparable), Stripped: Array(2).fill(item.stripped),
      })));
    });

    it.runIf(available)(`parses the complete generated deployment script on ${shell}`, () => {
      const deployment = generator.generateDeployScript(job, 'runtime.exe');
      const script = `$tokens = $null; $errors = $null
        $source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(deployment).toString('base64')}'))
        $null = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
        if ($errors.Count) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }`;
      const result = runPureScript(shell, script);
      expect(result.status, result.stderr).toBe(0);
    });
  }
});
