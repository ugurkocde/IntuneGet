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

Next: protected PR checks and merge, production activation and workflow pins,
guarded release pin update with zero active lifecycles, fresh scheduler
heartbeat, exact Acrobat retry before general queue continuation.
