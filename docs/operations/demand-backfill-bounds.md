# Optional demand backfill bounds

`qa_missing_demand_backfill_ids(integer)` is optional cron work. It uses the
existing eligibility, security exclusions, queue ordering and limit clamp.
Customer package dispatch and QA runtime admission are separate paths.

The function takes nonblocking transaction advisory lock `(1849, 1)` before
querying demand. A concurrent transaction holding that lock makes the call
return no rows. The caller treats this as an empty optional lane, without
changing its error classes or next-tick skip behavior. The lock is released by
transaction commit, rollback or statement failure. Repeated calls in one
transaction can reacquire their own lock; this is not a cross-tick lease.

The function setting is `statement_timeout=2s`, below the caller's 2500 ms
budget. PostgREST must hoist this setting before executing the request
statement. PostgreSQL does not arm a shorter timer when it encounters a
function-level setting during an already running statement. The real PG17
contract therefore models a separate pre-request configuration statement and
does not claim to prove live PostgREST behavior. Pool or network time before
the server starts the request remains outside that statement timer.

The migration preserves the owner, ACL and `SECURITY DEFINER` setting and pins
the previous function body and supported starting configurations. The wrapper
is `VOLATILE` because acquiring an advisory lock changes transaction state.
It performs no table writes. No role is granted new access.

## Validation and deployment

The lock holder waits for the probe to finish before releasing its transaction;
a separate 15 second timeout bounds failed fixture cleanup.
The existing demand PG17 contract checks actual overlapping sessions, ordered
result parity, denied anonymous/authenticated access, unchanged ACL and owner,
the hoisted deadline against a held table lock, serviceability after the
failed session closes, and an equivalent restored state. Transaction lock
release follows PostgreSQL's transaction semantics; the fixture does not
prove release within the same session after failure. Old code returns work
during overlap and can run past the
client budget under the configured eight-second API baseline. These are
behavior regressions, not a reproduction of the production stall's cause.

Apply only through the normal reviewed migration/deployment path. Do not
activate SQL, replay customer work or generate production load for a test.
Passive acceptance after deployment is six full hours with zero bursts of
five or more HTTP 503/504 rows within two minutes and at most one demand-lane
timeout per hour. Separate client aborts, SQLSTATE 57014 and other errors.
Retain previous failed windows. Mitigation is not evidence of recovery.

## Rollback

Restore the previous SQL function definition from the guarded
`20261115144200_qa_demand_failure_key_scope.sql` definition block, preserving
the deployment's prechange `proacl`, owner and exact `proconfig` snapshot.
Do not run that migration's old-source guard against the new body. Confirm
the restored body MD5 is `e358c88ca1ad6f6fcd0ee5d51b96840b`, the original
volatility is `STABLE`, the ACL/owner are unchanged, and the original timeout
state is restored. Notify PostgREST to reload its schema. The PG17 fixture
replays historical migrations and reapplies the optional timeout to check an
equivalent restored state. It does not validate the production definition-only
rollback procedure above. Deployment must retain its own starting snapshot.
No data rollback is required.
# Eligible demand priority work

`20261123204151_qa_demand_eligible_priority_scope.sql` materializes the eligible
deployed keys before calculating auto update and failure priorities. The early
filter is a copy of the existing final predicates; the final predicates, order,
limit clamp, advisory overlap skip and 2 s statement timeout remain in place.
No caller, security exclusion, index, owner or grant changes are included.

The production snapshot used to size the regression had 1,412 deployed keys,
52 eligible keys and 289 demanded current failure groups. These are current
counts, not reconstructed eligibility counts for historical failed calls.
Production statement timeouts are the timing RED. The fixture separately
demonstrates unnecessary priority work on already covered keys and checks
ordered parity, denied roles, configuration, owner, rollback and eight callers.
A fast OLD fixture must not be described as reproducing the production timeout.

The exact slow execution or waiting phase remains unproved. This change removes
avoidable work; production effect requires natural caller acceptance. Require
six consecutive qa-enqueue slots without the demanded-app selection error and
positive queue progress whenever eligible demand exists. Distinguish intentional
skip ticks from successful selections. Preserve earlier failed windows and the
separate six-hour burst acceptance criterion.

Rollback restores the exact preceding function definition from
`20261123143806_qa_demand_timeout_overlap.sql`, retaining its owner, ACL,
VOLATILE mode, overlap lock and 2 s configuration. Restore only the function
definition, not earlier grant or unrelated migration statements, and verify the
preceding body MD5 `453e81d15e8cfa87dfcecf8e00f76af1` plus ACL and owner.
## Cron-only selection budget

The cron uses `qa_cron_demand_backfill_ids`, an additive service-role-only RPC
whose body matches the active eligible-priority selector. Its server bound is
8 s and the demand lane's client/race bound is 9 s. The original RPC retains
its 2 s setting; other optional lane and checkpoint limits remain 2.5 s.
Both functions use the same nonblocking transaction advisory lock `(1849,1)`.
This admits at most one selector across the two names. There is no retry or
parallel selection, and the existing five-row limit and skip-next behavior stay.

The migration fails closed unless the old body is
`e13e0a07df117bd78f37ee037e497253`, its settings and attributes match, and the
migration role owns it. It creates the new function without replacement,
revokes PUBLIC/anon/authenticated defaults, and grants only service_role.
Postconditions verify identical bodies and owners, new 8 s configuration,
denied anonymous/authenticated execution, and unchanged old body/config/ACL.

The real PG17 contract uses `work_mem=3500kB` and models PostgREST timeout
hoisting with a separate settings statement before the call. A local 3 s
relation-lock hold makes OLD return SQL57014 at 2 s while the cron function
completes after release. A 9 s hold verifies its finite 8 s cancellation.
This models a cutoff overrun; it does not establish production lock contention.

After exact source review, CI, CodeRabbit and coordination qualify, obtain the
normal operational review for the immutable migration. Apply and verify the
additive function before merging/deploying the caller, send schema reload and
observe available reload evidence. The first natural cron slot establishes
functional reachability; do not invoke the selector or replay work to prove it.
Report any cache/reachability gap honestly. No role, project or credential settings change.

Rollback reverts the caller first. Remove the dedicated RPC only in a later
reviewed cleanup migration after no caller uses it. Keep the old RPC and its
2 s settings unchanged throughout.

Acceptance requires six consecutive attempted demand slots without SQL57014,
at least one actual demand-key job queued when eligible demand exists, and zero
five-row multi-route503/504 bursts within two minutes in the same window.
Changed-feed jobs, skipped ticks, zero-row overlap skips and health200 do not
establish demand recovery. Preserve all older failed windows and misses.
