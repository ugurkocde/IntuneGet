# TubeDigger 8.2.5.0 containment

Production inspection at 2026-09-18T16:36:52Z confirmed an automatic failure
pause, zero active candidates, and 11 queued candidates. GitHub run
35367814228 completed, including package cleanup and compact-result publication.

Candidate: `90e10b9f-cd5a-482a-af05-2ba88402b19a`, x86, installer SHA-256
`D34F1AFFD65BCF99F5762F5FC1A13C0B2585546BDC89D99AA045364DA6215BC8`.
Canonical profile SHA-256:
`5A1B244C19508A83FF287029EBBD5C98065692E056E4AB32C2476033E03B88BB`.
Shared packager pin: `bc329cb8bfafd8d2af940bdc9f8ccf044ac15146`.

The compact result and bounded sanitized PSADT log show LocalSystem PSADT
installation/detection/uninstallation/removal exits `0/0/60001/0`. The exact
registered `unins000.exe` received Inno quiet arguments, exited 1, and left
`{1E3745C1-674D-4B2E-B8F7-3F4088950ED7}_is1` registered after 310 seconds.
VirusTotal was clean, malicious/suspicious `0/0`. This is a managed-lifecycle
compatibility hold, not a security finding. Local diagnostic access was denied;
no runner directory was accessed and no installer was downloaded by this cycle.

Evidence:
- https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/35367814228
- `IntuneGet-Workflows/qa/results/tubedigger.tubedigger.json`
- https://github.com/microsoft/winget-pkgs/blob/master/manifests/t/TubeDigger/TubeDigger/8.2.5.0/TubeDigger.TubeDigger.installer.yaml
- https://jrsoftware.org/ishelp/topic_uninstcmdline.htm

No evidence establishes a safe corrective adapter. The migration holds only
the failed immutable payload through the existing shared QA/customer gate.
Future versions, architectures, and changed hashes are not blocked by this
entry. Terminal evidence is preserved. The payload may be released only after
reviewed diagnosis and a controlled strict lifecycle retest.

At 2026-09-18T16:40:36Z, `scripts/qa-strict-cohort-audit.mjs` found **69**
distinct eligible strict IDs on the current pin after the immutable boundary
`2026-08-30T08:28:35Z`. Latest strict finish: `2026-09-18T15:39:30.05514Z`.
The basic status script reports 430 based on passed candidate status alone;
that number is not a verified strict milestone count. No completion record is due.

Deployment procedure: merge through protected checks, apply this migration to
the production project while paused and idle, verify exact block and unchanged
terminal evidence, refresh enqueue heartbeat, verify both workflow pins, then
guardedly resume and invoke the authenticated dispatch endpoint. No packager
code changed, so pin rotation or old-pin queue supersession is unnecessary.
