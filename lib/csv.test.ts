import { describe, expect, it } from 'vitest';
import { CSV_UTF8_BOM, encodeCsvCell, encodeCsvRow } from './csv';

describe('encodeCsvCell', () => {
  it.each([
    ['equals', '=HYPERLINK("http://example.test","click")', `"'=HYPERLINK(""http://example.test"",""click"")"`],
    ['plus', '+1+1', `"'+1+1"`],
    ['minus', '-2+3', `"'-2+3"`],
    ['at sign', '@SUM(A1:A2)', `"'@SUM(A1:A2)"`],
    ['tab', '\t=1+1', `"'\t=1+1"`],
    ['carriage return', '\r=1+1', `"'\r=1+1"`],
    ['a bare equals sign', '=', `"'="`],
    ['a command style payload', "=cmd|' /C calc'!A0", `"'=cmd|' /C calc'!A0"`],
  ])('neutralises text starting with %s', (_label, value, expected) => {
    expect(encodeCsvCell(value)).toBe(expected);
  });

  it.each([
    ['plain text', 'Contoso', '"Contoso"'],
    ['text with a comma', 'Contoso, Ltd.', '"Contoso, Ltd."'],
    ['text with embedded quotes', 'The "best" app', '"The ""best"" app"'],
    ['text with a newline', 'line one\nline two', '"line one\nline two"'],
    ['text with a carriage return and newline', 'line one\r\nline two', '"line one\r\nline two"'],
    ['a formula character that is not first', 'a=b+c-d@e', '"a=b+c-d@e"'],
    ['text that starts with a space', ' =1+1', '" =1+1"'],
    ['an email address', 'user@example.com', '"user@example.com"'],
    ['a version', '1.2.3', '"1.2.3"'],
    ['an ISO date', '2026-11-13T08:00:00.000Z', '"2026-11-13T08:00:00.000Z"'],
    ['non-ASCII text', 'Müller GmbH 東京', '"Müller GmbH 東京"'],
    ['an empty string', '', '""'],
    ['a single quote', "'", `"'"`],
  ])('quotes %s', (_label, value, expected) => {
    expect(encodeCsvCell(value)).toBe(expected);
  });

  it.each([
    [0, '0'],
    [42, '42'],
    [-5, '-5'],
    [-0.25, '-0.25'],
    [1.5e21, '1.5e+21'],
  ])('keeps the finite number %s numeric', (value, expected) => {
    expect(encodeCsvCell(value)).toBe(expected);
  });

  it('treats a negative number given as text like any other text', () => {
    expect(encodeCsvCell('-5')).toBe(`"'-5"`);
  });

  it.each([
    [Number.NaN, '"NaN"'],
    [Number.POSITIVE_INFINITY, '"Infinity"'],
    [Number.NEGATIVE_INFINITY, `"'-Infinity"`],
  ])('does not treat %s as a number', (value, expected) => {
    expect(encodeCsvCell(value)).toBe(expected);
  });

  it('writes null and undefined as an empty quoted cell', () => {
    expect(encodeCsvCell(null)).toBe('""');
    expect(encodeCsvCell(undefined)).toBe('""');
  });

  it('writes other values as quoted text', () => {
    expect(encodeCsvCell(true)).toBe('"true"');
    expect(encodeCsvCell(false)).toBe('"false"');
    expect(encodeCsvCell(BigInt(-7))).toBe(`"'-7"`);
    expect(encodeCsvCell({ toString: () => '=1+1' })).toBe(`"'=1+1"`);
  });
});

describe('encodeCsvRow', () => {
  it('joins encoded cells with commas', () => {
    expect(encodeCsvRow(['Job ID', 'Tenant, Inc.', -3, null, '=SUM(1)'])).toBe(
      `"Job ID","Tenant, Inc.",-3,"","'=SUM(1)"`,
    );
  });

  it('encodes an empty row as an empty line', () => {
    expect(encodeCsvRow([])).toBe('');
  });
});

describe('CSV_UTF8_BOM', () => {
  it('is the UTF-8 byte order mark', () => {
    expect([...Buffer.from(CSV_UTF8_BOM, 'utf8')]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
