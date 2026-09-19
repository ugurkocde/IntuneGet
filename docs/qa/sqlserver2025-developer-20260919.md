# SQL Server 2025 Developer exact-payload containment

Fresh production inspection at 2026-09-19T02:29:14Z confirmed automatic pause,
zero active candidates, and 13 queued candidates. Completed run
[35415266877](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/35415266877)
published a failed compact result through the protected result workflow.

Candidate `68b8058d-33b2-4eb2-b5bb-2effbf8bee2d`: version `17.0.1000.7`, x64,
installer SHA `F2FDCEA621E29B2DD09E3802FD6FE7664A2037BED02349854CCAE96C4A03BBF1`,
canonical profile SHA `19FC7F46BEBA7D7374EDE8B5F22E535008DF10ED8016C0D4CB6379EC2FD195CC`,
shared packager `bc329cb8bfafd8d2af940bdc9f8ccf044ac15146`.

The LocalSystem PSADT lifecycle returned `-1/1/60001/1`. Bounded sanitized
GitHub PSADT logs show the bootstrapper returning -1 without a timeout.
No uninstall registration was added. Uninstall correctly refused removal
because exact manifest key `Microsoft SQL Server SQL2025` was absent.
VirusTotal malicious/suspicious was 0/0. Direct diagnostic access was denied;
no runner working directory was accessed.

The invocation and SHA match the
[official WinGet manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/m/Microsoft/SQLServer/2025/Developer/17.0.1000.7/Microsoft.SQLServer.2025.Developer.installer.yaml).
[Microsoft documents unattended setup using setup.exe from installation media](https://learn.microsoft.com/en-us/sql/database-engine/install-windows/install-sql-server-from-the-command-prompt?view=sql-server-ver17),
with explicit instance and feature configuration. That does not establish the
cause of this SSEI bootstrapper failure or justify substituting guessed setup
parameters, identities, or execution context.

Contain only this immutable payload using the existing shared
`failed_managed_lifecycle` compatibility gate. This is not a malware finding or
an app-wide claim that SQL Server cannot be deployed unattended. Future payloads
remain eligible. Release requires reviewed diagnosis and a controlled strict
retest. Preserve the terminal failed row; do not rerun known failed bytes merely
to establish containment.

Exact current-pin audit at 2026-09-19T02:31:35Z: **78/500** after immutable
boundary `2026-08-30T08:28:35Z`, latest strict finish
`2026-09-18T23:53:55.21953Z`. The status-only script's 437 is not authoritative
under the requested strict rules. No milestone file is warranted.

Promotion: protected PR/checks; apply the reviewed migration while paused and
idle; verify shared QA/customer gating and preserved evidence; refresh scheduler;
verify current QA/customer pins; guarded resume; dispatch one eligible candidate.
The deployed gate consumes the block immediately. No generator changes or
packager pin rotation are needed for this data-only containment.
