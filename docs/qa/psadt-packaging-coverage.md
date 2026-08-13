# PSADT packaging coverage and findings

This document is the durable audit log for IntuneGet's PSAppDeployToolkit package generator and QA runner. A UI option is not considered fully supported until it is propagated into the package profile, rendered as valid PSADT syntax, exercised in the generated package, and covered by an automated test.

## Normative version and references

- Pinned toolkit: PSAppDeployToolkit 4.1.8
- Release: <https://github.com/PSAppDeployToolkit/PSAppDeployToolkit/releases/tag/4.1.8>
- 4.1 reference: <https://psappdeploytoolkit.com/docs/4.1.x/reference>
- `Start-ADTMsiProcess`: <https://psappdeploytoolkit.com/docs/4.1.x/reference/functions/Start-ADTMsiProcess>
- Deployment structure: <https://psappdeploytoolkit.com/docs/4.1.x/deployment-concepts/deployment-structure>
- Deployment CLI: <https://psappdeploytoolkit.com/docs/4.1.x/usage/how-to-deploy>

The pinned template URL and SHA-256 are part of the package profile identity. A changed configuration, detection rule, installer, architecture, or installer switch automatically creates a different identity when the profile is built. A code change to default settings or profile/detection derivation must also increment `QA_PACKAGE_PROFILE_SCHEMA_VERSION` and the protected workflow verifier in the same rollout; changing the toolkit, template, or packaging code requires updating its corresponding toolchain pin. The dispatcher rejects the old identity until a new test is queued.

Catalog-default profiles are rebuilt in bounded batches by the WinGet poller. Deployment-config profiles are rebuilt from the customer's effective deployment settings each time the auto-update policy is evaluated, before the exact-profile release gate is checked. The catalog poller intentionally does not replace customized deployment profiles with catalog defaults.

The protected workflow treats `packageProfileCanonicalJson` as the executable source of truth after verifying its SHA-256, schema version, toolchain pins, release tuple, and embedded configuration/detection hashes. Duplicate convenience fields in the outer `test_config` object are not used to generate or execute the package.

## Support definition

| Level | Meaning |
| --- | --- |
| Implemented | A generator path exists, but complete generated-package verification is not yet present. |
| Unit covered | Generator output is asserted without executing the complete package. |
| VM verified | The exact generated PSADT package passed install, detection, uninstall, and post-uninstall detection in its declared LocalSystem or standard-user execution context in the golden VM. |
| UI verified | Interactive behavior and dialog evidence were also verified in a logged-on user session. |

## Current coverage

| Area | Shapes/options | Current evidence | Remaining work |
| --- | --- | --- | --- |
| Catalog default | Silent LocalSystem install, generated detection, uninstall, compact evidence | VM verified for nested ZIP portable with PIICrawler CLI | Add representative VM fixtures for each installer family. |
| User execution context | Silent user-scope install, disposable standard-user profile, HKCU/LocalAppData evidence, generated detection and uninstall | VM verified for NextAI Translator, QontrolPanel, and SecureSafe Files; every run restored the golden checkpoint after copying evidence | PowerShell Direct is non-interactive. Windows optional features are not collected, and ACL-protected machine registry, file, task, and driver details may be omitted; zero counts therefore apply only to evidence visible to the standard-user collector. Add a separate logged-on-user lane before claiming UI or interactive-installer fidelity, and verify shared log-directory ACLs across mixed machine/user deployments. |
| MSI/Wix | MSI file, product-code uninstall, nested MSI in ZIP, extra MSI properties | Implemented | Assert that only `Silent`, `SilentWithProgress`, and `Custom` become execution arguments; `InstallLocation` must be substituted deliberately, never treated as a silent switch. Add MSI/product-code VM fixtures. |
| EXE families | Generic EXE, Inno, Nullsoft, Burn | Implemented | Add generated-command tests and one VM fixture per family, including non-zero success/reboot exit codes. |
| Archives | ZIP with nested installer paths and zip-slip protection | Unit covered for nested portable | Cover multiple nested files, nested MSI/EXE, Unicode paths, spaces, very long paths, duplicate names, and malformed archives. |
| Portable | Top-level and nested portable, machine/user scope, cleanup | Unit covered; nested machine-scope path VM verified | Add user-scope and command-alias fixtures plus upgrade-over-existing-version behavior. |
| MSIX/AppX | MSIX/AppX/package-family detection and uninstall | Implemented | Add signed bundle, dependency, per-user/provisioned, and certificate failure fixtures. |
| Custom commands | Install/uninstall overrides and ordered post-install/post-uninstall commands | Implemented | Add quoting, spaces, Unicode, exit-code propagation, and command-injection boundary tests. |
| Detection | Registry, file/folder, MSI, script, marker path, version operators, 32-bit registry view | Implemented | Add an exact rule matrix and verify that detection changes alter the profile hash and runtime result. |
| Process handling | Processes to close, close prompt/countdown, block execution, save prompt, forced close, persistent prompt | Implemented | Add generated-script assertions and interactive VM evidence. |
| Deferral | Count, deadline, days | Implemented | Verify precedence/invalid combinations and persistence across repeated runs. |
| UI | Deploy mode, progress, window location, custom prompts at four timings, restart prompt, balloon tips | Implemented | Add an interactive QA mode with screenshots and session-aware assertions; catalog-default silent runs intentionally do not prove UI behavior. |
| Branding/assets | Company/title/message, accent, light/dark logos, banner | Implemented | Validate file existence/type/size, package inclusion, config rendering, dark mode, and screenshots. |
| Lifecycle | Remove existing install, install verification, restart behavior, disk-space check | Implemented | Add upgrade, repair/reinstall, reboot-required, low-disk, and ARP-less application fixtures. |

## Findings

| Date | Finding | Classification | Status/evidence |
| --- | --- | --- | --- |
| 2026-08-08 | ZIP packages containing a nested portable executable were rejected by both packaging engines. | IntuneGet packager defect | Fixed in packager commit `70685a9a689b7cdeb4edba8ec5eadd1cc8bb2cc5`; PIICrawler CLI 26.0807.2256 passed install/detect/uninstall/detect-absent in [run 31257215383](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31257215383). |
| 2026-08-09 | User-scope PSADT packages exited with 60008 before logging because `RequireAdmin = $false` selects the non-admin log path, whose ProgramData parent was not writable by a standard user. | IntuneGet packager defect | Fixed in packager commit `9ebba1be54817ab79e6efe60792d5a738415df0e` by setting `Toolkit.LogPathNoAdminRights` to the current user's LocalAppData; exact-profile QA rerun required. |
| 2026-08-09 | PSADT initialization failures (`60008`) occurred before the toolkit logger opened, leaving the QA watchdog without the underlying exception. | Diagnostics gap | Fixed in packager commit `ed0f960326c4bc97c9f86dd20e2c34827928f979` by persisting a scope-appropriate bootstrap log while preserving standard PSADT exit behavior. |
| 2026-08-08 | A stale TeamViewer deployment profile supplied `-Archive -Path` as MSI arguments although the authoritative Winget manifest only declared `InstallerSwitches.InstallLocation`. The MSI stalled and never created its expected log. | Stale/incorrect IntuneGet package profile; vendor not at fault | Old candidate failed in [run 31256080001](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31256080001). Must be regenerated with the current catalog builder and rerun before closing. |
| 2026-08-08 | The dispatcher accepted queued PSADT profiles created by an obsolete packager or without a verifiable profile identity. | QA orchestration defect | Thirty stale queued candidates were superseded. The hardening patch verifies schema version, canonical hash, candidate binding, and every pinned toolchain field before claim. |
| 2026-08-08 | Automated catalog candidates inherited a 60-minute timeout for each install, detection, and uninstall phase; smoke tests alone used ten minutes. | Capacity/recovery defect | Separate patch required. Use phase-specific limits and retain logs before golden rollback. |
| 2026-08-08 | A full packager checkout consumed roughly 1.5-2.5 minutes in otherwise short runs. | Throughput opportunity | Evaluate sparse checkout or a small immutable, hash-verified toolchain artifact. |
| 2026-08-08 | Current package-level tests focus on nested portable behavior; most website PSADT customizations have generator code but no generated-script or VM matrix. | Coverage gap | Open. Build fixture-driven generator assertions first, then interactive VM scenarios for UI behavior. |
| 2026-08-08 | HanaAgent 0.444.1 is a user-scope Nullsoft profile (`/S /currentuser`) but the old QA path executed it as LocalSystem. Installation returned 0, while the generated HKCU marker detection returned 1 and uninstall returned 60001. | QA execution-context defect; vendor not implicated by this run | The obsolete result is [run 31257980483](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31257980483). Resolved by scope-aware execution in IntuneGet-Workflows PR 71; the correct-context rerun is tracked separately below. |
| 2026-08-08 | The first scope-aware runner used a credentialed child process inside an administrator PowerShell Direct session. Real user-scope packages exited before producing a status report. | QA infrastructure defect | Fixed in IntuneGet-Workflows PR 71 by opening the PowerShell Direct job directly as a disposable standard user. Windows PowerShell 5.1 contracts, LocalSystem and User VM smokes, and four real catalog profiles then ran with the expected identity. |
| 2026-08-08 | HanaAgent 0.444.1 reached the vendor Nullsoft installer in the correct `INTUNE-QA\IntuneQAUser` context, but the installer crashed with `0xC0000005`. Detection returned 1 and registry-driven uninstall returned PSADT 60001 because no valid installation was registered. | Primary class: `install`; vendor versus non-interactive-session attribution pending | Failed in [run 31264842102](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31264842102). Reproduce in a logged-on disposable-user session with the same `/S /currentuser` arguments before changing the package profile or classifying it as vendor-owned. |
| 2026-08-08 | NextAI Translator 0.6.35 passed install, detection, uninstall, and detect-absent as the disposable standard user, but post-uninstall evidence still counted one uninstall entry, ten registry values, 34 file-system items, and two shortcuts. | Primary class: `cleanup`; the persistent uninstall entry and shortcuts are strong package-residue signals, while compact counts cannot attribute the registry values and file items | Passed in [run 31264420897](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31264420897). Keep the public JSON compact, but use a local/on-demand diagnostic rerun to identify the residual paths before treating the package as clean. |
| 2026-08-08 | QontrolPanel 1.20.2 passed all user-scope phases. The standard-user collector reported zero uninstall-entry, registry-value, and shortcut residue, while file evidence counted 38 added and 14 changed items; ACL-protected machine locations may be omitted. | Potential `cleanup` observation, not a phase failure; package residue versus background churn not yet attributed | Passed in [run 31265262455](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31265262455). Attribute paths in a diagnostic rerun before changing packaging. |
| 2026-08-08 | SecureSafe Files 1.1.1 passed all user-scope phases. The standard-user collector reported zero uninstall-entry and shortcut residue, four changed registry values, and file-system counts of 132 added, 106 removed, and 21 changed after uninstall; ACL-protected machine locations may be omitted. | Potential `cleanup` observation, not a phase failure; package residue versus background churn not yet attributed | Passed in [run 31265680813](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31265680813). Attribute paths in a diagnostic rerun before changing packaging. |
| 2026-08-08 | User-scope packaging overrides PSADT logs to `C:\ProgramData\IntuneGet\Logs`, but QA does not yet assert that the location remains writable when a prior machine-scope deployment created the parent with different ACL inheritance. | Mixed-scope packaging edge case | The three successful user-scope runs prove the clean-VM case only. Add an ACL-order fixture (machine package first, user package second) and capture the PSADT log result locally. |
| 2026-08-09 | FadeIn installed and detected successfully, but its configured catalog name did not match the vendor Add/Remove Programs entry. The generated uninstall then invoked WinGet as LocalSystem, which terminated with `0xC0000135`. | IntuneGet `uninstall` package-generation defect, not a vendor install failure | Fixed in packager commit `686a469295bccb66daeff0cdc59961b4a9ff2022`: compare PSADT application-registry snapshots across installation, persist the exact vendor uninstall key, and pass the matching object to `Uninstall-ADTApplication -InstalledApplication`. The unsupported WinGet-under-LocalSystem fallback was removed. |
| 2026-08-09 | Python 3.14.7 installed and detected, but its Burn registration pointed to a missing LocalSystem `%LOCALAPPDATA%\Package Cache` executable. PSADT derived that missing directory as the process working directory and returned `60001` before the vendor uninstaller launched. | IntuneGet `uninstall` package-generation defect, not a vendor uninstall failure | Failed in [run 31334651309](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31334651309). Fixed in packager commit `e7c263d5703884ca3e0507c7b0165b882ce9e61d`: require the exact registered Burn entry, preserve its quiet arguments, and execute the hash-verified bundle retained in the PSADT payload with an explicit valid working directory. Verified in [run 31336481664](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31336481664): install, post-install detection, uninstall, detect-absent verification, cleanup, and golden-checkpoint restoration all passed. |
| 2026-08-09 | Sourcegraph Amp installed successfully and PSADT wrote the expected registry marker, but detection failed because the opaque WinGet version `0.0.1786233956-g40887a` was configured as a strict registry `version` comparison. | IntuneGet `detection` rule-generation defect, not a vendor install failure | Registry marker rules now use version comparison only for two-to-four-part Windows-compatible numeric versions. Opaque versions use exact string equality, preserving release-specific detection without rejecting a valid marker. |
| 2026-08-10 | Vivaldi 8.1.4087.62 installed silently and detection passed, but the vendor only registered an interactive `setup.exe --uninstall --vivaldi` command. PSADT correctly fell back to that `UninstallString`, which opened a confirmation dialog and triggered the no-activity watchdog. | IntuneGet `uninstall` package-generation defect, not a vendor install failure | Failed in [run 31368275187](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31368275187). The packager now retains PSADT's `QuietUninstallString` preference and, only when it is absent, appends narrowly verified unattended arguments for Vivaldi (`--force-uninstall`) and manifest-identified Inno/Nullsoft uninstallers through PSADT's documented `-AdditionalArgumentList`. Exact-profile QA rerun required. |

## Failure classification

Every failed run should be assigned one primary class before it is shown as a vendor failure:

1. `profile-integrity`: stale/mismatched profile, toolchain, template, config, or hashes.
2. `package-generation`: invalid PSADT syntax, wrong switches, missing payload, unsafe archive handling, or bad quoting.
3. `install`: correctly generated package reached the vendor installer and the installer failed or timed out.
4. `detection`: install succeeded but the exact Intune detection rules did not match.
5. `uninstall`: installed state was detected but the generated/vendor uninstall failed.
6. `cleanup`: uninstall completed but unexpected residual state remained.
7. `infrastructure`: VM, runner, network, checkpoint, evidence collection, or publication failed.

Only classes 3 and vendor-owned portions of 5 should normally be presented as vendor-specific. Classes 1, 2, 4, 6, and 7 are actionable IntuneGet engineering signals unless investigation proves otherwise.

## Next coverage increments

1. Add generated-script golden tests for every field in `PSADTConfig`, in both the GitHub PowerShell generator and the self-hosted TypeScript packager.
2. Add representative fixtures for MSI/Wix, Inno, Nullsoft, Burn, generic EXE, MSIX/AppX, top-level portable, nested portable, and nested MSI/EXE archives.
3. Add an interactive QA lane for non-silent profiles with PSADT dialog screenshots; keep it separate from high-throughput catalog-default silent QA.
4. Record the failure class and remediation state in compact QA JSON so the web UI can distinguish "vendor install failed" from "IntuneGet packaging issue found/fixed/retest pending."
5. Require a passing rerun of the new immutable profile before a remediation is marked verified or an automatic tenant update is released.
6. Define and test user-scope behavior explicitly: install context, target user hive/profile, detection context, uninstall context, and how Intune assignment context maps to each one. Do not treat an HKCU failure under LocalSystem as a vendor failure.
7. Add a local/on-demand residual-attribution mode that retains detailed registry, file, service, task, shortcut, and PSADT-log paths only for engineering triage; keep the committed per-app JSON count-only.
8. Add a logged-on disposable-user lane for interactive installers and PSADT dialogs. PowerShell Direct user tests remain the high-throughput silent lane and must not be labeled UI verified.
9. Test the shared `C:\ProgramData\IntuneGet\Logs` ACL in both deployment orders: machine then user, and user then machine.
