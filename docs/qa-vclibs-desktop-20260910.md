# VCLibs Desktop standalone deployment eligibility

Production auto-paused after candidate `2aeaf6a0-71b6-457f-80ca-d49d4fd32051`,
run https://github.com/ugurkocde/IntuneGet-Workflows/actions/runs/34436253877.
Fresh production and GitHub state confirmed zero active lifecycles.

Microsoft.VCLibs.Desktop.14 14.0.33728.0 x64 used PSADT 4.1.8 under
LocalSystem, shared packager `a27749fb895eaa142da413bb6b4b9ebaa5477ad4`,
installer SHA `EEBA62F08531C8669B3E5FB895CE8800AE66D798739CDA2B4AEF2A1D80A5F3C5`,
and profile SHA `F8E6BFEC5EB35835580D8D280716B73505BA9944B79CFDAE839E69020223B975`.
The compact result reports VirusTotal 0/0 and lifecycle 0/0/60001/0.
The bounded PSADT GitHub diagnostic tail identifies `Remove-AppxPackage`
rejecting exact identity
`Microsoft.VCLibs.140.00.UWPDesktop_14.0.33728.0_x64__8wekyb3d8bbwe`
with 0x80073CF3. Independent removal detection remained present.
The permitted local diagnostic was inaccessible; no runner files were accessed.

Official WinGet manifest:
https://github.com/microsoft/winget-pkgs/blob/master/manifests/m/Microsoft/VCLibs/Desktop/14/14.0.33728.0/Microsoft.VCLibs.Desktop.14.installer.yaml
Microsoft documents dependency/update/conflict validation for this error:
https://learn.microsoft.com/en-us/windows/win32/appxpkg/troubleshooting

Use the existing shared `unsupported_managed_uninstall` eligibility gate for
this exact WinGet ID. PR #1123 blocked the different Microsoft.VCLibs.14
identity; this migration addresses the now-observed Desktop failure. Preserve
failed evidence and supersede only never-dispatched queued rows. Do not remove
dependent applications or bypass Windows framework validation.

Executable QA demand and customer package route tests cover this ID: no
dependency resolution or candidate creation, and HTTP 409 before preflight,
job creation, or customer GitHub payload dispatch. No adapter/profile/generator
change is needed. The shared packager pin remains unchanged.

Apply only after protected merge and required CI. Verify the production block,
deployment, and zero active lifecycles; refresh enqueue and resume only with
matching required/scheduler pins and a fresh heartbeat. The blocked exact
app/version/architecture must not be dispatched for another unsafe removal.

The immutable cohort boundary remains 2026-08-30T08:28:35Z. The status helper's
182 is a status-only total, not strict proof; audit exact evidence and VirusTotal
0/0 before reporting progress or writing a milestone.
