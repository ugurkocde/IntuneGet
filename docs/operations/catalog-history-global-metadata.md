# Global release history metadata

The unfiltered global V2 branch previously computed monthly totals and app counts separately. The migration combines these aggregates over the same visible rows. Page ordering, predecessor lookups, filtered branches, security invoker, owner, ACL and search path remain unchanged. No timeout, client retry, route or cache policy changes.

Production logs identify V2 query ID -2836520029497238010 for 29 SQL57014 cancellations in 00..03UTC25Nov. Eleven of twelve application error envelopes share a cancellation minute. This is not request-level correlation. Cumulative mean312.926ms/max7994.511ms are not hourly timings. The production timeout cause remains unproved.

A disposable PG17 model at78069 history rows/16629 catalog rows/16551 visible apps reduces complete history scans from two to one and preserves JSON for five page cases. This is measured work reduction, not a reproduced production8s failure. CI keeps the ordered/filter parity, security snapshot and eight-session bounds.

Activation is separate from source merge and requires normal exact operational review and fresh live body/owner/ACL/config preflight. The migration accepts only the exact LF or CRLF predecessor and replacement bodies. A same-value COST 100 alteration obtains the function catalog row lock before reading the source guard, without requiring catalog UPDATE rights. The guard rejects STRICT drift; the replacement preserves the predecessor's normal NULL-input behavior. Capture pg_get_functiondef before activation. Roll back using that exact captured definition in a transaction after a fresh expected-body guard; compare owner, ACL, config, invoker, language, volatility and NULL-input behavior afterwards. Do not replay the selector or reset acceptance. Production effect requires the normal passive history/error comparisons; prior failures and missed finishes remain.

The disposable PG17 contract prints executed plan nodes but gates work using sequential tuples read plus index tuples read, including index-only scans. The candidate must stay within the live history row count plus 500 tuples for page and predecessor probes; the predecessor must exceed it. This avoids mistaking a complete indexed pass for zero scans. Existing parity, ACL, per-app plan, rollback and eight-session timing bounds remain in force. Two concurrent owner sessions verify that function DDL waits or fails safely on either side of activation.

## Deep global pages

The deep page migration replaces both the V2 global branch and the service only rows RPC. One aggregate collects visible timestamps and, for V2, integer catalog app IDs without sorting or materializing history tuples. A separate single column timestamp sort supplies page bounds. V2 counts distinct app IDs and groups the existing formatted month strings, preserving month ordering, infinity and wide year semantics. Both paths assemble the page from the bounded timestamp range and select forty IDs before primary key row reads and predecessor lookups. Filtered and app branches remain unchanged.

Pages through 100 retain the predecessor query and its shallow indexed reads. Deep branches use no OFFSET. Timestamp ties are ranked by timestamp and ID within the selected range. Range work therefore includes the boundary tie groups; a large batch with one timestamp remains a capacity risk. Full timestamp aggregation still scales with catalog size. Arrays remain internal, and the 10000 page cap stays unchanged.

The disposable PG17 regression uses 95013 visible rows and the ordered production index. The predecessor fails skipped row assertions, while the preceding deep candidate fails the new temporary I/O assertion in both RPCs at pages 1324 and 1911. At work_mem 3500kB the replacement must preserve full JSON, metadata, edge pages, filters, function security and shallow tuple work, without temporary blocks in executed deep plans. It also exercises 20000 tied timestamps, locale and orphan exclusions, infinity and wide year metadata, and eight concurrent replacement calls. Local collation and cache state are not production capacity evidence; larger catalogs can exhaust sort memory again. The migration runner must wrap the file in one transaction. Preserve both definitions and security snapshots for guarded rollback.


Source merge and SQL activation are separate. Retain every failed production probe and compare real page one and deep page behavior before activation. A successful local plan does not establish production capacity. After activation measure complete UTC hours of deep page history errors; two full hours with zero are required. Small page history errors remain a separate acceptance item and do not disappear from the incident record.

The independent 500 ms production design gate is FAILED. Retained full V2 candidate probes took 743.984 to 7605.698 ms; candidate page one took 1007.556 ms against a 669.641 ms current function baseline. The 241.81 ms narrow ID probe omits V2 metadata and is not a passing end to end result. The final source keeps pages through 100 on the predecessor query. Neither source review nor green CI authorizes activation or establishes recovery. Keep activation blocked until the complete operational gate passes, and publish the public fixed announcement only after activation and acceptance.


## Recorded release decision and guarded rollback

The 2026-11-25 Root-authorized baseline decision supersedes the agent-chosen absolute 500 ms design ceiling as a release veto. All earlier first-sample and page-one failures remain recorded above. Those measurements describe preceding candidates, not production capacity of the final source. The release contract is full JSON and security parity, unchanged shallow pages 1 through 100, and improvement of the deep path against the current eight-second customer failure. Latest-source production timings, API settings and raw tie sizes remain unverified. Standing Full automation permits post-merge natural verification with immediate guarded rollback on demonstrated regression. There is no cold claim or replacement absolute threshold. Two complete UTC hours with zero deep errors begin only after actual activation; shallow failures are tracked separately.

Before activation capture both function definitions and their owner, ACL, config, language, volatility, strictness and signature. Apply the reviewed migration inside one transaction. A rollback must use one transaction and acquire both function catalog locks in activation order: V2 first, then global rows, using the existing same-value COST 100 alterations. After both locks are held, check both expected replacement body hashes and the full captured security metadata before restoring either definition. Abort on any lock failure or mismatch. Restore both exact captured definitions, including their statement terminators, verify both predecessor hashes and security snapshots, then notify PostgREST and commit. Keep the activation and rollback migration ledger entries for audit. If an apply response is ambiguous, read both function states and the ledger before any retry.

## Transactionally invalidated metadata and bounds

Global history requests reuse exact metadata and page boundaries when the source
tables are unchanged and PostgreSQL reports that RLS is inactive for the invoker.
An absent, invalidated or physically outdated cache uses the preceding live SQL.
Filtered requests retain their existing implementation. Anonymous and authenticated
callers subject to RLS always use the live query, including permissive policies.
The public response shape, page clamp, ordering and history coverage are unchanged.

The private `catalog_internal` schema must not be exposed through the Data API.
Its metadata and boundaries use forced RLS. Restricted writers may see only the
opaque invalidation marker for their own transaction, which is needed for trigger
deduplication; they cannot see other writers' markers or unrestricted metadata.
Do not manually truncate or modify the private cache tables.

## Activation

1. Retain a reviewed rollback packet containing `pg_get_functiondef` and the owner,
   ACL, language, volatility, strictness and configuration of both existing RPCs.
   Verify the exact predecessor body guards in the migration against the active
   database before applying it. Use the established authenticated migration path.
2. Apply `20261126220806_catalog_history_metadata_bounds_cache.sql` in its own
   transaction outside the hourly and daily catalog write windows. Its one second
   lock timeout bounds trigger installation. Do not put the initial refresh in
   that transaction: trigger DDL holds a stronger source lock until commit.
3. After DDL commits, call `public.refresh_catalog_release_history_cache()` in a
   separate read committed transaction with the existing authorized server role.
   Empty metadata remains a safe live fallback before this completes.
4. Verify source attributes and grants, exact response parity, invalidation and
   the deployed writer refresh paths. Preserve the existing natural production
   acceptance windows and caller throughput evidence. A cache hit or local timing
   result alone does not prove that the production no headers timeout is fixed.

The refresh function rejects stronger isolation levels, takes a nonblocking refresh
advisory lock and source access share locks, and captures the data, build snapshot
and both physical table paths in one statement. An older snapshot spanning a
truncate or heap rewrite falls back. Triggerless rewrites are repaired by the next
refresh. Index-only rewrites do not invalidate unchanged history data.

Hourly package sync and both daily catalog writers request refresh after writing.
Their five second client deadline and fixed warning preserve original sync results
when refresh is unavailable. Such a failure is not cache acceptance: subsequent
history calls remain on exact live SQL until refresh succeeds. Record attempted
and completed refreshes separately for each writer when validating deployment.

## Rollback

Restore both exact predecessor function definitions from the reviewed rollback
packet through the normal reviewed rollback path. Recheck their original security
attributes and live response parity. Do not replay the entire predecessor migration:
its source guards target a different predecessor body.

After restoring the RPCs, remove the four `history_cache_structure` and
`history_cache_identity` triggers on the two source tables, the public refresh
function, and the private cache functions/tables/schema in dependency order. Use
explicit object names and no `CASCADE`. Preserve all catalog rows. The disposable
Postgres contracts exercise this rollback and the unchanged RPC ACLs.

If writer refresh code remains deployed briefly after SQL rollback, its missing RPC
warning is nonfatal. Remove that wiring through the same reviewed source rollback.
