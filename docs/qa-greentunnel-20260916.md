# GreenTunnel lifecycle repair

Production candidate `402a247b-5797-48c6-b9f0-19d680c14300` tested
`SadeghHayeri.GreenTunnel` 3.0.5 x86 in run `35038135680` with installer
SHA256 `77CD4E08ABF2E7A0FC235821AE49BBFDD032616A9A0407902F907C96547D2659`.
The lifecycle returned `0/0/60001/0`; production auto-paused and no lifecycle
remained active. VirusTotal reported 0 malicious and 0 suspicious verdicts.

The bounded GitHub diagnostic identifies the exact NSIS uninstall registration
`ba1bb1f3-0069-5c64-9a11-479ebc0471d9`, but its registered executable beneath
LocalSystem's profile was unavailable. The official source at
https://github.com/SadeghHayeri/GreenTunnel/blob/v3.0.5/apps/desktop/electron-builder.yml
sets `nsis.perMachine: false`; WinGet's 3.0.5 manifest omits Scope.

The shared adapter selects user scope for this exact WinGet ID. Customer
GitHub dispatch also resolves reviewed scope before dependency resolution,
profile hashing and payload creation, including catalog-reconciliation fallback.
No uninstaller paths, hashes, signature checks or security gates are relaxed.

Focused regression coverage exercises the adapter, catalog QA configuration,
normalized profile/detection hive and customer dispatch payload.

Release steps: merge required CI, activate the exact shared commit in the
website and both workflows, deploy production, guard the required pin, supersede
only undispatched obsolete rows, then prioritize the exact failed tuple through
the scheduler. Resume only with fresh matching pins and zero active lifecycles.
Audit its complete lifecycle before releasing the general queue.

The immutable cohort boundary remains `2026-08-30T08:28:35Z`. At repair start,
the status-only count was 333; latest database evidence verified 17 at the exact
current pin `6dfeaea03893e63cf7aba747638d7ea1768ac6b7`. Compatible historical
passes must not be reported as exact-current-pin strict credit. No milestone
record has been written.
