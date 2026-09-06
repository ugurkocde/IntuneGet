# Catalog release history

The public page is `/apps/releases`. The catalog source supports Supabase and self-hosted SQLite snapshots. Results are cached for five minutes and paginated in groups of 40. Search is literal, case insensitive, and limited to 120 characters. Month boundaries are UTC.

`version_history.created_at` is the first time IntuneGet recorded that version, not the publisher release date. A database trigger preserves it across upserts. The earliest stored version for each app is labelled **First tracked**; subsequent observations are **Version change**, including rollbacks. Historical imports and missed versions prevent this from being a complete publisher archive. Locale variants are excluded from the feed and totals.

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
