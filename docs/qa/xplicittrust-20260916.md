# XplicitTrust 1.065 exact-payload containment

Production auto-paused after candidate d49f33d4-3327-4f96-8304-efd18545d534,
run 35059738293. Fresh production and GitHub state confirmed zero active
lifecycles. LocalSystem PSADT 4.1.8 returned Failed with 0/0/60001/0
and VirusTotal 0/0. Required and scheduler packager were both
bc329cb8bfafd8d2af940bdc9f8ccf044ac15146.

Installation captured MSI ProductCode {76CCDAB5-94FA-4CE5-9B0D-6F8304D801A3}.
At uninstall, the exact identity had no matching registration. The package
correctly refused broad removal and retained its detection marker.
The cause of the registration disappearance is unproven; automatic upgrading
is a hypothesis, not an established diagnosis. The bounded host diagnostic
was inaccessible; sanitized GitHub PSADT logs supplied the exact exception.

The official [WinGet manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/x/XplicitTrust/Agent/1.065/XplicitTrust.Agent.installer.yaml)
matches the captured ProductCode and installer hash. The vendor's
[removal guide](https://docs.xplicittrust.com/uninstall/uninstall/) documents
Windows Apps and Features or winget removal followed by manual folder cleanup.
It does not establish a safe replacement identity for the observed missing
registration. Do not introduce broad matching or manually remove vendor files.

scripts/qa-xplicittrust-quarantine.mjs binds the exact failed candidate and
result to the installer SHA, canonical profile hash, run, pin, phase tuple,
LocalSystem context and clean reputation before containment. The existing
qa_package_blocks gate rejects this exact payload for both QA demand and
customer packaging, including QA overrides. Failed evidence stays intact.
Future versions and other hashes remain independently eligible.

This is a containment change, not an adapter repair or a passing retest.
No shared packager code or production pin change is needed. Unblock only
after a reviewed shared lifecycle repair and controlled exact-payload retest.
Resume requires the verified block, original pause, zero active lifecycles,
aligned pins and a scheduler heartbeat younger than five minutes.

At 2026-09-16T05:49:43Z the strict current-pin cohort audit was 2/500 at the
immutable boundary 2026-08-30T08:28:35Z. The status-only count of 340 is not
strict credit. No milestone record is warranted.
