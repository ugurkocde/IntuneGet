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
manifests, not an operational failure. The release page labels this separately
from `failed`, retains existing records, and shows the completed check time in
UTC. The next scheduled manifest sync retries unavailable records.

Installation scanning is independent of version-history ingestion. The scanner
retries only WinGet error `-1978335146` (installer prohibits elevation) using a
temporary standard Windows user. The entire scan, including
HKCU snapshots and cleanup, runs in that context. The account is removed afterward.
If that context cannot be prepared, the scan still fails and preserves the reason. Crashes, timeouts and partially completed installs are not
retried automatically. Failed scans preserve verbose WinGet diagnostic logs as
separate artifacts for seven days; they are never reported as successful metadata.

## Vendor links and hash reputation

Release History displays the official `ReleaseNotesUrl` from the exact WinGet locale manifest, with no inline release-note body. Manifest sync saves this URL for new records. **Backfill Release Note Links** checks up to 200 older records hourly, newest first. Manual dispatch accepts 1-1000 versions. Missing vendor URLs remain absent; operational errors stay eligible for retry.

VirusTotal evidence lives in the public `catalog_file_reputation` table, keyed by the exact installer SHA-256. Page reads queue only hashes already in version history, using the server service role. Anonymous users can read reports but cannot write or queue hashes. The independent **Refresh Catalog File Reputation** workflow in `IntuneGet-Workflows` uses its existing VirusTotal secret. It starts batches every five minutes (subject to GitHub scheduling), processes up to 40 files per batch, and reserves a shared 20-second rate slot for each request. The catalog budget is 400 requests per UTC day, leaving 100 of the public API limit for QA and other use. Cached refreshes and historical backfill share a 200-request sub-budget, preserving capacity for unseen releases. Found reports remain fresh for seven days; missing reports for one day. Expiry alone does not queue a refresh. Page requests never call VirusTotal directly, install software, or upload files.

Findings include malicious and suspicious counts and the original analysis date. Pending, missing, and unavailable reports are distinct from zero detections. Existing findings survive lookup errors and rate limits; errors use bounded exponential retries, and provider rate limits pause the shared worker. A known hash always links to the VirusTotal report. New manifest hashes enter the queue automatically. Requested unseen hashes and new releases have priority 2, stale requested reports priority 1, and current-version backfill priority 0. FIFO timestamps survive page reads and discovery; leases expire after 15 minutes so interrupted work can recover. QA writes populate the cache, and QA reads reuse fresh cached findings before spending API quota. Workflow summaries show queued work, oldest request, and daily budget usage. Quota limits can delay queued results. This describes the selected WinGet installer file, not every installer architecture or an already installed application on a device.

Snapshots include vendor URLs and cached reports. Older snapshots can reuse legacy QA findings by hash, but cannot queue live lookups. Deploy the additive database migration before the website and worker.
