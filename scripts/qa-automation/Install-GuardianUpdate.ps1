[CmdletBinding()]
param([Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$destinationRoot = [IO.Path]::GetFullPath($Destination)
if ((Split-Path -Leaf $destinationRoot) -ne '.codex-qa-guardian' -or -not (Test-Path -LiteralPath $destinationRoot -PathType Container)) {
    throw 'Destination must be the existing .codex-qa-guardian directory.'
}
$files = @('qa-control.mjs', 'qa-status.mjs', 'recovery.mjs', 'repair-process.mjs',
    'qa-guardian-prompt.md', 'Invoke-IntuneGetQaSupervisor.ps1', 'Invoke-IntuneGetQaRepairAgent.ps1')
foreach ($name in $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot $name) -PathType Leaf)) { throw "Missing managed source: $name" }
}
$mutex = [Threading.Mutex]::new($false, 'Local\IntuneGetQaSupervisor')
$owned = $false
try {
    $owned = $mutex.WaitOne(30000)
    if (-not $owned) { throw 'The controller is busy; retry after its current cycle.' }
    $backup = Join-Path $destinationRoot ('backup-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $backup | Out-Null
    foreach ($name in $files) {
        $target = Join-Path $destinationRoot $name
        if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination (Join-Path $backup $name) }
        Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $target -Force
        if ((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath (Join-Path $sourceRoot $name)).Hash) {
            throw "Installed file verification failed: $name"
        }
    }
    Write-Output "Installed $($files.Count) verified guardian files. Previous versions retained in $backup."
} finally {
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
