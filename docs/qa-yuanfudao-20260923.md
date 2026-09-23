# Yuanfudao 7.31.0 x64 compatibility hold

Production auto-paused after candidate `7f30e76f-eb50-4da8-b48b-2ca6f3692b97`,
[run 35852626457](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/35852626457).
Fresh production and GitHub evidence agree: terminal failure, zero active lifecycles.

The LocalSystem PSADT package returned `0/0/60001/0`. The exact captured registration
`tutor-electron-student` resolved to `%USERPROFILE%\YuanFuDao\tutor-electron12-student\uninst.exe`.
The uninstaller ran with `/S`. Its parent exited, but the registration remained through
the 310-second deadline and independent removal detection remained positive.
The catch exit 60001 correctly preserved the failed lifecycle. VirusTotal was
`not_found` with null verdicts, which is not a strict clean 0/0 result.

[Official WinGet metadata](https://github.com/microsoft/winget-pkgs/blob/master/manifests/y/Yuanfudao/Yuanfudao/7.31.0/Yuanfudao.Yuanfudao.installer.yaml)
declares Nullsoft, machine scope, and that exact product code and x64 SHA.
[NSIS documentation](https://nsis.sourceforge.io/Docs/Chapter3.html#uninstallerusage)
confirms `/S` as the silent switch. The [vendor download page](https://www.yuanfudaoschool.com/info/download)
offers 7.31.0; no verified alternative managed-removal contract was established.
The local sanitized diagnostic was inaccessible; bounded GitHub PSADT evidence
and the committed compact JSON provide the failure evidence.

Apply `scripts/qa-yuanfudao-quarantine.mjs block` through the existing production
environment after protected merge. It verifies the immutable installer/profile hashes,
exact candidate/run, failed phase tuple, LocalSystem and exact shared pin before
inserting a `failed_managed_lifecycle` block. Existing blocks are never overwritten.
Only undispatched queued duplicates can be superseded; failed evidence is retained.
QA demand and customer GitHub packaging both enforce this existing exact-tuple gate,
including customer QA override. Future versions and different payloads remain eligible.

This is containment, not a successful uninstall repair or security clearance.
Release requires a reviewed shared managed-removal repair and controlled strict retest
of this exact payload, with clean VirusTotal evidence. No packager change is needed:
QA/customer/required/scheduler pin remains `4b4637967c6e2b0188f5713d262dd1219a02465e`.
Resume uses the script's guarded `resume` action only after verifying the block,
fresh aligned scheduler heartbeat, unchanged failure pause, and zero active lifecycles.

At 2026-09-23T11:37:08Z, strict cohort count was 16/500 at boundary
`2026-08-30T08:28:35Z`; latest strict finish was `2026-09-23T10:28:27.969594+00:00`.
The older status helper's 599 is a passed-row tally, not the required strict count.
No milestone record is warranted. The continuous supervisor must remain enabled.
