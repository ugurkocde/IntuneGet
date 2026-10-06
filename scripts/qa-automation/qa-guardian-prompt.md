Use the `intuneget-qa` skill and operate one production IntuneGet QA guardian cycle autonomously.

Objective

- Continue the active 500-app cohort whose immutable boundary is `2026-08-30T08:28:35Z`.
- The cohort is complete only when 500 distinct eligible WinGet IDs that had no strict pass at or before that boundary have a later strict `psadt-package` pass.
- Do not require a human to type "proceed". Take every safe in-scope action needed during this cycle.

Required first actions

1. Read the complete `intuneget-qa` SKILL.md and every reference it marks required.
2. Obtain fresh production state by running the following from the dirty-but-read-only linked website checkout. Do not edit or reset that checkout:

   `vercel.cmd env run -e production -- node ..\\.codex-qa-guardian\\qa-status.mjs`

3. Read production database evidence first. Inspect the exact GitHub run only when evidence is stale, missing, or failed; never repeatedly poll a healthy run with `gh`. Cache the run/job response during diagnosis and respect `Retry-After` and `X-RateLimit-Reset`. Use production Supabase project `mbhajocqtogfbgojkwhd` only through the existing production environment/scripts or supported connected tools.

Operating rules

- Run exactly one `psadt-package` lifecycle in the clean Hyper-V VM at a time.
- If one lifecycle is active and healthy, audit its phase and bounded sanitized evidence, then finish this guardian cycle without starting another lifecycle. The recurring task will check again.
- If there is no active lifecycle, production is enabled, and candidates are queued, invoke the authenticated production dispatch endpoint with `.codex-qa-cron.mjs`.
- If the queue is empty or low and the cohort is incomplete, invoke the authenticated production enqueue endpoint. A clear queue is not a reason to stop scanning for new or untested catalog versions.
- Use only the authoritative cohort object returned by qa-status.mjs (/api/qa/cohort). Its versioned policy counts distinct customer-deployed IDs with outcome `Passed`, tuple `0/0/0/1`, exact installer/profile hashes, a matching run, PSADT mode, LocalSystem, and a clean VirusTotal `0/0` verdict. It uses the shared approved release history and per-profile compatibility checks, so unrelated packager fixes preserve prior qualifying coverage. The separate currentPinCount is diagnostic and must never replace strictCount. Do not invent a status-only count or reset the cohort after a pin promotion.
- Failed, excluded, superseded, unavailable, quarantined, or security-blocked candidates never count toward 500.
- Security findings remain quarantined. Never weaken hash, signature, VirusTotal, pin, tenant-secrecy, managed-uninstall, or fail-closed controls.
- Never access or enumerate the self-hosted runner working directory. Service metadata is allowed. Never download or execute an installer on the host.

Failure repair contract

- An application failure never stops the queue. A `failed` lifecycle creates a row in `qa_repair_requests`; the global pipeline stays enabled and other candidates keep running while you repair. Never pause `qa_pipeline_control` because one application failed. Pausing is reserved for infrastructure faults (runner, host, publication, pin mismatch) and must be resumed as soon as that fault is healthy.
- Work the oldest `pending` repair request. Set it to `in_progress` first, then resolve it with exactly one outcome:
  - `requeued`: a shared fix shipped (or the failure was transient), and the exact app/version/architecture is queued again via authenticated targeted enqueue.
  - `blocked`: only when you confirmed the root cause from evidence and it cannot be fixed safely in shared packaging (for example the vendor installer requires interaction, needs hardware, or its download is retired). The `resolution` must start with `Confirmed root cause: ` followed by the evidence, in words customers can read. The database rejects any other manual block.
  - `resolved`: a newer release or profile already superseded it.
- An unconfirmed root cause means the repair is not finished. Keep the request `in_progress`, gather more evidence, and retest the exact tuple through targeted enqueue (each retest counts toward the three re-queue budget, after which the next failure blocks automatically). A payload quarantine may protect customers while you repair, but it never closes the request; lift it when the fixed payload passes.
- Rows created as `blocked` (security verdicts, or three earlier re-queues for the same app and architecture) are final. Never retry them.
- Diagnose from bounded, sanitized candidate telemetry, compact result JSON, GitHub job steps/logs, and official vendor/WinGet metadata. Do not expose customer configuration or secrets.
- Prefer a deterministic, reviewed shared adapter or packager fix. A real fix must benefit both production QA and customer packages created from the IntuneGet web portal/catalog.
- Work only in newly created clean git worktrees. Preserve the user's dirty linked website checkout and unrelated worktrees.
- Add focused regression coverage for the adapter, normalized QA profile, and customer GitHub Actions payload where applicable. Run focused tests, full tests, lint, and production build in proportion to the change.
- Merge through protected pull requests. Wait for required CI. Deploy production, update the guarded packager pin, and supersede only safe undispatched old-pin rows. A pin promotion is the only repair step that may briefly pause dispatch; resume as soon as the required pin equals the fresh scheduler pin.
- Retest the exact failing app/version/architecture through the normal queue, then mark the repair request `requeued`. Do not hold the general queue for that retest.

Completion and reporting

- When the authoritative strict count first reaches 500, write a small JSON milestone record to `C:\\Users\\ugur\\Desktop\\Github\\IntuneGet-FrontBackend\\.codex-qa-guardian\\cohort-20260830-complete.json` with boundary, count, UTC timestamp, and latest strict finish. This is a reporting milestone only: never disable the supervisor, and keep packaging new eligible applications and updates indefinitely.
- Keep the final message concise: strict count, active app/run and phase, action taken, any shipped production fix/pin, and genuine blocker. A healthy active run is progress, not a blocker.
- Do not claim that the 500-app milestone is complete before the strict count is 500. The continuous QA service itself never completes.
