import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Test helper: reads generated PowerShell through the real PowerShell parser.
 * The source is passed as base64 on stdin and is parsed, never invoked.
 */

export const pwshAvailable =
  spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
    encoding: 'utf8',
    timeout: 30_000,
  }).status === 0;

export interface PowerShellAstSummary {
  /** Parser errors. A generated script must have none. */
  errors: string[];
  /** Type name of every AST node in visit order, including nested expressions. */
  shape: string[];
  /** The parsed value of every string literal, after quote and escape processing. */
  strings: string[];
  /** The text of every comment token. */
  comments: string[];
}

const SUMMARY_SCRIPT = `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$sources = [Console]::In.ReadToEnd() | ConvertFrom-Json
$results = foreach ($encoded in @($sources)) {
  $source = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
  if ($source.Length -gt 0 -and $source[0] -eq [char]0xFEFF) { $source = $source.Substring(1) }
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
  $nodes = @($ast.FindAll({ $true }, $true))
  [pscustomobject]@{
    errors = @($errors | ForEach-Object { $_.Message })
    shape = @($nodes | ForEach-Object { $_.GetType().Name })
    strings = @($nodes | Where-Object {
      $_ -is [System.Management.Automation.Language.StringConstantExpressionAst] -or
      $_ -is [System.Management.Automation.Language.ExpandableStringExpressionAst]
    } | ForEach-Object { [string]$_.Value })
    comments = @($tokens | Where-Object { $_.Kind -eq 'Comment' } | ForEach-Object { $_.Text })
  }
}
ConvertTo-Json -InputObject @($results) -Depth 4 -Compress`;

/** Parse one or more PowerShell sources in a single pwsh process. */
export function summarizePowerShell(sources: string[]): PowerShellAstSummary[] {
  const directory = mkdtempSync(join(tmpdir(), 'intuneget-ps-ast-'));
  try {
    const scriptPath = join(directory, 'Summarize-PowerShellAst.ps1');
    writeFileSync(scriptPath, `\uFEFF${SUMMARY_SCRIPT}`, 'utf8');
    const result = spawnSync(
      'pwsh',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        input: JSON.stringify(sources.map((source) => Buffer.from(source, 'utf8').toString('base64'))),
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 120_000,
      }
    );
    if (result.status !== 0) {
      throw new Error(`Could not parse the generated PowerShell:\n${result.stdout}\n${result.stderr}`);
    }
    return JSON.parse(result.stdout.trim()) as PowerShellAstSummary[];
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export const char = (code: number) => String.fromCharCode(code);

// Every character that ends or alters a PowerShell string literal.
export const QUOTE_VARIANTS = [0x27, 0x2018, 0x2019, 0x201a, 0x201b, 0x22, 0x201c, 0x201d, 0x201e].map(char);

export const ADVERSARIAL_VALUES = [
  ...QUOTE_VARIANTS.map((quote) => `A${quote}B`),
  ...QUOTE_VARIANTS.map((quote) => `${quote}${quote}`),
  QUOTE_VARIANTS.join(''),
  'tick`n`$`',
  '$(Get-Date) and ${env:TEMP} and $HOME',
  `first${char(0x0a)}second${char(0x0d)}${char(0x0a)}third`,
  `line${char(0x0a)}'@${char(0x0a)}"@${char(0x0a)}tail`,
  'comment <# open and close #> <#>',
  `ansi ${char(0x451)} ${char(0x452)} ${char(0x2028)} ${char(0x85)} end`,
  '',
];
