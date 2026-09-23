# QA automation reliability

These are the version-controlled sources for the existing Windows guardian.
Install them into the workspace's `.codex-qa-guardian` directory with
`Install-GuardianUpdate.ps1 -Destination <absolute-existing-directory>` after
the migration and website deployment. The installer serializes with the
controller, verifies file hashes, and retains the prior files for rollback.
The existing two-minute guardian and independent memory-watchdog tasks remain
responsible for scheduling. No interactive agent session needs to stay open.

## Recovery

The controller checks the production database first. When idle, it reviews
recent infrastructure errors (28 days, at most 100 due records per cycle).
Security findings and compatibility blocks remain ineligible. A completed VM
run with a failed publisher replays only that publishing job after GitHub
confirms the protected workflow identity. A database compare-and-set and the
single-active index prevent concurrent recovery. A lost POST response retains
the active lease until normal reconciliation checks GitHub.

Other recoverable infrastructure failures return through normal queue
validation; obsolete profiles go through authenticated targeted enqueue.
Five recovery attempts use 5-minute, 15-minute, 1-hour, 6-hour, and 24-hour
cooldowns before escalating to the repair task. Prior run IDs and summaries
remain in bounded private recovery history. GitHub rate-limit reset timestamps
survive process restarts. Known dependency outages use increasing health-check
intervals (up to 15 minutes, or GitHub's explicit reset), without launching
repair agents that cannot fix the upstream service.

Unavailable installer sources use a separate, exact-source cooldown: 30
minutes doubling to 24 hours. It survives a packager/profile change and records
an attempt once. Successful verification clears that cooldown. Hash mismatch
and other deterministic integrity failures retain their existing quarantine.

## Cohort policy, version 2

`/api/qa/cohort`, protected by `CRON_SECRET`, is the authoritative audit used by
both `qa-status.mjs` and `scripts/qa-strict-cohort-audit.mjs`. The immutable
boundary is 2026-08-30T08:28:35Z; the target is 500 distinct customer-deployed
apps without a strict historical pass. Full evidence must match the installer,
canonical profile hash, execution run, four lifecycle exits, LocalSystem, and
a clean VirusTotal verdict. Shared approved release history and per-profile
compatibility rules preserve unaffected passes across packager releases.
`currentPinCount` is separately reported and does not reset cohort progress.
Eligibility blocks and changed behavior can still invalidate affected passes.
This policy is a deliberate correction to the former exact-current-pin count.
The historical exclusion is conservative: a pre-boundary PSADT pass record
excludes an app even if a later result replaced its old detailed evidence. It
cannot grant new credit. Run identity accepts the exact protected-repository
run URL used by older publishers, as well as a matching explicit run ID.

## Scanning and repair sessions

Historical scans read at most two pages of 100 latest demanded-app profiles.
The durable cursor and pending IDs continue across polls. Background scan
errors are recorded independently so discovered updates can still enqueue.
The repair wrapper records the child PID, structured-event heartbeat, exit
cause, thread ID, and completion status atomically. Exit zero without a
completed turn and final report is incomplete. A retry receives prior log and
worktree context and is instructed to resume saved work. The deterministic
controller, not the agent's final text, decides whether production recovered.

Validate with the focused Vitest suites, PowerShell parsing, full tests, type
checking, lint, a production build, and authenticated dry-run/live cycles.
