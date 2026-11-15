# Optional QA backfill budget

The existing enqueue cron runs optional demand, toolchain and idle backfill in that order. Demand and idle pages contain at most five apps; toolchain pages contain at most 25. Queue selection order and all security checks are unchanged.

Each optional call has a 2.5 second client wait budget. On a timeout, the existing poll error is retained, remaining optional lanes are skipped, and the next scheduled tick skips optional backfill once. Changed package discovery and targeted recovery continue normally. The skip flag is stored in the existing qa_automation_state table. A failed flag read skips optional work and records a system error.

The migration sets a two second statement_timeout on each optional RPC. PostgREST versions that hoist function settings apply this before starting the request statement. A direct SQL call does not enforce a timeout set inside its already running statement. Production hoisting is unverified until passive timing evidence confirms it. Client abort does not prove database cancellation.

The disposable PG17 contract checks both timeout semantics, unchanged function bodies, grants and security attributes, and a concurrent synthetic app detail data read. This does not reproduce production pool contention. Production acceptance still requires two error ticks without follow on 504 rows and the existing full hour recovery criteria.
