import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

const bash = process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe')
  ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const script = resolve('scripts/ci/verify-docker-sqlite.sh').replaceAll('\\', '/')
const fixtures: string[] = []
const shellPath = (path: string) => path.replaceAll('\\', '/').replace(/^([A-Za-z]):\//, (_, drive: string) => `/${drive.toLowerCase()}/`)
const mock = `#!/usr/bin/env bash
set -eu
echo "$0 $*" >> "$MOCK_LOG"
case "$(basename "$0")" in
  curl) [[ "$SCENARIO" != health ]] || exit 1; echo '{"databaseMode":"sqlite","services":{"database":true}}';;
  jq) exit 0;;
  sleep) exit 0;;
  docker)
    case "$1 $2" in
      'volume inspect') [[ "$SCENARIO" == existing ]];;
      'volume create') [[ "$SCENARIO" != create ]];;
      'volume rm'|'rm --force'|'logs fixture-container') exit 0;;
      'run --detach') [[ "$SCENARIO" != run ]] || exit 1; echo fixture-container;;
      'run --rm') exit 0;;
      'exec fixture-container')
        case "$3" in
          id) echo 1001;;
          stat) if [[ "$SCENARIO" == owner ]]; then echo 0:0; else echo 1001:1001; fi;;
          node)
            if [[ "$4" != -e ]]; then exit 2; fi
            printf '%s\\n' "$5" >> "$MOCK_CODE"
            if [[ "$5" == *'SELECT value'* && "$SCENARIO" == persistence ]]; then exit 1; fi
            if [[ "$5" == *'SELECT value'* && "$SCENARIO" == migration && "$6" == upgrade ]]; then exit 1; fi;;
          *) exit 2;;
        esac;;
      *) exit 2;;
    esac;;
esac
`

function probe(scenario: string, upgrade = false) {
  const directory = mkdtempSync(join(tmpdir(), 'intuneget-release-probe-'))
  fixtures.push(directory)
  for (const command of ['docker', 'curl', 'jq', 'sleep']) writeFileSync(join(directory, command), mock)
  const log = join(directory, 'commands.log')
  const code = join(directory, 'code.log')
  const result = spawnSync(bash, ['-c', 'chmod +x "$MOCK_BIN"/*; export PATH="$MOCK_BIN:$PATH"; bash "$PROBE" target-image ${UPGRADE:+baseline-image}'], {
    encoding: 'utf8',
    env: { ...process.env, MOCK_BIN: shellPath(directory), MOCK_LOG: shellPath(log), MOCK_CODE: shellPath(code),
      PROBE: script, SCENARIO: scenario, UPGRADE: upgrade ? 'yes' : '' },
  })
  return { status: result.status, output: result.stdout + result.stderr,
    log: existsSync(log) ? readFileSync(log, 'utf8') : '', code: existsSync(code) ? readFileSync(code, 'utf8') : '' }
}

afterEach(() => {
  for (const directory of fixtures.splice(0)) {
    const root = resolve(tmpdir())
    if (!resolve(directory).startsWith(root + '/') && !resolve(directory).startsWith(root + '\\')) throw new Error('Unsafe fixture cleanup')
    if (!directory.includes('intuneget-release-probe-')) throw new Error('Unexpected fixture')
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('actual SQLite image probe with command adapters', () => {
  it('recreates the fresh container and checks durable data before cleanup', () => {
    const result = probe('success')
    expect(result.status, result.output).toBe(0)
    expect(result.log.match(/docker run --detach/g)).toHaveLength(2)
    expect(result.code).toContain('SQLite data did not survive container recreation')
    expect(result.log).toContain('docker volume rm intuneget-ci-')
    expect(result.log).not.toContain('docker run --rm --user 0')
  })
  it('restricts the old image ownership workaround to its disposable fixture and checks migration', () => {
    const result = probe('success', true)
    expect(result.status, result.output).toBe(0)
    expect(result.log).toContain('--user 0 --entrypoint sh --mount type=volume,source=intuneget-ci-')
    expect(result.log).toContain('baseline-image -c chown 1001:1001 /data')
    expect(result.code).toContain('ci-release-fixture')
    expect(result.code).toContain('db.pragma("user_version", {simple:true}) !== 9')
  })
  it.each(['health', 'owner', 'persistence', 'migration'])('fails truthfully on %s and cleans owned fixtures', scenario => {
    const result = probe(scenario, scenario === 'migration')
    expect(result.status, result.output).not.toBe(0)
    expect(result.log).toContain('docker rm --force fixture-container')
    expect(result.log).toContain('docker volume rm intuneget-ci-')
  }, 30000)
  it('never deletes an existing volume', () => {
    const result = probe('existing')
    expect(result.status).not.toBe(0)
    expect(result.log).not.toContain('docker volume create')
    expect(result.log).not.toContain('docker volume rm')
  })
  it('does not claim or remove a volume when creation fails', () => {
    const result = probe('create')
    expect(result.status).not.toBe(0)
    expect(result.log).not.toContain('docker volume rm')
  })
  it('cleans its volume when starting the container fails', () => {
    const result = probe('run')
    expect(result.status).not.toBe(0)
    expect(result.log).toContain('docker volume rm intuneget-ci-')
    expect(result.log).not.toContain('docker rm --force')
  })
})

describe('release gates', () => {
  const jobs = parse(readFileSync('.github/workflows/release.yml', 'utf8')).jobs
  it('qualifies the old database upgrade with the actual candidate image before tagging', () => {
    const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8')).jobs
    const upgrade = ci.docker.steps.find((step: { name: string }) => step.name === 'Verify v0.7.1 SQLite upgrade and preserved completed job')
    expect(upgrade.run).toContain('ghcr.io/ugurkocde/intuneget:0.7.1')
    expect(upgrade.run).toContain('docker pull "$baseline"')
    expect(upgrade.run).toContain('bash scripts/ci/verify-docker-sqlite.sh intuneget:test "$baseline"')
  })
  it('verifies both native architectures before scanning and signing the exact digest', () => {
    expect(jobs.verify.strategy.matrix.include.map((row: { platform: string }) => row.platform)).toEqual(['linux/amd64', 'linux/arm64'])
    expect(jobs.secure.needs).toContain('verify')
    const scan = jobs.secure.steps.find((step: { name: string }) => step.name === 'Scan release image')
    expect(scan.with['image-ref']).toContain('@${{ needs.merge.outputs.digest }}')
    expect(scan.with['exit-code']).toBe('1')
    expect(jobs.secure.steps.at(-1).run).toContain('@${{ needs.merge.outputs.digest }}')
  })
  it('does not expose floating tags before successful verification and security', () => {
    const metadata = jobs.merge.steps.find((step: { id?: string }) => step.id === 'meta').with
    expect(metadata.flavor).toBe('latest=false')
    expect(metadata.tags).not.toMatch(/latest|major|minor/)
    expect(jobs.promote.needs).toContain('secure')
    expect(jobs.promote.if).toBe("needs.prepare.outputs.prerelease != 'true'")
    expect(jobs.promote.steps.at(-1).run).toContain('"$image@$RELEASE_DIGEST"')
  })
  it('allows publication only after security and either stable promotion or an explicitly skipped prerelease promotion', () => {
    expect(jobs['release-gates'].needs).toEqual(['prepare', 'merge', 'secure', 'promote'])
    expect(jobs['release-gates'].if).toContain("needs.secure.result == 'success'")
    expect(jobs['release-gates'].if).toContain("needs.prepare.outputs.prerelease == 'true' && needs.promote.result == 'skipped'")
    expect(jobs['release-gates'].permissions).toEqual({})
    expect(jobs['release-gates'].steps.at(-1).run).toContain('RELEASE_DIGEST=')
  })
  it('leaves release writes to the existing App path without adding workflow token permissions', () => {
    const workflow = parse(readFileSync('.github/workflows/release.yml', 'utf8'))
    expect(workflow.on).toEqual({ push: { tags: ['v*'] } })
    expect(jobs.prepare.permissions).toEqual({ contents: 'read' })
    const guard = jobs.prepare.steps.find((row: { run?: string }) => row.run?.includes('gh release view'))
    expect(guard.env).toEqual({ GH_TOKEN: '${{ github.token }}', TAG: '${{ github.ref_name }}' })
    for (const [name, job] of Object.entries(jobs) as [string, { permissions?: Record<string, string> }][]) {
      expect(job.permissions?.contents).not.toBe('write')
      if (job.permissions?.['id-token'] === 'write') expect(name).toBe('secure')
    }
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).not.toMatch(/gh release (?:create|edit|upload)\b/)
  })
  it('keeps release package versions and maintained release notes consistent', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    expect(pkg.version).toBe('0.8.6')
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
    expect(readFileSync(`release-notes/v${pkg.version}.md`, 'utf8')).toContain('SQLite automatic update detection')
  })
})

function releaseGuard(scenario: string, ref = 'refs/tags/v0.8.6', repository = 'ugurkocde/IntuneGet') {
  const workflow = parse(readFileSync('.github/workflows/release.yml', 'utf8'))
  const step = workflow.jobs.prepare.steps.find((row: { run?: string }) => row.run?.includes('gh release view'))
  const directory = mkdtempSync(join(tmpdir(), 'intuneget-release-probe-'))
  fixtures.push(directory)
  const log = join(directory, 'commands.log')
  writeFileSync(join(directory, 'gh'), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$MOCK_LOG"
[[ "$1 $2" == 'release view' ]] || { echo WRITE_ATTEMPT >&2; exit 99; }
case "$SCENARIO" in
  draft) echo true;;
  published) echo false;;
  missing) echo 'release not found' >&2; exit 1;;
  denied) echo 'HTTP 403: Forbidden' >&2; exit 1;;
  auth_not_found) echo 'release not found' >&2; exit 4;;
  mixed_not_found) printf 'HTTP 403: Forbidden\nrelease not found\n' >&2; exit 1;;
  generic_404) echo 'HTTP 404: Not Found' >&2; exit 1;;
  network) echo 'network unavailable' >&2; exit 1;;
  server) echo 'HTTP 503: Service Unavailable' >&2; exit 1;;
  limited) echo 'HTTP 429: Too Many Requests' >&2; exit 1;;
  malformed) echo null;;
  warning) echo true; echo 'unexpected warning' >&2;;
  extra_blank) printf 'true\n\n';;
  missing_extra_blank) printf 'release not found\n\n' >&2; exit 1;;
  missing_output) echo true; echo 'release not found' >&2; exit 1;;
esac
`)
  const guard = step.run
    .replaceAll('${{ steps.version.outputs.notes }}', 'synthetic-notes.md')
    .replaceAll('${{ steps.version.outputs.prerelease }}', 'false')
  writeFileSync(join(directory, 'guard.sh'), guard)
  const result = spawnSync(bash, ['-c', 'chmod +x "$MOCK_BIN/gh"; export PATH="$MOCK_BIN:$PATH"; bash "$MOCK_BIN/guard.sh"'], {
    encoding: 'utf8',
    env: { ...process.env, MOCK_BIN: shellPath(directory), MOCK_LOG: shellPath(log),
      RUNNER_TEMP: shellPath(directory), SCENARIO: scenario, GH_TOKEN: 'fixture-only',
      GITHUB_REF: ref, TAG: ref.replace(/^refs\/tags\//, ''), GITHUB_REPOSITORY: repository },
  })
  return { status: result.status, output: result.stdout + result.stderr,
    log: existsSync(log) ? readFileSync(log, 'utf8') : '' }
}

describe('published release guard', () => {
  it.each(['draft', 'missing'])('permits %s without a release write or repeated read', scenario => {
    const result = releaseGuard(scenario)
    expect(result.status, result.output).toBe(0)
    expect(result.log.trim().split('\n')).toHaveLength(1)
    expect(result.output).not.toContain('WRITE_ATTEMPT')
  })
  it('refuses to rebuild an already published release', () => {
    const result = releaseGuard('published')
    expect(result.status, result.output).not.toBe(0)
    expect(result.output).toContain('already published; refusing to rebuild')
    expect(result.output).not.toContain('WRITE_ATTEMPT')
  })
  it('stops on access errors without trying a release write', () => {
    const result = releaseGuard('denied')
    expect(result.status).not.toBe(0)
    expect(result.output).not.toContain('WRITE_ATTEMPT')
  })
  it.each(['auth_not_found', 'mixed_not_found', 'generic_404', 'network', 'server', 'limited', 'malformed', 'warning', 'extra_blank', 'missing_extra_blank', 'missing_output'])('fails closed on %s', scenario => {
    const result = releaseGuard(scenario)
    expect(result.status, result.output).not.toBe(0)
    expect(result.output).not.toContain('WRITE_ATTEMPT')
  })
  it.each([
    ['refs/heads/main', 'ugurkocde/IntuneGet'],
    ['refs/tags/v0.8.6;echo unexpected', 'ugurkocde/IntuneGet'],
    ['refs/tags/v0.8.6', 'example/Other'],
  ])('rejects unbound repository or tag before the read', (ref, repository) => {
    const result = releaseGuard('draft', ref, repository)
    expect(result.status, result.output).not.toBe(0)
    expect(result.log).toBe('')
  })
})
