# IntuneGet Packager 1.4.3

Curated jobs in direct Supabase mode now check current installer security holds before execution. The check uses the exact installer SHA256 and refuses an active hold, an invalid hash, or unavailable or invalid security data. When possible, a refused claim returns to `awaiting_qa` without starting the job handler.

Released holds remain eligible. Unrelated installer hashes do not block a claim, and Defender approved releases do not require a VirusTotal cache row. No security hold or verdict is changed by this release.

This release contains the standalone security check merged in IntuneGet PR 1730. Website mediated claims use the hosted check already deployed from that PR. Update the local packager to receive the direct mode check.

No dependencies changed. Windows requirements, installer hash verification and existing upload guards remain unchanged. This release does not replay customer jobs or establish customer exposure.
