# Keep installation, registry snapshots and cleanup in the same Windows context.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9][A-Za-z0-9._+-]*$')][string]$WingetId,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._+\-]*$')][string]$ExpectedVersion,
    [Parameter(Mandatory)][string]$OutputPath
)
$ErrorActionPreference = 'Stop'
$scanner = Join-Path $PSScriptRoot 'scan-app.ps1'
$pwsh = (Get-Process -Id $PID).Path
$output = [IO.Path]::GetFullPath($OutputPath)
& $pwsh -NoProfile -File $scanner -WingetId $WingetId -ExpectedVersion $ExpectedVersion -OutputPath $output
$scanExit = $LASTEXITCODE
if ($scanExit -eq 0) { exit 0 }
if (-not (Test-Path -LiteralPath $output)) { exit $scanExit }
$result = Get-Content -LiteralPath $output -Raw | ConvertFrom-Json
# APPINSTALLER_CLI_ERROR_INSTALLER_PROHIBITS_ELEVATION: no installer ran.
# Do not retry crashes, timeouts, or partially completed installations.
if ($result.error -notmatch 'WinGet install failed with exit code -1978335146:') { exit $scanExit }

$taskName = "IntuneGetScan-$([Guid]::NewGuid())"
$retryOutput = "$output.standard-user.json"
Remove-Item -LiteralPath $retryOutput -Force -ErrorAction SilentlyContinue
try {
    Write-Host 'Installer prohibits elevation. Retrying the complete scan with a limited token for the same user.'
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    $arguments = "-NoProfile -File `"$scanner`" -WingetId `"$WingetId`" -ExpectedVersion `"$ExpectedVersion`" -OutputPath `"$retryOutput`""
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument $arguments -WorkingDirectory (Get-Location).Path
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 22)
    Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
    Start-ScheduledTask -TaskName $taskName
    $deadline = (Get-Date).AddMinutes(23)
    do {
        Start-Sleep -Seconds 2
        $task = Get-ScheduledTask -TaskName $taskName
        $info = Get-ScheduledTaskInfo -TaskName $taskName
        if ($task.State -ne 'Running' -and (Test-Path -LiteralPath $retryOutput)) { break }
        if ($task.State -ne 'Running' -and $info.LastRunTime -gt (Get-Date).AddMinutes(-24) -and $info.LastTaskResult -ne 267009) {
            throw "Limited-context task ended without a result (code $($info.LastTaskResult))"
        }
    } while ((Get-Date) -lt $deadline)
    if (-not (Test-Path -LiteralPath $retryOutput)) { throw 'Limited-context scan timed out or no interactive user session was available' }
    $retry = Get-Content -LiteralPath $retryOutput -Raw | ConvertFrom-Json
    Copy-Item -LiteralPath $retryOutput -Destination $output -Force
    if ($retry.status -eq 'failed') { Write-Warning $retry.error; exit 1 }
    exit 0
} catch {
    $result.error += "; Standard-user retry failed: $($_.Exception.Message)"
    $result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $output -Encoding utf8NoBOM
    Write-Warning $result.error
    exit 1
} finally {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
}
