import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { psAsciiStringExpression, psCommentContent } from '../powershell-encoding';

const workflow = readFileSync(resolve(process.cwd(), '.github/workflows-reference/package-intunewin.yml'), 'utf8');
const start = workflow.indexOf('            $displayName = $env:DISPLAY_NAME', workflow.indexOf('# If no detection rules provided'));
const end = workflow.indexOf('            $graphRules = @(', start);
const generation = workflow.slice(start, end).replace(/^            /gm, '')
  .replace('$displayName = $env:DISPLAY_NAME', '$displayName = $row.value')
  .replace('$wingetId = $env:WINGET_ID', '$wingetId = $row.value');
const values = [
  '', 'Ordinary App', "O'Brien", '$($env:USERNAME)', '`$name', 'quoted "name"',
  '\u2018\u2019\u201A\u201B\u201C\u201D\u201E', '\u00e9\u0151',
  '\u4e2d\u6587', '\ud83d\ude00', '\ud800', 'trailing\n', 'line\r\nnext',
  '\u0085\u2028\u2029', '<# comment #>', '$(throw "unexpected expansion")',
  "x'\nthrow 'unexpected statement'", '\u0000\u007f',
];
type Row = { expression: string; comment: string; app: string; id: string; parseErrors: number; ascii: boolean; legacyDecodeEqual: boolean; unsafeAssignmentNodes: number };
let rows: Row[];
beforeAll(() => {
  const directory = mkdtempSync(join(tmpdir(), 'intuneget-fallback-'));
  const inputPath = join(directory, 'values.json');
  const scriptPath = join(directory, 'verify.ps1');
  writeFileSync(inputPath, JSON.stringify(values.map(value => ({ units: value.split('').map(character => character.charCodeAt(0)) }))), 'utf8');
  const command = [
    `$inputRows = Get-Content -LiteralPath '${inputPath.replace(/'/g, "''")}' -Raw -Encoding UTF8 | ConvertFrom-Json`,
    '$output = foreach ($row in $inputRows) {',
    '$row = [pscustomobject]@{value=(-join @($row.units | ForEach-Object {[char]$_}))}',
    generation,
    '$tokens = $null; $errors = $null',
    '$ast = [System.Management.Automation.Language.Parser]::ParseInput($detectionScript, [ref]$tokens, [ref]$errors)',
    "$assignmentLines = ($scriptLines | Where-Object { $_ -match '^\\$(AppName|WingetId) = ' }) -join \"`n\"",
    // Only evaluate the two generated assignments. The registry detector is never executed.
    '$binding = & ([scriptblock]::Create($assignmentLines + "`n[pscustomobject]@{app=\`$AppName;id=\`$WingetId}"))',
    '$assignmentAsts = $ast.FindAll({param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and $node.Left.VariablePath.UserPath -in @("AppName", "WingetId")}, $true)',
    '$unsafeNodes = @($assignmentAsts | ForEach-Object { $_.Right.FindAll({param($node) $node -is [System.Management.Automation.Language.SubExpressionAst] -or $node -is [System.Management.Automation.Language.ExpandableStringExpressionAst]}, $true) })',
    '[pscustomobject]@{expression=(ConvertTo-IntuneGetAsciiStringExpression $row.value);comment=(ConvertTo-IntuneGetAsciiCommentContent $row.value);app=$binding.app;id=$binding.id;parseErrors=@($errors).Count;ascii=($detectionScript -cmatch "^[\\x00-\\x7F]*\\z");legacyDecodeEqual=([System.Text.Encoding]::GetEncoding(1252).GetString([System.Text.Encoding]::UTF8.GetBytes($detectionScript)) -ceq $detectionScript);unsafeAssignmentNodes=$unsafeNodes.Count}',
    '}',
    'ConvertTo-Json -InputObject @($output) -Depth 8 -Compress',
  ].join('\n');
  writeFileSync(scriptPath, command, 'utf8');
  const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', scriptPath], {
    encoding: 'utf8', timeout: 20_000,
  });
  unlinkSync(inputPath);
  unlinkSync(scriptPath);
  rmdirSync(directory);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  rows = JSON.parse(result.stdout);
}, 25_000);

describe('workflow fallback detection encoding', () => {
  it.each(values.map((value, index) => [index, value] as const))('preserves input %i without script expansion', (index, value) => {
    const row = rows[index];
    expect(row.expression).toBe(psAsciiStringExpression(value));
    const expectedComment = psCommentContent(value).split('').map(character =>
      character.charCodeAt(0) >= 0x20 && character.charCodeAt(0) <= 0x7e
        ? character : '\\u' + character.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')
    ).join('');
    expect(row.comment).toBe(expectedComment);
    const utf8Value = Buffer.from(value, 'utf8').toString('utf8');
    expect(row.app).toBe(utf8Value);
    expect(row.id).toBe(utf8Value);
    expect(row.parseErrors).toBe(0);
    expect(row.ascii).toBe(true);
    expect(row.legacyDecodeEqual).toBe(true);
    expect(row.unsafeAssignmentNodes).toBe(0);
  });
});
