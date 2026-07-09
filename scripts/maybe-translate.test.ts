import {
  chmodSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'maybe-translate.mjs',
);
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('maybe-translate build policy', () => {
  it('uses committed translations when no API key is configured', () => {
    const env = { ...process.env };
    delete env.GT_API_KEY;

    const result = spawnSync(process.execPath, [scriptPath], {
      env,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('skipping translation');
  });

  it('does not fail the application build when the translation provider fails', () => {
    const fakeBin = mkdtempSync(join(tmpdir(), 'intuneget-translate-'));
    tempDirectories.push(fakeBin);
    const fakeNpx = join(fakeBin, 'npx');
    writeFileSync(fakeNpx, '#!/bin/sh\nexit 23\n', 'utf8');
    chmodSync(fakeNpx, 0o755);

    const result = spawnSync(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        GT_API_KEY: 'test-key',
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      'continuing with committed translations',
    );
  });
});
