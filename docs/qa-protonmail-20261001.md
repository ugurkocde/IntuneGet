# Proton Mail 1.14.0 exact-payload lifecycle hold

Candidate `595720e5-080e-4af5-8aeb-fc5e19ddd1ec`, [run 36910754201](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/36910754201), used shared packager `60395492a3d51b2ff6f14b50ed7cd0c7f558be70`.
The x64 payload SHA-256 is `456ADBFE362FDF14EF0A189CDE1962316B46A8E277D139C12A99D39BCAC89BC3`.

Compact committed evidence records user execution, not LocalSystem, and lifecycle `0/0/60001/0`. It cannot qualify for the strict cohort. VirusTotal was clean (`0/0`, 68 engines). The exact registered `proton_mail` uninstaller was `Update.exe --uninstall -s`; its parent exited `-1` immediately and exact registration remained after 310 seconds. The package failed closed and preserved its detection marker.

[Squirrel's updater source](https://github.com/Squirrel/Squirrel.Windows/blob/develop/src/Update/Program.cs) routes uninstall through FullUninstall and removes registration only afterward. [Proton's hook](https://github.com/ProtonMail/WebClients/blob/main/applications/inbox-desktop/src/windows/squirrel.ts) delegates its user-data removal to a detached vendor batch script. These sources establish the framework, but do not establish the cause of this exact released binary's failure. No guessed switches, manually invoked batch script, vendor-file deletion, or registration deletion are justified. No diagnostic artifact was available; protected host diagnostics were inaccessible. The exact failed-run logs and compact result were cached by the guardian outside the runner directory.

Contain only this immutable app/version/architecture/hash via existing `qa_package_blocks.failed_managed_lifecycle`. QA demand and customer package dispatch already consult this shared fail-closed gate. Preserve the failed candidate and supersede only safe undispatched queued copies of these bytes. Future versions and other architectures are not blocked by this record. No packager or workflow pin change is needed for this data-only hold.

Releasing the hold requires a reviewed shared fix or verified vendor remedy and controlled exact-tuple lifecycle retest. Strict credit still requires LocalSystem and all existing evidence checks. Keep the continuous supervisor enabled; resume unrelated work only with no active lifecycle and fresh matching required/scheduler pins.
