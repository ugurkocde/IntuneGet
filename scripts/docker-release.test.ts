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
    expect(result.code).toContain('db.pragma("user_version", {simple:true}) !== 5')
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
    expect(jobs.publish.needs).toContain('promote')
    expect(jobs.publish.if).toContain("needs.secure.result == 'success'")
    expect(jobs.publish.if).toContain("needs.prepare.outputs.prerelease == 'true' && needs.promote.result == 'skipped'")
  })
  it('keeps candidate package versions and maintained release notes consistent', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
    expect(pkg.version).toBe('0.8.0-rc.1')
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages[''].version).toBe(pkg.version)
    expect(readFileSync(`release-notes/v${pkg.version}.md`, 'utf8')).toContain('Windows Docker Desktop confirmation')
  })
})
