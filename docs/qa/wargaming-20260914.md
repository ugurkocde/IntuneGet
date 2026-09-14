# Wargaming Game Center managed removal

Candidate `53ec9e38-ca94-43a7-9f7a-c66c98aa85a8`, version `26.05.00.3403`,
architecture `x86`, failed in [run 34797067841](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34797067841).
The pipeline auto-paused, with zero active QA candidates. GitHub confirmed
the failed lifecycle completed and the final clean checkpoint was restored.

The exact installer SHA is
`8326C8D4F34BB5BBABB1CEA5059450B0C8671E9C25DAEBEF8A76187A87152921`.
The profile SHA is
`14C52D5D494B5E6C071B5EDD0582956FF748DEC551F05DD77DC4657DFD4B82DB`.
QA used shared packager `9e51c9ab6cc3a28346f13266e566c9896fa4101b`, PSADT
4.1.8, LocalSystem, and VirusTotal malicious/suspicious `0/0`.

Install/detection/uninstall/removal returned `0/0/60001/0`. The captured
`C:\ProgramData\Wargaming.net\GameCenter\setup.exe` was called with
`/IU /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-`. Its parent exited with
code `1`; the exact `Wargaming.net Game Center` registration remained after
the 310-second deadline. The marker was correctly retained.

The [official WinGet manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/w/Wargaming/GameCenter/26.05.00.3403/Wargaming.GameCenter.installer.yaml)
declares Inno and `/silent` installation, matching the tested installer hash.
The [vendor removal guide](https://wargaming.net/support/en/products/wot/article/35523/)
documents interactive confirmation, including a choice about removing games.
No supported unattended removal contract was established. The safe resolution
is an `unsupported_managed_uninstall` block through the existing shared
eligibility gate, pending a supported lifecycle. No guessed adapter, extended
timeout, manual deletion, or security exemption is introduced.

Regression cases exercise QA demand refusal before dependency/profile work and
customer API refusal before preflight, job creation, or GitHub payload dispatch.
The migration clears catalog verification and supersedes only undispatched
queued rows. The exact failed candidate and security records remain unchanged.
No generator or profile changes require packager pin promotion.

At diagnosis, the immutable cohort boundary was `2026-08-30T08:28:35Z`.
The status-only counter was 259; exact current-pin evidence qualified 5 IDs.
The milestone remains incomplete. Resume requires fresh matching scheduler and
required pins, zero active QA lifecycles, and verification of this shared block.
