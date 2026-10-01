# Power BI September release compatibility hold

Production candidate `19c632e6-c267-4f33-88af-844dd358260c`, run
`36849592959`, tested Microsoft.PowerBI `2.158.1177.0` x64 using LocalSystem,
PSADT 4.1.8 and shared packager `4b4637967c6e2b0188f5713d262dd1219a02465e`.
Installer SHA256: `4924187834D34605C3046F01B876FBA6A2CF36F864C36D16FD52C3F17A21009C`.
Profile SHA256: `E6E51A7BE7AF907CEF54BEA550728BF7A04463AB0078B00983EA294859C8251E`.

The compact lifecycle tuple is `0/0/60001/0`. Installation took 545.945 seconds;
uninstall took 373.832 seconds. The bounded sanitized PSADT log shows the exact
registered Package Cache `PBIDesktopSetup_x64.exe` invoked with
`/uninstall /quiet /norestart`. Registration
`{dc5665fe-ff39-46c4-8b41-8cd1b870c0c1}` remained at the completion deadline.
Final package detection was positive. The exception is the shared fail-closed
completion guard, not proof of a particular vendor error. Production auto-paused
and active lifecycle count was zero before containment.

[Microsoft's command-line documentation](https://learn.microsoft.com/en-us/power-bi/fundamentals/desktop-get-the-desktop#use-command-line-options-during-installation)
supports unattended uninstall and restart suppression. Available evidence does
not establish whether a longer wait would solve this failure. The additional
redacted host diagnostic was inaccessible to the operator. No speculative
timeout extension, child-product removal or manual cleanup is justified.
VirusTotal in the compact result is `not_found` with null engine counts; it is
not a clean verdict and cannot qualify for the cohort.

The migration holds only these exact bytes through `qa_package_blocks`.
Existing shared QA demand and customer package gates reject the immutable tuple,
including customer QA overrides. Future payloads remain independently eligible.
Terminal failure evidence is retained; only never-dispatched matching queue rows
may be superseded. No generator change or packager pin promotion is needed.

Release requires reviewed root-cause diagnosis, any needed shared customer/QA
remediation, and a controlled exact-version/architecture/hash lifecycle retest
with strict `0/0/0/1` evidence and clean VirusTotal `0/0`. General dispatch may
resume after the hold is applied, required and fresh scheduler pins match, and
active lifecycle count remains zero.
