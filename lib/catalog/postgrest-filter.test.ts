import { describe, it, expect } from 'vitest';
import {
  quotePostgrestValue,
  quotePostgrestLikePattern,
} from './postgrest-filter';

describe('quotePostgrestValue', () => {
  it('wraps a plain value in double quotes', () => {
    expect(quotePostgrestValue('Zoom')).toBe('"Zoom"');
  });

  it('protects the logic tree from a value containing a comma', () => {
    expect(quotePostgrestValue('Arhus, Randers & Hobro')).toBe(
      '"Arhus, Randers & Hobro"'
    );
  });

  it('escapes embedded double quotes instead of dropping them', () => {
    expect(quotePostgrestValue('say "hi"')).toBe('"say \\"hi\\""');
  });

  it('escapes backslashes before quotes so the escape cannot be broken out of', () => {
    // String.fromCharCode(92) keeps these cases readable: a literal
    // backslash in a JS string or template is easy to miscount.
    const bs = String.fromCharCode(92);
    expect(quotePostgrestValue('back' + bs + 'slash')).toBe(
      '"back' + bs + bs + 'slash"'
    );
    expect(quotePostgrestValue('trailing' + bs)).toBe(
      '"trailing' + bs + bs + '"'
    );
    // A lone trailing backslash must not let the value escape its quotes.
    expect(quotePostgrestValue('evil' + bs + '"')).toBe(
      '"evil' + bs + bs + bs + '""'
    );
  });

  it('keeps parentheses inside the quoted value', () => {
    expect(quotePostgrestValue('Zoom Workplace (64-bit)')).toBe(
      '"Zoom Workplace (64-bit)"'
    );
  });
});

describe('quotePostgrestLikePattern', () => {
  it('wraps the term in contains-wildcards inside the quotes', () => {
    expect(quotePostgrestLikePattern('zoom')).toBe('"%zoom%"');
  });

  it('produces a parseable or() operand for a comma-bearing app name', () => {
    const pattern = quotePostgrestLikePattern(
      'docubizz -tck arhus, randers & hobro'
    );
    const filter = [
      `name.ilike.${pattern}`,
      `publisher.ilike.${pattern}`,
    ].join(',');

    // The only unquoted comma must be the operand separator, otherwise
    // PostgREST splits the value and the logic tree fails to parse.
    expect(splitTopLevel(filter)).toEqual([
      'name.ilike."%docubizz -tck arhus, randers & hobro%"',
      'publisher.ilike."%docubizz -tck arhus, randers & hobro%"',
    ]);
  });
  it('neutralises an injection payload combining comma, parens, quote and backslash', () => {
    const bs = String.fromCharCode(92);
    // A value crafted to close the quote and append a second operand that
    // would match Zoom rows. Verified against the production PostgREST
    // endpoint: unquoted, `%zzzznomatch%,name.ilike.%zoom%` really does
    // inject and return Zoom rows; the escaped form below returns HTTP 200
    // with no rows.
    const hostile = 'zzzznomatch%"),name.ilike.%zoom%' + bs;
    const filter = `name.ilike.${quotePostgrestLikePattern(hostile)}`;

    expect(filter).toBe(
      'name.ilike."%zzzznomatch%\\"),name.ilike.%zoom%' + bs + bs + '%"'
    );
    // Exactly one operand: nothing the value contained became filter syntax.
    expect(splitTopLevel(filter)).toHaveLength(1);
  });
});
/** Split on commas that are not inside a quoted section, mirroring PostgREST. */
function splitTopLevel(filter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < filter.length; i++) {
    const char = filter[i];
    if (char === String.fromCharCode(92) && inQuotes) {
      current += char + filter[++i];
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (char === ',' && !inQuotes) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}
