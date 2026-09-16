# UniFi Network Server 10.6.106 exact-payload containment

Production auto-paused after candidate 3849c8a1-5bd3-4c68-b44d-14c5aefe018b,
GitHub run 35097308073. Fresh production and Actions checks found no active
QA lifecycle. The exact LocalSystem PSADT result failed with 0/0/60001/0;
VirusTotal was 0/0. Shared packager: bc329cb8bfafd8d2af940bdc9f8ccf044ac15146.

The package captured the exact Ubiquiti UniFi registration, displayed as
Ubiquiti UniFi (remove only). Removal resolved that identity but failed closed
because systemprofile/Ubiquiti UniFi/Uninstall.exe did not exist. Detection
remained positive. Why the file is missing is not proven by the available
sanitized evidence. Local diagnostic access was denied; the bounded redacted
diagnostic tail in the completed GitHub job independently establishes the
exception and identity. No runner directory was accessed.

## Primary sources

- https://github.com/microsoft/winget-pkgs/blob/master/manifests/u/Ubiquiti/UniFiNetworkServer/10.6.106/Ubiquiti.UniFiNetworkServer.installer.yaml
  declares nullsoft, machine scope, ProductCode Ubiquiti UniFi, a Profile-based
  default installation directory, and the exact failed installer SHA.
- https://help.ui.com/hc/en-us/articles/360015373734-How-to-Uninstall-the-Self-Hosted-UniFi-Network-Server
  directs Windows users to the same registered entry and interactive prompts.

These sources do not establish a safe replacement for the absent uninstaller.
Do not guess another path, weaken path checks, delete vendor files or markers,
or switch execution context to manufacture a strict pass.

## Shared resolution

scripts/qa-unifi-network-quarantine.mjs validates the exact failed candidate,
installer SHA, recomputed canonical profile SHA, PSADT mode, LocalSystem,
phase exits, reputation, original pause, zero active lifecycles and aligned
pin. Its block action uses the existing qa_package_blocks compatibility gate,
which QA demand and customer packaging both enforce before overrides.
Only this app/version/architecture/SHA is blocked; future payloads remain
independently eligible. The failed evidence is preserved.

This is deterministic containment, not a successful retest or adapter repair.
No generated package behavior or workflow payload changes are needed, so the
shared packager pin stays unchanged. Guarded resume requires the verified
block and a scheduler heartbeat younger than five minutes.

The status helper reports 354 distinct passed rows at the immutable boundary
2026-08-30T08:28:35Z. An exact-result audit at 12:58 UTC instead found 15
distinct currently eligible IDs satisfying the current-pin strict criteria,
with latest strict finish 2026-09-16T12:18:00.723657Z. Historical exclusions
also require strict evidence. The 500 milestone is not complete.

## Validation

All 125 focused eligibility, QA demand, customer gate and customer Actions
tests pass. Full lint, script syntax and changelog validation pass.
The Windows full-suite attempt encounters the existing POSIX translation-stub
timeout; clean protected CI must pass full tests, lint, workflow lint and the
production build before merge. No application runtime or packager code changes.
