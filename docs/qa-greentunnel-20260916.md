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
the status-only count was 333; the full archived-evidence audit verified 19 at the exact
current pin `6dfeaea03893e63cf7aba747638d7ea1768ac6b7`. Compatible historical
passes must not be reported as exact-current-pin strict credit. No milestone
record has been written.

Repair PR #1184 merged as `bc329cb8bfafd8d2af940bdc9f8ccf044ac15146` after all
required CI passed. Local verification: 1,929 tests passed, lint passed with one
existing warning, and the production build passed. Guarded promotion and exact
retry operations are in `scripts/qa-greentunnel-rollout.mjs`.

Activation PR #1185 merged as `d74f4e9463448b1d15e3d4fccc8e7ed15c9bddeb` and
deployed to production. Workflow PR #4072 omitted the protected config pin;
validation caught it, and #4073 corrected it after both workflow checks passed.
Final workflow commit: `d4305fe38aad19293e9c4ec4eb05897063557c59`. Dispatch stayed
paused throughout promotion. Two undispatched old-pin rows were superseded.

Exact retry candidate `b3c99f72-0ef6-4795-a308-125daca2fa66`, run `35041060339`,
passed `0/0/0/1` with VirusTotal `0/0` and the original installer hash. Its
profile hash is `9AC5ADE5687B24BA040CC22AA0F7AB082E24FAE7BF5007CD916EC6897912FBF2`.
However, execution context is **User**, not the required **LocalSystem**.
Therefore it earns no strict credit and cannot authorize strict-pass resumption.

The exact payload is contained using `scripts/qa-greentunnel-quarantine.mjs`.
That guard verifies both original failed LocalSystem evidence and the successful
user-scope retry before writing the shared `failed_managed_lifecycle` block.
This blocks the exact tuple in customer packaging and QA, including overrides;
future versions/hashes are not blocked. The user-scope result is preserved.
General dispatch may resume only after block readback, zero active lifecycles,
and fresh matching required/scheduler pins. No security control is relaxed.
