import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const filenames = readdirSync(resolve(import.meta.dirname, '../../supabase/migrations'))
  .filter((name) => /^\d+_.+\.sql$/.test(name));
const version = (name: string) => name.slice(0, name.indexOf('_'));
// Supabase compares version strings, including the legacy short versions.
const ordered = [...filenames].sort((a, b) => {
  const left = version(a);
  const right = version(b);
  return left < right ? -1 : left > right ? 1 : a < b ? -1 : a > b ? 1 : 0;
});

describe('database migration ordering', () => {
  it('uses a unique history version for every SQL migration', () => {
    const duplicates = filenames.filter((name, index) =>
      filenames.findIndex((other) => version(other) === version(name)) !== index);
    expect(duplicates).toEqual([]);
  });

  it('keeps the legacy prerequisites before their dependent migrations', () => {
    const sequence = [
      '014_sccm_migration.sql',
      '0141_winget_index_v2.sql',
      '015_enhanced_error_handling.sql',
      '0151_msp_batch_and_webhooks.sql',
      '016_add_installer_type_to_functions.sql',
    ];
    const positions = sequence.map((name) => ordered.indexOf(name));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
