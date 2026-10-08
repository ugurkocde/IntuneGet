import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parse } from 'yaml'

const workflow = parse(readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8'))
const detector = workflow.jobs['docker-changes'].steps.find((step: { id?: string }) => step.id === 'diff').run
const bash = process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
  ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const fixtures: string[] = []

function git(directory: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()
}

function fixture(path: string) {
  const directory = mkdtempSync(join(tmpdir(), 'intuneget-maintenance-ci-diff-'))
  fixtures.push(directory)
  git(directory, 'init', '--quiet')
  git(directory, 'config', 'user.name', 'Fixture')
  git(directory, 'config', 'user.email', 'fixture@example.invalid')
  git(directory, 'config', 'core.autocrlf', 'false')
  git(directory, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(directory, 'baseline.txt'), 'baseline\n')
  git(directory, 'add', '.')
  git(directory, 'commit', '--quiet', '-m', 'Fixture baseline')
  const base = git(directory, 'rev-parse', 'HEAD')
  git(directory, 'checkout', '--quiet', '-b', 'fixture-change')
  const target = join(directory, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, 'fixture change\n')
  git(directory, 'add', '.')
  git(directory, 'commit', '--quiet', '-m', 'Fixture change')
  return { directory, base, head: git(directory, 'rev-parse', 'HEAD') }
}

function runDetector(directory: string, base: string, head: string) {
  const output = join(directory, 'detector-output')
  writeFileSync(output, '')
  const result = spawnSync(bash, ['-c', detector], {
    cwd: directory,
    env: { ...process.env, BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output.replaceAll('\\', '/') },
    encoding: 'utf8',
  })
  return { status: result.status, output: readFileSync(output, 'utf8').trim(), error: result.error }
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    const absolute = resolve(directory)
    if (!absolute.startsWith(resolve(tmpdir()) + '/') && !absolute.startsWith(resolve(tmpdir()) + '\\')) {
      throw new Error('Fixture cleanup escaped the temporary directory')
    }
    if (!absolute.includes('intuneget-maintenance-ci-diff-')) throw new Error('Unexpected fixture directory')
    rmSync(absolute, { recursive: true, force: true })
  }
})

describe('actual Docker input detector', () => {
  it.each(['package.json', 'package-lock.json', 'next.config.js', 'lib/db/index.ts', 'lib/db/sqlite.ts'])
  ('tests image dependency or SQLite runtime input %s', path => {
    const f = fixture(path)
    expect(runDetector(f.directory, f.base, f.head)).toMatchObject({ status: 0, output: 'changed=true' })
  })

  it.each(['lib/qa/example.test.ts', 'packager/src/job-processor.ts', 'lib/db/types.ts', 'docs/example.md'])
  ('keeps unrelated QA or documentation change %s on the normal CI path', path => {
    const f = fixture(path)
    expect(runDetector(f.directory, f.base, f.head)).toMatchObject({ status: 0, output: 'changed=false' })
  })

  it('uses the merge base when main advances independently', () => {
    const f = fixture('package-lock.json')
    git(f.directory, 'checkout', '--quiet', '--detach', f.base)
    writeFileSync(join(f.directory, 'qa-base-change.txt'), 'unrelated main change\n')
    git(f.directory, 'add', '.')
    git(f.directory, 'commit', '--quiet', '-m', 'Fixture main advance')
    const currentBase = git(f.directory, 'rev-parse', 'HEAD')
    expect(runDetector(f.directory, currentBase, f.head)).toMatchObject({ status: 0, output: 'changed=true' })
  })

  it('fails closed when the base revision cannot be read', () => {
    const f = fixture('Dockerfile')
    const result = runDetector(f.directory, 'missing-maintenance-fixture-revision', f.head)
    expect(result.status).not.toBe(0)
    expect(result.output).toBe('')
  })
})
