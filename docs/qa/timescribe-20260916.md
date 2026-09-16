# TimeScribe 1.16.0 exact-payload containment

Production automatically paused after candidate
`611ef6c0-8828-4401-8546-bf5536423019`, run `35078027976`.
Fresh production and GitHub checks confirmed zero active QA lifecycles.
The exact LocalSystem PSADT 4.1.8 result is Failed, exits 0/0/60001/0,
VirusTotal 0/0, shared packager bc329cb8bfafd8d2af940bdc9f8ccf044ac15146.

Installation captured exact NSIS registration 932b644f-cf07-5d84-aef8-0b37bf9d7ce1.
Uninstall resolved that same registration but its executable was absent under
SYSTEM's LocalAppData/Programs/timescribe/Uninstall timescribe.exe. The package
correctly refused to proceed; detection remained positive. The reason the
file is missing is not proven. Protected diagnostic run 35079484100 confirms
this exception and the captured identity without accessing runner files.

## Official source review

- [Exact WinGet manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/w/WINBIGFOX/TimeScribe/1.16.0/WINBIGFOX.TimeScribe.installer.yaml)
  declares NSIS, omits scope, and matches the observed ProductCode and SHA.
- [Vendor lockfile](https://github.com/WINBIGFOX/TimeScribe/blob/v1.16.0/composer.lock)
  pins nativephp/desktop 2.3.1 at 2e517ffd23b4e8df8fd04108bbd1ac9ce08fbc1a.
- [Pinned NativePHP build configuration](https://github.com/NativePHP/desktop/blob/2e517ffd23b4e8df8fd04108bbd1ac9ce08fbc1a/resources/electron/electron-builder.mjs)
  uses default NSIS settings without perMachine or an assisted installation override.

These sources do not establish a working LocalSystem removal route for the
observed missing executable. Changing execution to a signed-in user cannot
satisfy this cohort's LocalSystem requirement. No guessed uninstaller, broad
identity search, manual removal, or marker deletion is authorized.

## Shared resolution

scripts/qa-timescribe-quarantine.mjs verifies the exact candidate, installer
SHA, recomputed canonical profile SHA, app/version/architecture, PSADT mode,
packager pin, phase tuple, LocalSystem context, and reputation before writing
the existing qa_package_blocks gate. The exact payload is blocked for QA and
customer packaging, including QA overrides. Other payloads and future versions
remain independently eligible. Failed evidence stays intact.

This is containment, not an adapter repair or passing retest. No packager or
customer workflow payload changes are necessary. Resume requires the verified
block, original pause, zero active lifecycles, aligned pins and a heartbeat
younger than five minutes. A future unblock requires reviewed shared repair
and a controlled exact-payload retest.

At 2026-09-16T09:27Z, the current-pin evidence audit reported 6/500 at the
immutable boundary 2026-08-30T08:28:35Z. The status-only count was 347 and
does not satisfy the requested strict criteria. No milestone is warranted.
