param([Parameter(Mandatory=$true)][string]$Verifier)
$ErrorActionPreference = 'Stop'
. $Verifier
Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$root = Join-Path $temporaryRoot ('intuneget-integrity-test-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$links = @()
$script:checks = 0
function Assert-True($Value, [string]$Message) { if (-not $Value) { throw $Message }; $script:checks++ }
function Assert-Refused([scriptblock]$Action) {
    $refused = $false
    try { & $Action } catch { $refused = $true }
    Assert-True $refused 'Unsafe fixture was accepted'
}
function New-Fixture($Names = @('Invoke-AppDeployToolkit.exe','PSAppDeployToolkit/Module.psm1','Config/settings.psd1')) {
    $dir = Join-Path $root ([Guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($dir)
    $archive = Join-Path $dir 'PSAppDeployToolkit_Template_v4.zip'
    $zip = [IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Names) {
            $entry = $zip.CreateEntry($name)
            $writer = New-Object IO.StreamWriter($entry.Open())
            try { $writer.Write('synthetic inert fixture') } finally { $writer.Dispose() }
        }
    } finally { $zip.Dispose() }
    return @{ Directory=$dir; Archive=$archive; Manifest=@{psadtTemplate=@{archiveName='PSAppDeployToolkit_Template_v4.zip';extractDir='PSAppDeployToolkit';sha256=(Get-PackagerFileSha256 $archive)}} }
}
# All bytes are synthetic. Never invoke a tool executable or make a network call.
function Invoke-WebRequest { throw 'Network use forbidden in integrity tests' }
try {
    $f = New-Fixture
    Initialize-VerifiedPsadt $f.Directory $f.Manifest
    Initialize-VerifiedPsadt $f.Directory $f.Manifest
    Assert-True (Test-Path -LiteralPath (Join-Path $f.Directory 'PSAppDeployToolkit/Invoke-AppDeployToolkit.exe')) 'Clean extraction missing'
    foreach ($change in @('modified','extra-exe','extra-config','missing','extra-dir')) {
        $f = New-Fixture
        Initialize-VerifiedPsadt $f.Directory $f.Manifest
        $tree = Join-Path $f.Directory 'PSAppDeployToolkit'
        switch ($change) {
            'modified' { [IO.File]::WriteAllText((Join-Path $tree 'PSAppDeployToolkit/Module.psm1'),'modified') }
            'extra-exe' { [IO.File]::WriteAllText((Join-Path $tree 'extra.exe'),'inert') }
            'extra-config' { [IO.File]::WriteAllText((Join-Path $tree 'Config/extra.psd1'),'inert') }
            'missing' { Remove-Item -LiteralPath (Join-Path $tree 'Config/settings.psd1') }
            'extra-dir' { [void][IO.Directory]::CreateDirectory((Join-Path $tree 'extra')) }
        }
        Assert-Refused { Initialize-VerifiedPsadt $f.Directory $f.Manifest }
    }
    $f = New-Fixture
    $f.Manifest.psadtTemplate.sha256 = '0' * 64
    Assert-Refused { Initialize-VerifiedPsadt $f.Directory $f.Manifest }
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $f.Directory 'PSAppDeployToolkit'))) 'Bad archive was extracted'
    foreach ($bad in @('../outside','C:/outside','Config/../outside','Config/./outside','Config/a:stream','Config/NUL.txt','Config/trailing.','Config//empty')) {
        $f = New-Fixture @('Invoke-AppDeployToolkit.exe','PSAppDeployToolkit/Module.psm1',$bad)
        Assert-Refused { Initialize-VerifiedPsadt $f.Directory $f.Manifest }
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $f.Directory 'PSAppDeployToolkit'))) 'Unsafe path was extracted'
    }
    $f = New-Fixture @('Invoke-AppDeployToolkit.exe','PSAppDeployToolkit/Module.psm1','psappdeploytoolkit/module.psm1')
    Assert-Refused { Initialize-VerifiedPsadt $f.Directory $f.Manifest }
    if ($env:OS -eq 'Windows_NT') {
        $f = New-Fixture
        Initialize-VerifiedPsadt $f.Directory $f.Manifest
        $target = Join-Path $root 'link-target'
        [void][IO.Directory]::CreateDirectory($target)
        [IO.File]::WriteAllText((Join-Path $target 'retained.fixture'),'inert')
        $link = Join-Path $f.Directory 'PSAppDeployToolkit/link'
        [void](New-Item -ItemType Junction -Path $link -Target $target)
        $links += $link
        Assert-Refused { Initialize-VerifiedPsadt $f.Directory $f.Manifest }
        Assert-True (Test-Path -LiteralPath (Join-Path $target 'retained.fixture')) 'Junction target changed'
    }
    $badCache = Join-Path $root 'bad-cache'
    [void][IO.Directory]::CreateDirectory($badCache)
    [IO.File]::WriteAllText((Join-Path $badCache 'IntuneWinAppUtil.exe'),'modified synthetic bytes')
    Assert-Refused { & (Join-Path ([IO.Path]::GetDirectoryName($Verifier)) 'download-tools.ps1') -ToolsDir $badCache }
    function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing,$ErrorAction); [IO.File]::WriteAllText($OutFile,'bad download') }
    $final = Join-Path $root 'download.fixture'
    Assert-Refused { Save-VerifiedPackagerDownload 'https://example.invalid/inert' $final ('0' * 64) }
    Assert-True (-not (Test-Path -LiteralPath $final)) 'Bad download reached its final name'
    Assert-True (@(Get-ChildItem -LiteralPath $root -Filter '*.part-*').Count -eq 0) 'Partial download remained'
    Write-Output "PASS: $script:checks synthetic integrity checks"
} finally {
    foreach ($link in $links) { if (Test-Path -LiteralPath $link) { [IO.Directory]::Delete($link) } }
    $absolute = [IO.Path]::GetFullPath($root)
    if (-not $absolute.StartsWith($temporaryRoot.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Fixture cleanup outside test root' }
    Remove-Item -LiteralPath $absolute -Recurse -Force
}
