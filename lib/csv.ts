/**
 * CSV encoding for exports that people open in spreadsheet applications.
 * Safe to import from client components.
 */

// A cell starting with one of these is read as a formula by Excel and others.
const FORMULA_START = /^[=+\-@\t\r]/;

/** Byte order mark, so Excel reads the file as UTF-8. */
export const CSV_UTF8_BOM = '﻿';

/**
 * Encode one CSV cell.
 * Text is always quoted, with embedded quotes doubled. Text that would be
 * read as a formula gets a leading single quote so it stays text. A value
 * that is a finite number is written as a plain number, so a real negative
 * number stays numeric.
 */
export function encodeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);

  const text = String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Encode one CSV row. */
export function encodeCsvRow(cells: readonly unknown[]): string {
  return cells.map(encodeCsvCell).join(',');
}
