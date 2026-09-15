# Tencent ima exact-payload containment

## Verified failure

- Candidate: `e2927f23-1ad4-4143-b7ac-c04a755ec930`
- Run: https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34988617135
- App/version/architecture: `Tencent.ima-copilot` / `2.6.10.5128` / `x64`
- Installer SHA256: `37E79B29536B79F0DB0F203CD9135A196F5A9791D446F7B16E2A3C1FE75F9EB9`
- Canonical profile SHA256: `F9507BB1623E72D7E4AEBE0932DFF0973D540E670E9441BAE92688724EAD1662` (recomputed and matched)
- Shared QA/customer packager: `6dfeaea03893e63cf7aba747638d7ea1768ac6b7`
- LocalSystem PSADT result: `0/0/60001/0`; exact `ima.copilot` registration remained after the 310-second completion deadline.
- Registered command: `Application/uninstall/ImaUninstall.exe --uninstall --verbose-logging`, under the SYSTEM profile's LocalAppData directory.
- VirusTotal evidence is missing (`null/null`), not a clean `0/0` verdict. No strict pass is granted.
- Production auto-paused and GitHub completed the failed run. Zero active candidates were verified before containment.

## Decision

The [official WinGet installer manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/t/Tencent/ima-copilot/2.6.10.5128/Tencent.ima-copilot.installer.yaml) declares generic EXE, `quiet` installation, and product identity `ima.copilot`. The [vendor site](https://ima.qq.com/) and manifest did not establish a supported unattended removal command. Do not guess Chromium or other framework switches for this vendor-specific uninstaller.

Use the existing shared `qa_package_blocks` exact-payload `failed_managed_lifecycle` block. Both QA demand and customer packaging consult this block before execution, including customer QA overrides. Future payloads remain independently eligible. Existing security evidence and the failed result are preserved.

`scripts/qa-tencent-quarantine.mjs` audits the exact candidate, result, canonical profile hash, installer hash, failed phase tuple and current pin before any mutation. Its `block` mode adds containment and supersedes only exact-tuple, never-dispatched queued rows. Its `resume` mode requires the block, exact failure pause, zero active candidates, aligned pin and fresh heartbeat with compare-and-set control update.

No generator behavior changes; the QA/customer packager pin remains unchanged. Regression tests cover the actual normalized Tencent profile, customer gate with and without override, and rejection before a customer GitHub Actions payload is sent. Required PR CI supplies full tests, lint and production build validation.

## Cohort audit

At `2026-09-15T15:52:28Z`, the existing strict audit reports **11/500** at boundary `2026-08-30T08:28:35Z` and the current shared pin. Latest strict finish: `2026-09-15T13:48:35.962944+00:00`. The guardian status script's broader **322** count filters passed status and package level only; it must not be reported as the fully strict milestone count.

## Operations after protected merge

Run the containment script with `block` through the linked checkout's production environment. Verify readback, invoke authenticated enqueue to refresh scheduler heartbeat, then use guarded `resume`. Invoke enqueue again to replenish the low queue and dispatch only if no lifecycle is already active. Re-audit current production and GitHub state. Do not retest the quarantined payload until a reviewed removal contract is available; do not disable the continuous supervisor.
