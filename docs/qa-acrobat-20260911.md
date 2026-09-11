# Acrobat archive identity repair

Production candidate `f8d5e099-cf31-4cc7-a454-8235f838441d`, run
`34615842886`, failed on Acrobat Pro `26.002.21901` x64. The pipeline
automatically paused and had zero active lifecycles at 15:43 UTC.

The ZIP bootstrapper returned 0. Post-install capture then rejected the
registration `Adobe Acrobat (64-bit)`, MSI key
`{AC76BA86-1033-FFFF-7760-BC15014EA700}`, version `26.002.21901`.
The canonical profile carried `REGISTRY_UNINSTALL:Adobe Acrobat Pro` even
though the official WinGet manifest supplied that exact MSI product code.
The shared ZIP command generator preserved codes for MSI/WiX but discarded
them for EXE-family nested installers. Preserve canonical MSI GUIDs for those
families too; retain existing named-key adapters and portable/AppX behavior.

Sources:
- https://github.com/microsoft/winget-pkgs/blob/master/manifests/a/Adobe/Acrobat/Pro/26.002.21901/Adobe.Acrobat.Pro.installer.yaml
- https://www.adobe.com/devnet-docs/acrobatetk/tools/DesktopDeployment/singleinstaller.html
- https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34615842886

The exact failed installer SHA is
`ECE5D3816C32DE1374B1D228B04D01ABB1621A7AEA6D61728D97A65718053035`.
Required and scheduler pin were
`6bdefc387d1402c71d30a6fbfcf850038f60f37a`.
The failed result has VirusTotal `not_found` with null verdict counts; it
cannot qualify as a strict pass without subsequent zero/zero evidence.

Regression coverage includes shared command generation, normalized catalog
QA, customer workflow payload, and generated PowerShell identity selection
against synthetic Acrobat and Reader registrations. No installer is executed
outside the isolated QA VM.

The guardian status script reported 197 for the immutable cohort boundary
`2026-08-30T08:28:35Z`, but only filters passed candidate status. A read-only
exact-result audit at 15:52 UTC found one distinct post-boundary app on the
current exact pin with matching hashes, 0/0/0/1 lifecycle, LocalSystem and
VirusTotal 0/0: `WithSecure.ElementsAgent`. This distinction must remain
explicit; the 500 milestone has not been met.

## Production resolution

Shared repair PR #1144 merged as `7238616608f888449fa2e132fffc8d7314c26745`.
All required CI passed; the local full suite passed 1,833 tests, lint and the
production build. Activation PR #1145 merged as
`2179a04f294bba081649b113ad5fe2f6fe61ec00`, including conservative rejection of
old archive display-fallback compatibility and reviewed retry targets.
Workflow PR IntuneGet-Workflows#3473 merged as
`d992874565d8bd2d56f76468676f4ad8932213a0`. Production deployment
`dpl_5n9CeKqhHTMU7JRhgmwMQh33828G` reached READY. The repair changelog publisher
succeeded and its public feed entry was verified.

Required, scheduler, QA and customer pins all equal the protected repair
commit. Only 103 undispatched, unassigned old-pin queued rows were superseded.

Authenticated targeted enqueue attempted the exact Acrobat retry after
deployment. It returned unavailable: the live metadata resolver selected a
`2020` directory and reported `installer_manifest_missing`. The original
exact WinGet manifest remains available through GitHub. No new VM lifecycle
was started, and no repaired runtime pass is claimed.

Fresh production cache evidence also still shows VirusTotal `not_found`
with null malicious/suspicious counts for the exact ZIP. At
`2026-09-11T16:16:31.762Z`, the exact version/architecture/installer SHA was
blocked as `unverified_file_reputation` in the existing shared
`qa_package_blocks` gate. This blocks both customer packaging and QA without
excluding future corrected installer tuples or inventing a clean verdict.
The original failed result remains preserved.

Production resumed only after block readback, zero active lifecycles, and
fresh matching required/scheduler pins. General enqueue was invoked to keep
scanning eligible applications. The 500 milestone remains incomplete. At
the new exact pin the strict count must be recalculated; the legacy status
script's 197 is not an authoritative strict count.
