import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  psAsciiStringExpression,
  psCommentContent,
  psDoubleQuotedContent,
  psSingleQuoted,
  psSingleQuotedContent,
} from '@/lib/powershell-encoding';
import { ADVERSARIAL_VALUES, pwshAvailable, summarizePowerShell } from './powershell-ast-helper';

const char = (code: number) => String.fromCharCode(code);

describe('PowerShell string encoders', () => {
  it('keeps the local packager copy identical to the shared encoder', () => {
    expect(readFileSync(resolve(process.cwd(), 'packager/src/powershell-encoding.ts'), 'utf8'))
      .toBe(readFileSync(resolve(process.cwd(), 'lib/powershell-encoding.ts'), 'utf8'));
  });

  it('leaves ordinary values unchanged', () => {
    for (const value of ['Contoso App 1.2.3', '/S /D=C:\\Program Files\\App', 'Microsoft.VCRedist.2015+.x64']) {
      expect(psSingleQuotedContent(value)).toBe(value);
      expect(psDoubleQuotedContent(value)).toBe(value);
      expect(psCommentContent(value)).toBe(value);
      expect(psAsciiStringExpression(value)).toBe(`'${value}'`);
    }
  });

  it('keeps non-ASCII text out of the source of an ASCII string expression', () => {
    const value = `Caf${char(0xe9)} ${char(0x451)}${char(0x2019)}`;
    const expression = psAsciiStringExpression(value);
    expect(expression).toMatch(/^[\x20-\x7E]+$/);
    const encoded = /FromBase64String\('([A-Za-z0-9+/=]+)'\)/.exec(expression)?.[1];
    expect(Buffer.from(encoded ?? '', 'base64').toString('utf8')).toBe(value);
  });

  it.runIf(pwshAvailable)('matches the PowerShell CodeGeneration encoders', () => {
    // Values travel as base64 because stdin uses the console code page.
    const script = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$values = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())) | ConvertFrom-Json
ConvertTo-Json -Compress -InputObject @($values | ForEach-Object {
  [pscustomobject]@{
    single = [System.Management.Automation.Language.CodeGeneration]::EscapeSingleQuotedStringContent($_)
    comment = [System.Management.Automation.Language.CodeGeneration]::EscapeBlockCommentContent(($_ -replace '[\\x00-\\x1F\\x7F\\u0085\\u2028\\u2029]+', ' '))
    double = $_ -replace '[\`$"\\u201C-\\u201E]', '\`$0'
  }
})`;
    const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: Buffer.from(JSON.stringify(ADVERSARIAL_VALUES), 'utf8').toString('base64'),
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(result.status, result.stderr).toBe(0);
    const expected = JSON.parse(result.stdout.trim()) as Array<{ single: string; comment: string; double: string }>;
    expect(ADVERSARIAL_VALUES.map((value) => ({
      single: psSingleQuotedContent(value),
      comment: psCommentContent(value),
      double: psDoubleQuotedContent(value),
    }))).toEqual(expected);
  }, 60_000);

  it.runIf(pwshAvailable)('round-trips every adversarial value through the PowerShell parser', () => {
    const sources = ADVERSARIAL_VALUES.flatMap((value) => [
      `$value = ${psSingleQuoted(value)}; Write-Output $value`,
      `$value = "${psDoubleQuotedContent(value)}"; Write-Output $value`,
      `# ${psCommentContent(value)}\n$value = 'tail'`,
      `<# ${psCommentContent(value)} #>\n$value = 'tail'`,
    ]);
    const baseline = summarizePowerShell([
      "$value = 'x'; Write-Output $value",
      '$value = "x"; Write-Output $value',
      "# x\n$value = 'tail'",
      "<# x #>\n$value = 'tail'",
    ]);
    const summaries = summarizePowerShell(sources);

    ADVERSARIAL_VALUES.forEach((value, index) => {
      const [single, double, lineComment, blockComment] = summaries.slice(index * 4, index * 4 + 4);
      for (const [summary, base] of [
        [single, baseline[0]],
        [double, baseline[1]],
        [lineComment, baseline[2]],
        [blockComment, baseline[3]],
      ] as const) {
        expect(summary.errors, JSON.stringify(value)).toEqual([]);
        // No extra AST nodes: the value cannot introduce commands or expressions.
        expect(summary.shape, JSON.stringify(value)).toEqual(base.shape);
        expect(summary.comments.length, JSON.stringify(value)).toBe(base.comments.length);
      }
      expect(single.strings).toContain(value);
      expect(double.strings).toContain(value);
      expect(lineComment.strings).toEqual(['tail']);
      expect(blockComment.strings).toEqual(['tail']);
    });
  }, 120_000);
});
