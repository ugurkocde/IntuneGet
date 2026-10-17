[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$')]
    [string]$WingetId,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._+\-]*$')]
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

function Select-ScannerTimeoutProcesses {
    param([object[]]$Rows, [int]$RootProcessId, [long]$RootStartedUtcTicks)

    # CIM creation times have microsecond precision; Process.StartTime is finer.
    $rootTicks = $RootStartedUtcTicks - ($RootStartedUtcTicks % 10)
    $root = $Rows | Where-Object {
        $_.ProcessId -eq $RootProcessId -and $_.CreationDate -and
        ($_.CreationDate.ToUniversalTime().Ticks - ($_.CreationDate.ToUniversalTime().Ticks % 10)) -eq $rootTicks
    } | Select-Object -First 1
    if (-not $root -or $RootStartedUtcTicks -le 0) { return $null }

    $queue = [Collections.Generic.Queue[object]]::new()
    $queue.Enqueue(@{ Row = $root; Depth = 0 })
    $seen = [Collections.Generic.HashSet[int]]::new()
    [void]$seen.Add($RootProcessId)
    $children = [Collections.Generic.List[object]]::new()
    $truncated = $false
    while ($queue.Count) {
        $parent = $queue.Dequeue()
        foreach ($row in $Rows) {
            if ($row.ParentProcessId -ne $parent.Row.ProcessId -or -not $row.CreationDate -or
                $row.CreationDate.ToUniversalTime() -lt $parent.Row.CreationDate.ToUniversalTime() -or
                $seen.Contains([int]$row.ProcessId)) { continue }
            if ($parent.Depth -ge 4 -or $children.Count -ge 16) { $truncated = $true; continue }
            [void]$seen.Add([int]$row.ProcessId)
            $child = @{ Row = $row; Depth = $parent.Depth + 1 }
            $children.Add($child)
            $queue.Enqueue($child)
        }
    }
    return @{ Root = $root; Children = $children.ToArray(); Truncated = $truncated }
}

function Get-ScannerTimeoutCaptureScript {
    param([int]$RootProcessId, [long]$RootStartedUtcTicks)

    # Only typed integers are interpolated. No app metadata or commands enter code.
    $prefix = '$rootId = ' + $RootProcessId + '; $rootTicks = ' + $RootStartedUtcTicks + "`n"
    $selector = 'function Select-ScannerTimeoutProcesses {' + ${function:Select-ScannerTimeoutProcesses}.ToString() + "}`n"
    return $prefix + $selector + @'
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    $rows = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, CreationDate -OperationTimeoutSec 3)
    if ($rows.Count -gt 4096) { throw 'Snapshot bound' }
    $selection = Select-ScannerTimeoutProcesses -Rows $rows -RootProcessId $rootId -RootStartedUtcTicks $rootTicks
    if (-not $selection) { throw 'Root unavailable' }
    $root = [Diagnostics.Process]::GetProcessById($rootId)
    $liveTicks = $root.StartTime.ToUniversalTime().Ticks
    if ($root.HasExited -or ($liveTicks - ($liveTicks % 10)) -ne ($rootTicks - ($rootTicks % 10))) { throw 'Root changed' }
    $imageIsWinget = $root.ProcessName -ieq 'winget'
    $children = @(
        foreach ($entry in $selection.Children) {
            $alive = $null; $window = $null
            try {
                $child = [Diagnostics.Process]::GetProcessById([int]$entry.Row.ProcessId)
                $ticks = $child.StartTime.ToUniversalTime().Ticks
                $expected = $entry.Row.CreationDate.ToUniversalTime().Ticks
                if (-not $child.HasExited -and ($ticks - ($ticks % 10)) -eq ($expected - ($expected % 10))) {
                    $alive = $true
                    $child.Refresh()
                    # A zero handle cannot rule out a hidden prompt or another desktop.
                    if ($child.MainWindowHandle -ne [IntPtr]::Zero) { $window = $true }
                }
            } catch { } finally { if ($child) { $child.Dispose(); $child = $null } }
            @{ depth = [int]$entry.Depth; alive_at_probe = $alive; has_main_window = $window }
        }
    )
    @{ schema = 1; captured = $true; capture_error = $false; root_identity_verified = $true;
       root_alive = $true; root_image_is_winget = [bool]$imageIsWinget; completeness = $false;
       descendant_count = $children.Count; truncated = [bool]$selection.Truncated; children = $children } | ConvertTo-Json -Depth 5 -Compress
} catch {
    '{"captured":false,"capture_error":true}'
} finally { if ($root) { $root.Dispose() } }
'@
}

function ConvertTo-ScannerTimeoutCapture {
    param([string]$Json)
    $value = $Json | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    if ($value -isnot [Collections.IDictionary] -or $value.captured -isnot [bool] -or
        $value.capture_error -isnot [bool] -or -not $value.captured -or $value.capture_error) {
        throw 'Capture unavailable'
    }
    foreach ($key in @('root_identity_verified', 'root_alive', 'root_image_is_winget', 'completeness', 'truncated')) {
        if ($value[$key] -isnot [bool]) { throw 'Invalid boolean' }
    }
    if ($value.schema -isnot [long] -or $value.schema -ne 1 -or -not $value.root_identity_verified -or
        -not $value.root_alive -or $value.completeness -or $value.children -isnot [array] -or
        $value.children.Count -gt 16 -or $value.descendant_count -isnot [long] -or
        $value.descendant_count -ne $value.children.Count) { throw 'Invalid capture shape' }
    $children = @(
        foreach ($entry in $value.children) {
            if ($entry -isnot [Collections.IDictionary] -or $entry.depth -isnot [long] -or $entry.depth -lt 1 -or $entry.depth -gt 4) { throw 'Invalid depth' }
            foreach ($key in @('alive_at_probe', 'has_main_window')) {
                if ($null -ne $entry[$key] -and ($entry[$key] -isnot [bool] -or -not $entry[$key])) { throw 'Invalid observation' }
            }
            @{ depth = [int]$entry.depth; alive_at_probe = $entry.alive_at_probe; has_main_window = $entry.has_main_window }
        }
    )
    # Rebuild instead of serializing helper output, including any unknown keys.
    return @{ schema = 1; captured = $true; capture_error = $false; root_identity_verified = $true;
        root_alive = $true; root_image_is_winget = $value.root_image_is_winget; completeness = $false;
        descendant_count = $children.Count; truncated = $value.truncated; children = $children }
}

function Save-ScannerTimeoutCapture {
    param([Diagnostics.Process]$Process, [long]$StartedUtcTicks)

    $safe = @{ captured = $false; capture_error = $true }
    $stdout = Join-Path $env:TEMP "scanner-timeout-$([Guid]::NewGuid()).out"
    $stderr = Join-Path $env:TEMP "scanner-timeout-$([Guid]::NewGuid()).err"
    $helper = $null
    $watch = [Diagnostics.Stopwatch]::StartNew()
    try {
        if ($StartedUtcTicks -le 0) { throw 'Unverified root' }
        $script = Get-ScannerTimeoutCaptureScript -RootProcessId $Process.Id -RootStartedUtcTicks $StartedUtcTicks
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
        $helper = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) `
            -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        if (-not $helper.WaitForExit([Math]::Max(0, 5000 - [int]$watch.ElapsedMilliseconds))) { throw 'Capture deadline' }
        if ($helper.ExitCode -ne 0 -or (Get-Item -LiteralPath $stdout).Length -gt 16384) { throw 'Invalid helper output' }
        $safe = ConvertTo-ScannerTimeoutCapture -Json (Get-Content -LiteralPath $stdout -Raw)
    } catch { } finally {
        # Never wait for a stuck CIM provider or terminate any observed descendant.
        if ($helper) { try { if (-not $helper.HasExited) { $helper.Kill() } } catch { }; $helper.Dispose() }
        Remove-Item -LiteralPath $stdout, $stderr -Force -ErrorAction SilentlyContinue
    }
    try {
        $directory = Join-Path $env:LOCALAPPDATA 'Packages/Microsoft.DesktopAppInstaller_8wekyb3d8bbwe/LocalState/DiagOutputDir'
        [void][IO.Directory]::CreateDirectory($directory)
        $safe.capture_ms = [int][Math]::Min([int]::MaxValue, $watch.ElapsedMilliseconds)
        $path = Join-Path $directory "IntuneGet-Uninstall-Timeout-$([Guid]::NewGuid()).json"
        $safe | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $path -Encoding utf8NoBOM
    } catch { } # Diagnostics must never change the scan result or its error text.
}

function Invoke-Winget {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds,
        [switch]$CaptureOnTimeout
    )

    $stdout = Join-Path $env:TEMP "winget-$([Guid]::NewGuid()).out"
    $stderr = Join-Path $env:TEMP "winget-$([Guid]::NewGuid()).err"
    try {
        $process = Start-Process -FilePath (Get-Command winget).Source -ArgumentList $Arguments `
            -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
        $startedUtcTicks = 0L
        if ($CaptureOnTimeout) { try { $startedUtcTicks = $process.StartTime.ToUniversalTime().Ticks } catch { } }
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            if ($CaptureOnTimeout) { try { Save-ScannerTimeoutCapture -Process $process -StartedUtcTicks $startedUtcTicks } catch { } }
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
            'install', '--id', $WingetId, '--exact', '--version', $ExpectedVersion, '--source', 'winget', '--silent',
            '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity', '--verbose-logs'
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

        # Keep the snapshot keyed to the exact WinGet version requested. The
        # registry display version is preserved in app_registry_entry.
        $result.version = $ExpectedVersion
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
    Write-Warning $result.error
} finally {
    if ($installedByScan) {
        $uninstall = Invoke-Winget -Arguments @('uninstall', '--id', $WingetId, '--exact', '--silent', '--accept-source-agreements', '--disable-interactivity') -TimeoutSeconds 300 -CaptureOnTimeout
        if ($uninstall.ExitCode -ne 0) {
            $cleanupMessage = "Cleanup failed with exit code $($uninstall.ExitCode): $($uninstall.Output)"
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
