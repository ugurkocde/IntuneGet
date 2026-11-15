# Catalog release history

The public page is `/apps/releases`. The catalog source supports Supabase and self-hosted SQLite snapshots. Results are cached for five minutes and paginated in groups of 40. Search is literal, case insensitive, and limited to 120 characters. Month boundaries are UTC.

`version_history.created_at` is the first time IntuneGet recorded that version, not the publisher release date. A database trigger preserves it across upserts. The earliest stored version for each app is labelled **First tracked**; subsequent observations show the previous and new versions, including rollbacks. Historical imports and missed versions prevent this from being a complete publisher archive. Locale variants are excluded from the feed and totals.

Publisher dates come only from a valid WinGet `ReleaseDate` on the manifest or an installer. Existing dates are not inferred from import or fetch timestamps. Older SQLite snapshots remain readable with unknown publisher dates.

The catalog index import now runs daily at 00:00 UTC, before manifest sync at 02:00 UTC. Scheduled manifest sync uses incremental mode and skips stored versions with descriptions before network requests. It reads public raw manifests; other manifest-client callers retain their existing authenticated API preference. Use the manual **all** mode or **force_refresh** to refresh unchanged manifests, including collecting newly available publisher dates.

`curated_sync_status.last_successful_sync_at` is recorded only after a full-catalog run completes without operational errors. Known missing upstream packages still produce a partial status. Targeted, limited, and new-only runs do not advance this timestamp. Later failed runs preserve the previous successful timestamp. No success timestamp is backfilled from historical workflow completion dates.

Apply migration `20260906052337_catalog_release_history.sql` before deploying the new workflow and page. `supabase/tests/catalog_release_history.sql` tests anonymous reads, month filtering, previous versions, pagination, and timestamp preservation inside a rolled-back transaction.

The installation scanner is independent of release history. It now installs the exact requested WinGet version and preserves that version as its snapshot key; registry display versions stay in registry metadata. Cleanup failures remain failures, with command output retained for diagnosis. Publisher download failures and installers that cannot silently uninstall require app-specific investigation; this page does not claim installation validation.

## Sync status and installation scans

A `partial` manifest sync means the check finished with unavailable upstream
manifests, not an operational failure. The release page shows a quiet Last checked timestamp for both completed outcomes, retains existing records, and reserves a visible status message for running or failed syncs. Timestamps use UTC. The next scheduled manifest sync retries unavailable records.

Installation scanning is independent of version-history ingestion. The scanner
retries only WinGet error `-1978335146` (installer prohibits elevation) using a
temporary standard Windows user. The entire scan, including
HKCU snapshots and cleanup, runs in that context. The account is removed afterward.
If that context cannot be prepared, the scan still fails and preserves the reason. Crashes, timeouts and partially completed installs are not
retried automatically. Failed scans preserve verbose WinGet diagnostic logs as
separate artifacts for seven days; they are never reported as successful metadata.

## Vendor links and hash reputation

Release History displays the official `ReleaseNotesUrl` from the exact WinGet locale manifest, with no inline release-note body. Manifest sync saves this URL for new records. **Backfill Release Note Links** checks up to 200 older records hourly, newest first. Manual dispatch accepts 1-1000 versions. Missing vendor URLs remain absent; operational errors stay eligible for retry.

VirusTotal evidence lives in the public `catalog_file_reputation` table, keyed by the exact installer SHA-256. Release history and RSS only read cached reports. They never enqueue hashes or call the VirusTotal API. When cached findings are unavailable, the page shows **View on VirusTotal**, linking to the exact hash without implying that a report exists or a scan is running. Older records keep cached findings and their original analysis dates.

Catalog-wide background lookups are retired: the scheduled worker is removed, the manifest enqueue trigger is dropped, and the old request/claim RPCs remain inert for compatibility with older deployments. Existing reports are preserved. Installation QA and its exact-hash cache write-through are separate and remain unchanged. Restoring bulk lookups requires an explicit implementation and appropriately licensed API capacity.

Findings include malicious and suspicious counts and the original analysis date. Pending, missing, and unavailable cache records use the direct-link fallback and never appear as zero detections. QA writes populate the cache, and QA reads reuse fresh cached findings before their direct API fallback. This evidence describes the selected WinGet installer file, not every installer architecture or an already installed application on a device.

Snapshots include vendor URLs and cached reports. Older snapshots can reuse legacy QA findings by hash. Apply `retire_catalog_reputation_queue` to disable catalog enqueueing and make older workers stop without consuming API quota. QA installation checks remain independent.


## Release exploration and RSS

Apply `20260911120000_release_history_filters.sql` before deploying the website changes that use `get_catalog_release_history_v2`. The original RPC remains available for older clients. The new function uses invoker permissions and the existing table access rules. No existing records or scan results are modified by this migration.

`/apps/releases?app=Example.App` selects an exact, case-insensitive WinGet ID. The history remains paginated at 40 records. Search, month, first-tracked/update classification, inclusive `from`/`to` UTC recorded dates, and installer `architecture` filters apply before counts and pagination. Previous-version relationships are computed before filtering, preserving predecessors outside the selected dates or architecture. Architecture matches available manifest installers, and the scan summary selects the matching installer hash without borrowing another variant's findings. Detailed panels link each available hash directly to its own VirusTotal report; these links do not imply a cached report exists. Existing 72-hour background lookup eligibility is unchanged.

`/apps/releases/feed` returns RSS 2.0 with the latest 40 recorded versions; `?app=Example.App` limits it to that application. RSS item identity is stable per app/version, and publication dates use observation times. Responses cache for five minutes; failures return HTTP 503 with no-store rather than a misleading empty feed. This is a bounded recent feed, not a guaranteed delivery queue or full archive. Subscribe with an RSS reader and use the paginated history for older entries. RSS does not accept the page's other filters.

Validation: run the catalog TypeScript tests and `supabase/tests/catalog_release_history_filters.sql` on a migrated test database. SQL fixtures roll back after checking exact matching, UTC boundaries, architecture, predecessors and pagination totals.

### Metadata request recovery

Metadata batches have a three-second request timeout. An aborted request skips the batch retry when individual recovery is available; other transient errors receive one retry. The website then falls back to indexed app/version equality lookups with at most four concurrent requests. Each fallback request has a three-second timeout and all fallback work shares an eight-second deadline. Only records whose requests still fail show unavailable details; missing optional vendor metadata is not a request failure.

Incomplete history responses are thrown out of the page-cache callback, preserving the previous complete response during background revalidation. On a cold request the available records can still render without storing the partial result. History links do not depend on enrichment. The displayed full-catalog check timestamp is explicitly labelled to distinguish it from incremental updates.

### History work capacity

Each server instance admits at most four complete history reads, including their
metadata lookups, across all filter keys and recent-count reads. Up to eight
additional reads wait for at most five seconds. Admission failure remains a
Catalog history unavailable error; it is never a successful empty result. A slot
is released only when the underlying work settles. This is an instance limit,
not a fleet limit, and HTTP abort does not prove cancellation in Postgres.

The existing five minute page-cache callbacks and keys are unchanged. Failed
background revalidation keeps the last complete cached value. Cold requests keep
the existing unavailable or partial-data presentation. A bounded recent-total map
uses successful RPC counts for at most five minutes to redirect known out of range
pages before another cached load; unknown totals retain the existing cold path.

The app-specific RPC branch uses the case-insensitive curated-app index. The global
branch retains its previous SQL. The database change requires real Postgres 17
plan, parity and concurrency evidence before deployment; fixture timings alone
are not evidence of production recovery.

### Global release page plan

The unfiltered global page derives counts and month summaries without probing the first release for every catalog app. The previous release for each displayed row is loaded as before. Filtered global and app specific requests retain their existing bodies. Apply only the reviewed migration for this function, preserving existing grants. Rollback restores the prior function migration; do not apply unrelated pending migrations. Synthetic response parity is separate from Postgres 17 concurrency and production recovery evidence.

## Recent update count

The server uses `get_catalog_recent_update_count(date)` for the unfiltered seven day updates tile when its existing service key is configured. This count uses the same visible catalog rows, UTC date boundary and predecessor ordering as the history total. It does not construct pages, months or metadata. The existing history function and its grants are unchanged. The new function permits service_role only; anonymous only installations retain the previous history RPC path.

Apply the additive count migration before the server change. It refreshes the PostgREST schema cache. No new credential is needed. Roll back the server source before dropping the additive function; the existing history body must remain `69204a947d44d31b8a4924c73ff14d4a` with the same ACL. Existing complete cache admission and error logging are unchanged.

The old eight session PG17 baseline is retained as information even when it does not reproduce production. Production logs from 15 November 2026, 04:50 to 07:40 UTC recorded 23 recent count SQLSTATE 57014 failures and one abort. Those failures supply the regression evidence; a passing old CI baseline is not described as failing. No load escalation is performed. Candidate and mixed history tests still require p95 below two seconds, zero statement timeouts and the existing one second unrelated query limit, alongside parity, role ACL and rollback checks.

live verification not runnable; post-merge production verification

After deployment, require zero recent path SQLSTATE 57014 failures for two full hours. Compare total error rates with the preceding production window and revert in the same cycle if they rise. Count recent SQL timeouts and client aborts separately from the remaining history page failures. Keep earlier failed milestones on record; this count change does not establish recovery of the history page path.
