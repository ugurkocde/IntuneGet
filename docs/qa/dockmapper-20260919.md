# DockMapper 1.1.5 exact-payload containment

Production automatically paused for candidate c8cb27b7-6191-4228-9a3a-a03f12d486ff,
run 35460300940. Fresh production and GitHub checks confirmed zero active
lifecycles. PSADT 4.1.8 under LocalSystem returned Failed, exits 0/0/60001/0,
VirusTotal 0/0, packager e79da0398e3cf3c6874e53b6304a2aef54b5770f.

Installer SHA: 2C17B07EA68C59D38FCE1DACCD88F294FF6E018DC2A87355E95771CC0F141D50.
Canonical profile SHA: A2618A5F30CA6CCAC2EA53002F5EF40BE7ED43EAD4D4D762D75A126B050EBBD2.
The read-only audit recomputed the profile SHA and matched the exact result.

The bounded GitHub diagnostic tail records the captured NSIS registration
DockMapper and a missing registered uninstaller beneath SYSTEM's LocalAppData
at DockMapper/uninstall.exe. The generated catch returned 60001 and removal
detection remained positive. Why the executable is absent is not proven.
The ACL-restricted local diagnostic could not be read; no ACL was changed and
the protected runner directory was never accessed.

## Official source evidence

- [WinGet manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/l/luqiangbo/DockMapper/1.1.5/luqiangbo.DockMapper.installer.yaml)
  declares nullsoft, /S, the matching SHA, and no scope.
- [Released Tauri configuration](https://github.com/luqiangbo/dock-mapper/blob/v1.1.5/src-tauri/tauri.conf.json)
  declares productName DockMapper and NSIS installMode currentUser.
- [Released installer hook](https://github.com/luqiangbo/dock-mapper/blob/v1.1.5/src-tauri/windows/installer-hooks.nsh)
  installs the bundled VC runtime; it does not establish a replacement removal route.

No verified LocalSystem removal repair is established. Switching to a signed-in
user cannot satisfy this cohort's LocalSystem contract. Do not guess alternate
uninstall paths, delete files or markers, or weaken removal verification.

## Shared resolution and recovery

After protected merge and required CI, run scripts/qa-dockmapper-quarantine.mjs
with audit then block using the existing production environment. This inserts
only the exact version/architecture/SHA into the existing qa_package_blocks gate.
Both QA demand (either scope) and customer packaging (including overrides) reject
the payload before dispatch. Future versions and different hashes remain eligible.
The failed result stays intact. Only matching undispatched queue rows may be superseded.

The script verifies the exact failure pause, zero active lifecycles, canonical
profile hash, app tuple, packager pin, LocalSystem context, lifecycle exits and
reputation before mutation. Resume also requires the verified shared block and
matching scheduler/required pins with a heartbeat younger than five minutes.
Refresh authenticated enqueue, resume, then dispatch one lifecycle.

This is containment, not an adapter repair or passing retest. The existing
production shared gate consumes the block immediately; no packager change or
pin promotion is needed. Unblocking requires a reviewed shared repair and a
controlled exact-payload retest.

At 2026-09-19T18:26:21Z the strict audit returned 7/500 at immutable boundary
2026-08-30T08:28:35Z, latest strict finish 2026-09-19T17:33:33.950537Z.
The status-only count of 455 is not the requested strict count. No milestone
record is warranted; continuous supervision remains enabled.

Validation: all 181 focused shared eligibility, QA demand/gate and customer
Actions tests passed; the operational script parsed and its production audit
matched the exact failed evidence. Protected CI supplies full-suite, lint and
production-build verification before merge.
