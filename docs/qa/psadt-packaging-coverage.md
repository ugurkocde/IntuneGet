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
| VM verified | The exact generated PSADT package passed install, detection, uninstall, and post-uninstall detection as LocalSystem in the golden VM. |
| UI verified | Interactive behavior and dialog evidence were also verified in a logged-on user session. |

## Current coverage

| Area | Shapes/options | Current evidence | Remaining work |
| --- | --- | --- | --- |
| Catalog default | Silent LocalSystem install, generated detection, uninstall, compact evidence | VM verified for nested ZIP portable with PIICrawler CLI | Add representative VM fixtures for each installer family. |
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
| 2026-08-08 | A stale TeamViewer deployment profile supplied `-Archive -Path` as MSI arguments although the authoritative Winget manifest only declared `InstallerSwitches.InstallLocation`. The MSI stalled and never created its expected log. | Stale/incorrect IntuneGet package profile; vendor not at fault | Old candidate failed in [run 31256080001](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31256080001). Must be regenerated with the current catalog builder and rerun before closing. |
| 2026-08-08 | The dispatcher accepted queued PSADT profiles created by an obsolete packager or without a verifiable profile identity. | QA orchestration defect | Thirty stale queued candidates were superseded. The hardening patch verifies schema version, canonical hash, candidate binding, and every pinned toolchain field before claim. |
| 2026-08-08 | Automated catalog candidates inherited a 60-minute timeout for each install, detection, and uninstall phase; smoke tests alone used ten minutes. | Capacity/recovery defect | Separate patch required. Use phase-specific limits and retain logs before golden rollback. |
| 2026-08-08 | A full packager checkout consumed roughly 1.5-2.5 minutes in otherwise short runs. | Throughput opportunity | Evaluate sparse checkout or a small immutable, hash-verified toolchain artifact. |
| 2026-08-08 | Current package-level tests focus on nested portable behavior; most website PSADT customizations have generator code but no generated-script or VM matrix. | Coverage gap | Open. Build fixture-driven generator assertions first, then interactive VM scenarios for UI behavior. |
| 2026-08-08 | HanaAgent 0.444.1 is a user-scope Nullsoft profile (`/S /currentuser`) but QA executes as LocalSystem. Installation returned 0, while the generated HKCU marker detection returned 1 and uninstall returned 60001. | Scope/context packaging or QA-model defect; vendor not yet implicated | Failed in [run 31257980483](https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/31257980483). Reproduce which user hive receives the app and marker, then define separate LocalSystem/machine and logged-on-user/user-scope QA semantics. |

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
