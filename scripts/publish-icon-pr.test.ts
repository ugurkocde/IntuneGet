import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const directories: string[] = [];
afterEach(() => { for (const p of directories.splice(0)) rmSync(p, { recursive: true, force: true }); });

function run(cancelled: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'icon-publisher-'));
  directories.push(dir);
  mkdirSync(join(dir, 'bin'));
  const stub = (name: string, body: string) => writeFileSync(join(dir, 'bin', name), '#!/usr/bin/env bash\n' + body, { mode: 0o755 });
  stub('git', `if [[ "$1" == "diff" && "$*" == *--quiet* ]]; then exit 1; fi
if [[ "$1" == "-c" ]]; then echo public/icons/Fixture.App/icon.png; fi
exit 0
`);
  stub('sleep', 'exit 0\n');
  stub('gh', `printf '%s\\n' "$*" >> calls
case "$1 $2" in
  'pr create') echo https://github.com/example/fixture/pull/1 ;;
  'pr merge') exit 0 ;;
  'pr view')
    if [[ "$*" == *mergeStateStatus* ]]; then echo CLEAN
    elif [[ -f viewed ]]; then echo MERGED
    else touch viewed; echo OPEN; fi ;;
  'pr checks')
    if [[ "$REQUIRED_CANCELLED" == 1 ]]; then echo 1; exit 1
    elif [[ "$*" == *--required* ]]; then echo 0
    else echo 1; fi ;;
  *) exit 91 ;;
esac
`);
  writeFileSync(join(dir, 'output'), '');
  writeFileSync(join(dir, 'calls'), '');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SCRIPT: resolve('.github/scripts/publish-icon-pr.sh').replaceAll('\\', '/'),
    GH_TOKEN: 'fixture-token', GITHUB_OUTPUT: 'output',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_REPOSITORY: 'example/fixture', GITHUB_SERVER_URL: 'https://github.com',
    REQUIRED_CANCELLED: cancelled ? '1' : '0',
  };
  delete env.GITHUB_TOKEN;
  delete env.GIT_CONFIG_COUNT;
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const result = spawnSync(bash, ['-c', 'export PATH="$PWD/bin:$PATH"; bash "$SCRIPT" web "fixture icons"'], { cwd: dir, env, encoding: 'utf8', timeout: 5000 });
  if (result.error) throw result.error;
  return { ...result, output: readFileSync(join(dir, 'output'), 'utf8'), calls: readFileSync(join(dir, 'calls'), 'utf8') };
}

it('ignores an optional cancelled check when required checks pass', () => {
  const result = run(false);
  expect(result.status, result.stderr).toBe(0);
  expect(result.calls.split('\n').find(line => line.startsWith('pr checks '))).toContain('--required');
  expect(result.output).toContain('committed=true');
});

it('retains a required cancellation even when gh exits nonzero', () => {
  const result = run(true);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('Required checks failed');
  expect(result.output).not.toContain('committed=true');
});
