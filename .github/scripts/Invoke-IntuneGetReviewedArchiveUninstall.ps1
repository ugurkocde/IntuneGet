[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$ArchivePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$configPath = Join-Path $PSScriptRoot 'ReviewedArchiveUninstall.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw 'The reviewed archive uninstall configuration is missing.'
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -ErrorAction Stop
$relativePath = ([string]$config.relativePath).Trim().Replace('/', '\')
$relativeSegments = @($relativePath -split '\\')
if ([string]::IsNullOrWhiteSpace($relativePath) -or
    $relativePath.Length -gt 260 -or
    [IO.Path]::IsPathRooted($relativePath) -or
    $relativePath.StartsWith('\') -or
    $relativeSegments -contains '..' -or
    $relativePath.Contains(':') -or
    $relativePath -notmatch '(?i)\.bat$' -or
    $relativePath -match '[*?"<>|\x00-\x1f]') {
    throw 'The reviewed archive uninstall relative path is unsafe.'
}

$commandArguments = @($config.arguments)
if ($commandArguments.Count -gt 20) {
    throw 'The reviewed archive uninstall contains too many arguments.'
}
foreach ($commandArgument in $commandArguments) {
    if ($commandArgument -isnot [string] -or
        [string]::IsNullOrWhiteSpace($commandArgument) -or
        $commandArgument.Length -gt 128 -or
        $commandArgument -notmatch '^[A-Za-z0-9._:=,+{}-]+$') {
        throw 'A reviewed archive uninstall argument is unsafe.'
    }
}

$resolvedArchivePath = [IO.Path]::GetFullPath(
    [Environment]::ExpandEnvironmentVariables($ArchivePath)
)
if ([IO.Path]::GetExtension($resolvedArchivePath) -ine '.zip' -or
    -not (Test-Path -LiteralPath $resolvedArchivePath -PathType Leaf)) {
    throw 'The reviewed archive uninstall source is missing or is not a ZIP archive.'
}

$extractRoot = [IO.Path]::Combine(
    $env:TEMP,
    'IntuneGet_ReviewedUninstall_' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
)

try {
    $null = New-Item -Path $extractRoot -ItemType Directory -Force
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $stageRoot = [IO.Path]::GetFullPath($extractRoot)
    $stageRootPrefix = $stageRoot.TrimEnd([char[]]@('\', '/')) + [IO.Path]::DirectorySeparatorChar
    $archive = [IO.Compression.ZipFile]::OpenRead($resolvedArchivePath)
    try {
        foreach ($entry in $archive.Entries) {
            $entryRelativePath = $entry.FullName.Replace('/', [IO.Path]::DirectorySeparatorChar)
            if ([string]::IsNullOrWhiteSpace($entryRelativePath)) { continue }
            if ($entryRelativePath.Contains(':')) {
                throw "Archive entry contains an unsupported path: $($entry.FullName)"
            }
            $targetPath = [IO.Path]::GetFullPath(
                [IO.Path]::Combine($stageRoot, $entryRelativePath)
            )
            if ($targetPath -ne $stageRoot -and
                -not $targetPath.StartsWith($stageRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Archive entry escapes the reviewed uninstall directory: $($entry.FullName)"
            }
            if ([string]::IsNullOrEmpty($entry.Name)) {
                $null = New-Item -Path $targetPath -ItemType Directory -Force
                continue
            }
            $targetDirectory = [IO.Path]::GetDirectoryName($targetPath)
            if ($targetDirectory) {
                $null = New-Item -Path $targetDirectory -ItemType Directory -Force
            }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)
        }
    }
    finally {
        if ($archive) { $archive.Dispose() }
    }

    $batchPath = [IO.Path]::GetFullPath((Join-Path $stageRoot $relativePath))
    if (-not $batchPath.StartsWith($stageRootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $batchPath -PathType Leaf)) {
        throw "The reviewed uninstall batch file was not found in the package archive: $relativePath"
    }

    Write-Output "Executing reviewed archive uninstall batch [$relativePath]."
    & $batchPath @commandArguments
    $batchExitCode = $LASTEXITCODE
    if ($batchExitCode -notin @(0, 1641, 3010)) {
        throw "The reviewed archive uninstall batch exited with code [$batchExitCode]."
    }
}
finally {
    if (Test-Path -LiteralPath $extractRoot) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

exit $batchExitCode
