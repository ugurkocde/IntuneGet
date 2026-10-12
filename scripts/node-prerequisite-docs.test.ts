import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function engineMinimumMajor(packageJsonPath: string): number {
  const engines = JSON.parse(read(packageJsonPath)).engines?.node as string | undefined;
  const match = engines?.match(/>=\s*(\d+)/);
  if (!match) {
    throw new Error(`${packageJsonPath} has no ">=N" Node engine range`);
  }
  return Number(match[1]);
}

function documentedNodeMajors(text: string): number[] {
  const pattern = /Node\.js (\d+)(?:\+| or (?:higher|later))/g;
  return Array.from(text.matchAll(pattern), (match) => Number(match[1]));
}

// Each documented "Node.js N or later" prerequisite must not promise support
// for a Node major below the engines range that npm enforces (issue #168).
const documents: Array<{ file: string; packageJson: string }> = [
  { file: 'docs/DEVELOPMENT.md', packageJson: 'package.json' },
  { file: 'docs/SELF_HOSTING.md', packageJson: 'packager/package.json' },
  { file: 'packager/README.md', packageJson: 'packager/package.json' },
  {
    file: 'app/(marketing)/docs/getting-started/page.tsx',
    packageJson: 'packager/package.json',
  },
];

describe('Node.js prerequisites in documentation', () => {
  it.each(documents)('$file matches the $packageJson engines range', ({ file, packageJson }) => {
    const minimum = engineMinimumMajor(packageJson);
    const majors = documentedNodeMajors(read(file));

    expect(majors.length).toBeGreaterThan(0);
    for (const major of majors) {
      expect(major, `${file} documents Node.js ${major}`).toBeGreaterThanOrEqual(minimum);
    }
  });
});
