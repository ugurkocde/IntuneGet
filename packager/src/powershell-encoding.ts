/**
 * Encoders for values embedded into generated PowerShell.
 *
 * PowerShell ends a single-quoted string at U+0027 and at the typographic
 * quotes U+2018 to U+201B, and a double-quoted string at U+0022 and at
 * U+201C to U+201E. Double-quoted strings also expand $ and backtick escapes.
 *
 * lib/powershell-encoding.ts and packager/src/powershell-encoding.ts are identical
 * copies because the local packager is published separately and cannot import
 * from lib/. A test keeps them identical. The hosted
 * packager (.github/scripts/Create-PSADTPackage.ps1) uses the same rules
 * through System.Management.Automation.Language.CodeGeneration.
 */

/** Content for a PowerShell single-quoted string: every quote is doubled. */
export function psSingleQuotedContent(value: string): string {
  return value.replace(/['\u2018-\u201B]/g, '$&$&');
}

/** A complete PowerShell single-quoted string literal. */
export function psSingleQuoted(value: string): string {
  return `'${psSingleQuotedContent(value)}'`;
}

/** Content for a PowerShell double-quoted string: quotes, $ and backtick are escaped. */
export function psDoubleQuotedContent(value: string): string {
  return value.replace(/[`$"\u201C-\u201E]/g, '`$&');
}

/**
 * Content for a PowerShell comment: kept on one line and never able to open
 * or close a block comment. Mirrors CodeGeneration.EscapeBlockCommentContent.
 */
export function psCommentContent(value: string): string {
  return value
    .replace(/[\x00-\x1F\x7F\u0085\u2028\u2029]+/g, ' ')
    .replace(/<#/g, '<`#')
    .replace(/#>/g, '#`>');
}

/**
 * Windows PowerShell 5.1 reads a script without a byte order mark in the
 * active ANSI code page, where UTF-8 continuation bytes such as 0x91 and 0x92
 * decode as typographic quotes. A generated script that can contain
 * non-ASCII text must therefore start with a UTF-8 byte order mark.
 */
export const UTF8_BOM = '\uFEFF';

/**
 * A PowerShell expression for a string whose source text is ASCII only, so it
 * reads identically whether the script is decoded as UTF-8 or as ANSI. Plain
 * ASCII values stay a single-quoted literal.
 */
export function psAsciiStringExpression(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) {
    return psSingleQuoted(value);
  }
  const base64 = Buffer.from(value, 'utf8').toString('base64');
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64}'))`;
}
