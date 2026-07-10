[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$')]
    [string]$WingetId,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedVersion,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date
$installedByScan = $false
$result = [ordered]@{
    winget_id = $WingetId
    version = $ExpectedVersion
    scanned_at = $startedAt.ToUniversalTime().ToString('o')
    status = 'failed'
    error = $null
    registry_changes = @{ added = @(); app_registry_entry = $null }
    file_changes = @{ added = @(); file_count = 0 }
    shortcuts_created = @()
    services_created = @()
    install_path = $null
    uninstall_string = $null
    quiet_uninstall_string = $null
    installed_size_bytes = 0
    os_version = [System.Environment]::OSVersion.VersionString
    architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
}

function Invoke-Winget {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $stdout = Join-Path $env:TEMP "winget-$([Guid]::NewGuid()).out"
    $stderr = Join-Path $env:TEMP "winget-$([Guid]::NewGuid()).err"
    try {
        $process = Start-Process -FilePath (Get-Command winget).Source -ArgumentList $Arguments `
            -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            return @{ ExitCode = -1; TimedOut = $true; Output = "Timed out after $TimeoutSeconds seconds" }
        }
        $output = @(
            Get-Content -LiteralPath $stdout -Raw -ErrorAction SilentlyContinue
            Get-Content -LiteralPath $stderr -Raw -ErrorAction SilentlyContinue
        ) -join "`n"
        return @{ ExitCode = $process.ExitCode; TimedOut = $false; Output = $output.Trim() }
    } finally {
        Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
    }
}

try {
    $existing = Invoke-Winget -Arguments @('list', '--id', $WingetId, '--exact', '--accept-source-agreements', '--disable-interactivity') -TimeoutSeconds 90
    if ($existing.ExitCode -eq 0 -and $existing.Output -notmatch 'No installed package found') {
        $result.status = 'skipped'
        $result.error = 'preexisting_on_runner'
        Write-Warning "$WingetId is already installed on the runner; refusing to produce a contaminated snapshot"
    } else {
        $baseline = & "$PSScriptRoot\snapshot.ps1" -Mode baseline
        $timeout = [int]($env:APP_TIMEOUT_SECONDS ?? 900)
        $install = Invoke-Winget -Arguments @(
            'install', '--id', $WingetId, '--exact', '--silent',
            '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
        ) -TimeoutSeconds $timeout

        if ($install.TimedOut) { throw "Installation timed out after $timeout seconds" }
        if ($install.ExitCode -ne 0) { throw "WinGet install failed with exit code $($install.ExitCode): $($install.Output)" }
        $installedByScan = $true

        Start-Sleep -Seconds 5
        $appNameHint = $WingetId.Split('.')[-1]
        $changes = & "$PSScriptRoot\snapshot.ps1" -Mode analyze -Baseline $baseline -AppName $appNameHint
        if (-not $changes.app_found) { throw 'Installation succeeded but no application registry entry was detected' }
        if ($changes.app_registry_entry.detection_method -ne 'new_key') {
            throw "Detected registry entry was not created by this installation ($($changes.app_registry_entry.detection_method))"
        }

        $result.version = if ($changes.version) { $changes.version } else { $ExpectedVersion }
        $result.install_path = $changes.install_path
        $result.uninstall_string = $changes.uninstall_string
        $result.quiet_uninstall_string = $changes.quiet_uninstall_string
        $result.file_changes = @{ added = @($changes.files); file_count = $changes.file_count }
        $result.shortcuts_created = @($changes.shortcuts_created)
        $result.services_created = @($changes.services_created)
        $result.installed_size_bytes = $changes.total_size_bytes
        $result.registry_changes = @{ added = @($changes.all_new_entries); app_registry_entry = $changes.app_registry_entry }
        $result.status = 'completed'
    }
} catch {
    $result.status = 'failed'
    $result.error = $_.Exception.Message
    Write-Error $_
} finally {
    if ($installedByScan) {
        $uninstall = Invoke-Winget -Arguments @('uninstall', '--id', $WingetId, '--exact', '--silent', '--disable-interactivity') -TimeoutSeconds 300
        if ($uninstall.ExitCode -ne 0) {
            $cleanupMessage = "Cleanup failed with exit code $($uninstall.ExitCode)"
            if ($result.status -eq 'completed') {
                $result.status = 'failed'
                $result.error = $cleanupMessage
            } else {
                $result.error = "$($result.error); $cleanupMessage"
            }
        }
    }

    $result.scan_duration_seconds = [int]((Get-Date) - $startedAt).TotalSeconds
    $result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM
}

if ($result.status -eq 'failed') { exit 1 }
