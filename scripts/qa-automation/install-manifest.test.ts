import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Install-GuardianUpdate.ps1 copies a fixed file list into the live guardian.
// Every listed file must exist here, or a guardian update fails mid-install.
describe('guardian install manifest', () => {
  const installer = readFileSync(new URL('./Install-GuardianUpdate.ps1', import.meta.url), 'utf8')
  const list = installer.match(/\$files = @\(([\s\S]*?)\)/)?.[1] ?? ''
  const files = [...list.matchAll(/'([^']+)'/g)].map(match => match[1])

  it('lists the guardian files', () => {
    expect(files).toContain('qa-control.mjs')
    expect(files).toContain('Invoke-IntuneGetQaSupervisor.ps1')
  })

  it.each(files)('ships %s', file => {
    expect(existsSync(new URL(`./${file}`, import.meta.url))).toBe(true)
  })
})
