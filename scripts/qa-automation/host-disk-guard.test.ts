import { describe, expect, it } from 'vitest'
import {
  decideDiskAction, diskGuardActor, diskPauseBelowGb, diskResumeAtGb, lowDiskReason, parseHostFreeGb,
} from './host-disk-guard.mjs'

const running = { paused: false, updated_by: 'qa-supervisor-security-quarantine' }
const ownPause = { paused: true, updated_by: diskGuardActor }
const otherPause = { paused: true, updated_by: 'qa-execution-watchdog' }

describe('host disk guard', () => {
  it('pauses a running pipeline below the threshold', () => {
    expect(decideDiskAction({ freeGb: diskPauseBelowGb - 1, control: running })).toBe('pause')
    expect(decideDiskAction({ freeGb: diskPauseBelowGb, control: running })).toBe('none')
  })

  it('holds its own pause until the resume threshold, then resumes', () => {
    expect(decideDiskAction({ freeGb: diskResumeAtGb - 1, control: ownPause })).toBe('hold')
    expect(decideDiskAction({ freeGb: diskResumeAtGb, control: ownPause })).toBe('resume')
  })

  it('never touches a pause set by something else', () => {
    expect(decideDiskAction({ freeGb: 10, control: otherPause })).toBe('none')
    expect(decideDiskAction({ freeGb: 500, control: otherPause })).toBe('none')
  })

  it('does nothing without a measurement', () => {
    expect(decideDiskAction({ freeGb: null, control: running })).toBe('none')
    expect(decideDiskAction({ freeGb: Number.NaN, control: ownPause })).toBe('none')
  })

  it('parses the supervisor argument', () => {
    expect(parseHostFreeGb(['node', 'qa-control.mjs', '--host-free-gb', '408'])).toBe(408)
    expect(parseHostFreeGb(['node', 'qa-control.mjs', '--host-free-gb', 'abc'])).toBeNull()
    expect(parseHostFreeGb(['node', 'qa-control.mjs'])).toBeNull()
  })

  it('explains the pause and its automatic resume', () => {
    expect(lowDiskReason(42)).toContain('42 GB free')
    expect(lowDiskReason(42)).toContain(`${diskResumeAtGb} GB`)
  })
})
