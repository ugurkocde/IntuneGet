# TimeScribe 1.17.1 exact-payload containment

Production audit on 2026-09-23: cohort boundary `2026-08-30T08:28:35Z`, authoritative policy v2 strict count **40/500**. Pipeline auto-paused, zero active candidates, 14 queued.

Candidate `06190973-b487-41ac-900c-53bb8bb84fba`, run [35890849220](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/35890849220), x64, installer SHA `6DBADEF47A4ED4ADA5BEFA798462A6571D2B5525AC9FA1E5E96F202469C645E1`, profile SHA `3DB0E219248FE05FCE0E8FF73314218E185D7AE4B553A88E92DC4A0177EB0284`.

Database and compact result agree: PSADT 4.1.8, LocalSystem, exits `0/0/60001/0`, VirusTotal clean `0/0`. Canonical profile hash was recomputed and matches. Compact result binds the run; the result table has null run metadata. Pin `4b4637967c6e2b0188f5713d262dd1219a02465e` matches canonical profile, result, required and scheduler pins.

The cached QA job shows exact registration `932b644f-cf07-5d84-aef8-0b37bf9d7ce1` captured during installation. Uninstall fails because the registered `systemprofile/AppData/Local/Programs/timescribe/Uninstall timescribe.exe` is missing. Removal detection remains positive. This repeats the 1.16.0 failure; it does not establish a safe alternative removal command. Host diagnostic access was denied; no runner directory was accessed.

Official sources checked: [WinGet 1.17.1 manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/w/WINBIGFOX/TimeScribe/1.17.1/WINBIGFOX.TimeScribe.installer.yaml), [vendor configuration](https://github.com/WINBIGFOX/TimeScribe/blob/v1.17.1/config/nativephp.php), and [vendor dependency lock](https://github.com/WINBIGFOX/TimeScribe/blob/v1.17.1/composer.lock). Manifest uses nullsoft and the same exact identity/hash; vendor uses NativePHP Desktop 2.3.1.

Resolution: the existing `qa_package_blocks` mechanism blocks this exact tuple through shared eligibility, QA demand, and customer packaging gates, including override attempts. No adapter or packager change is justified by the evidence. Keep pin unchanged and prior compatible strict coverage intact. Only safely undispatched matching rows may be superseded; preserve the failed lifecycle evidence. Do not count this application as a pass.

Operator script: `scripts/qa-timescribe-1171-quarantine.mjs audit|block|resume`, run via the linked checkout's existing production environment. Mutations require the exact pause, no active lifecycle, aligned pin, matching canonical hash and failure evidence. Resume also requires the persisted block and fresh scheduler heartbeat. Merge the protected PR and verify required CI before applying containment; refresh enqueue if necessary, guarded resume, then authenticated dispatch and database audit. Never run an installer on the host.
