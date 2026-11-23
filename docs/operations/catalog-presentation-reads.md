# Concurrent catalog presentation reads

The Supabase catalog source shares only pending `getAppByWingetId` reads made
with `presentationOnly: true`, for an exact app ID on the same source instance.
React cache still deduplicates metadata/page work within a render. This source
coalescing additionally reduces duplicate reads across concurrent renders on
that instance. It is not fleet-wide coordination or a new settled-result cache.

Only requests joining within the first second of a read share it. A later
request starts independently, so an old stalled request does not hold later
requests indefinitely. This does not cancel or retry any request, change the
SQL query, or alter its timeout. At most 64 pending keys are tracked. Overflow
bypasses sharing, preserving the ordinary read rather than rejecting it.
Completion or rejection removes only the matching pending entry; an older
completion cannot remove a newer read for the same app. Missing results are
also removed and are never cached by this mechanism.

Full-detail reads, locale lookups, packaging inputs, QA/security admission,
history callbacks and their cache keys, role selection, and Next result cache
semantics stay unchanged. Keys are case sensitive, matching the existing read.

The regression uses 22 simultaneous callers waiting for upstream responses:
old code dispatches 44 reads, while coalescing dispatches two. Additional tests
cover expiration, completion ordering, independent identities/source instances,
noncached missing/completed results, full-detail reads, and bounded overflow.
This proves the local duplicate-work mitigation, not the production stall's
database, pool or network cause. It helps only overlapping same-key calls on
the same instance; it does not guarantee fewer calls across different instances.

After deployment, measure natural HTTP 503/504 envelopes for six full hours,
with no burst of five or more rows in any rolling two-minute window. Record
gaps and deployment boundaries. Preserve existing mitigation windows separately
and do not attribute recovery from health HTTP 200 responses. Roll back through
the ordinary reviewed App path if the change qualifies as a regression. No
production workload or customer replay is part of verification.
