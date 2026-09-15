# RadioMaximus exact-payload containment

## Evidence and decision

- Candidate `fcc72c76-ead6-4a70-b072-a5521650c74a`; [failed run 35001712419](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/35001712419).
- `Raimersoft.RadioMaximus` / `2.33.15` / `x86`; installer SHA256 `8D64DD8FCA0C7CD042CD3028496B7085BEDF22364908D056A9795BCCB821A4A8`.
- Profile SHA256 `91A9364C06430036B7306FB62B869F241265CE5B75691255754DE25D11B1C04A`; shared packager `6dfeaea03893e63cf7aba747638d7ea1768ac6b7`.
- LocalSystem PSADT result `0/0/60001/0`, compact VirusTotal `0/0`. Exact registration `RadioMaximus_is1` remained after 312 seconds. The registration and marker were correctly retained by fail-closed removal verification.
- The job invoked `C:\Program Files (x86)\RadioMaximus\unins000.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-`.
- Production auto-paused; zero active lifecycles verified. Local sanitized diagnostic access was denied even with escalation; bounded published job diagnostics and compact JSON establish the failure.

The [official WinGet manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/r/Raimersoft/RadioMaximus/2.33.15/Raimersoft.RadioMaximus.installer.yaml) confirms the exact hash, x86 architecture, Inno installer and product key. [Inno's documented unattended uninstall switches](https://jrsoftware.org/ishelp/topic_uninstcmdline.htm) were already present. The [vendor page](https://www.raimersoft.com/php/radiomaximus.php) does not establish a verified alternative managed removal contract. No evidence supports guessing a process-close adapter or different uninstall command.

Contain only this immutable payload using the existing shared `qa_package_blocks` / `failed_managed_lifecycle` path. QA demand and customer packaging reject it, including customer QA overrides. Future releases remain eligible. This is containment of a proven failed lifecycle, not a claim that every RadioMaximus version lacks unattended removal.

## Guarded operation

After protected PR validation and merge, run `scripts/qa-radiomaximus-quarantine.mjs audit`, then `block`, through the existing production environment. The script validates exact result, canonical hash, installer hash, failure tuple, pause reason, zero active lifecycles and aligned pin. It preserves failed and security evidence and supersedes only exact-tuple never-dispatched queued rows.

Invoke authenticated enqueue to refresh scheduler heartbeat. Use `resume` only with verified containment and fresh aligned pins. Dispatch one general-queue lifecycle and audit its phase. A controlled retest of the blocked payload requires a reviewed lifecycle repair; do not retry identical behavior or grant a pass.

No shared generator change or pin promotion is required: both customer and QA gates already enforce exact-payload blocks. Regression coverage exercises RadioMaximus demand rejection, customer overrides and rejection before a GitHub Actions payload is sent. Required PR CI runs full tests, lint and production build.

## Strict cohort

At `2026-09-15T17:51:03Z`, the full current-pin audit reports **14/500**, boundary `2026-08-30T08:28:35Z`; latest strict finish `2026-09-15T17:21:28.426533+00:00`. The status helper reports 326 using passed status and package level only. It does not establish the requested strict milestone. No completion record is warranted; the continuous supervisor remains enabled.
