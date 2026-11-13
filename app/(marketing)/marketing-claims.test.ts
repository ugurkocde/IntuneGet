import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Public copy has to match what the product is and does. Two claims were
 * wrong on high-traffic pages and in the structured data search engines
 * quote: the licence (the project is AGPL-3.0, see LICENSE) and an AI search
 * feature that does not exist. This test keeps them from coming back.
 */

const ROOTS = ['app/(marketing)', 'components/landing', 'lib/data'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|md|mdx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const files = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root)));

function offenders(pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(process.cwd(), file).replace(/\\/g, '/'));
}

describe('public copy', () => {
  it('finds the marketing sources', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never calls the project MIT licensed', () => {
    // Also catches the phrase when it is split across two lines of JSX text.
    expect(offenders(/\bMIT\s+licen[cs]e|\bMIT[- ]licen[cs]ed/i)).toEqual([]);
  });

  it('states the licence that LICENSE contains', () => {
    expect(readFileSync(join(process.cwd(), 'LICENSE'), 'utf8')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    expect(readFileSync(join(process.cwd(), 'app/(marketing)/page.tsx'), 'utf8')).toContain(
      'https://www.gnu.org/licenses/agpl-3.0.html'
    );
  });

  it('does not advertise AI features the product does not have', () => {
    expect(offenders(/AI[- ]powered|\bOpenAI\b|natural language quer/i)).toEqual([]);
  });
});
