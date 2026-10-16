param([Parameter(Mandatory = $true)][string]$ToolsDir)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'tool-integrity.ps1')
$manifest = Get-PackagerToolManifest
Assert-PackagerRegularPath $ToolsDir
[void][IO.Directory]::CreateDirectory([IO.Path]::GetFullPath($ToolsDir))
$exe = Join-Path $ToolsDir $manifest.intuneWinAppUtil.fileName
if (-not (Test-Path -LiteralPath $exe)) {
    Save-VerifiedPackagerDownload $manifest.intuneWinAppUtil.url $exe $manifest.intuneWinAppUtil.sha256
}
Assert-PackagerFileHash $exe $manifest.intuneWinAppUtil.sha256
$archive = Join-Path $ToolsDir $manifest.psadtTemplate.archiveName
if (-not (Test-Path -LiteralPath $archive)) {
    Save-VerifiedPackagerDownload $manifest.psadtTemplate.url $archive $manifest.psadtTemplate.sha256
}
Initialize-VerifiedPsadt $ToolsDir $manifest
Write-Host 'Packaging tools match the pinned release.'
