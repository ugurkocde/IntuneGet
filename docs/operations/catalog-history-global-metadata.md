# Global release history metadata

The unfiltered global V2 branch previously computed monthly totals and app counts separately. The migration combines these aggregates over the same visible rows. Page ordering, predecessor lookups, filtered branches, security invoker, owner, ACL and search path remain unchanged. No timeout, client retry, route or cache policy changes.

Production logs identify V2 query ID -2836520029497238010 for 29 SQL57014 cancellations in 00..03UTC25Nov. Eleven of twelve application error envelopes share a cancellation minute. This is not request-level correlation. Cumulative mean312.926ms/max7994.511ms are not hourly timings. The production timeout cause remains unproved.

A disposable PG17 model at78069 history rows/16629 catalog rows/16551 visible apps reduces complete history scans from two to one and preserves JSON for five page cases. This is measured work reduction, not a reproduced production8s failure. CI keeps the ordered/filter parity, security snapshot and eight-session bounds.

Activation is separate from source merge and requires normal exact operational review and fresh live body/owner/ACL/config preflight. Apply the exact committed LF Git blob, not a CRLF checkout. Capture pg_get_functiondef before activation. Roll back using that exact captured definition in a transaction after a fresh expected-body guard; compare owner, ACL, config, invoker, language and volatility afterwards. Do not replay the selector or reset acceptance. Production effect requires the normal passive history/error comparisons; prior failures and missed finishes remain.
