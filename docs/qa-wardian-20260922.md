# Wardian 0.6.1 compatibility quarantine

Candidate `aeeee4e9-37fc-4228-a402-4c0f1f6f5243`, [run 35705553699](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/35705553699), tested x64 installer SHA `5804571F3796E39ED8AC5FFC23F068E17199477531BD1007C9CDF71A8FE64AF6` with shared packager `4b4637967c6e2b0188f5713d262dd1219a02465e`. LocalSystem lifecycle returned `0/0/60001/0`; the exact captured Wardian registration pointed to an absent `uninstall.exe` in the SYSTEM profile. Removal detection remained positive. Production auto-paused with zero active candidates.

The [official WinGet manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/w/WardianApp/Wardian/0.6.1/WardianApp.Wardian.installer.yaml) matches the exact hash and declares Nullsoft `/S`. The [vendor release configuration](https://github.com/wardian-app/Wardian/blob/v0.6.1/src-tauri/tauri.conf.json) builds NSIS but supplies no alternate managed removal contract. The evidence does not establish a safe alternate executable path. Local diagnostics were inaccessible; diagnosis uses bounded sanitized Actions logs, production telemetry, and compact JSON.

Quarantine only this immutable installer tuple through `qa_package_blocks`, consumed by QA demand and customer packaging, including override requests. Preserve the failed candidate and security blocks. No executable adapter or packager pin changes are needed. VirusTotal was `not_found` with null counts, so this is neither a clean security verdict nor a strict pass.

Regression coverage verifies rejection before QA insertion, before pass reuse with either override value, and before customer GitHub Actions dispatch. Release from quarantine requires reviewed managed removal and a controlled exact-tuple strict lifecycle with VirusTotal 0/0; never infer success from install alone.

At 2026-09-22 08:57 UTC the full current-pin strict audit counted 4/500 after boundary `2026-08-30T08:28:35Z`. The status-only count of 577 is not the milestone count. Continuous supervision remains enabled.
