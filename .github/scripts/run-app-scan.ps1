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
$userName = "igscan$([Guid]::NewGuid().ToString('N').Substring(0, 10))"
$work = Join-Path $env:ProgramData $taskName
$retryOutput = Join-Path $work 'result.json'
try {
    # Hosted runners can have UAC disabled, so Limited for runneradmin still
    # produces an administrator token. Use a genuinely non-administrator account.
    Write-Host 'Installer prohibits elevation. Retrying the complete scan as a temporary standard user.'
    $password = "Ig1!$([Guid]::NewGuid().ToString('N'))$([Guid]::NewGuid().ToString('N'))"
    $securePassword = ConvertTo-SecureString $password -AsPlainText -Force
    $user = New-LocalUser -Name $userName -Password $securePassword -AccountNeverExpires
    Add-LocalGroupMember -Group (Get-LocalGroup -SID 'S-1-5-32-545') -Member $user
    New-Item -ItemType Directory -Path $work | Out-Null
    Copy-Item -LiteralPath $scanner, (Join-Path $PSScriptRoot 'snapshot.ps1') -Destination $work
    $acl = Get-Acl -LiteralPath $work
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($user.SID, 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
    Set-Acl -LiteralPath $work -AclObject $acl
    $appInstaller = Get-AppxPackage -Name Microsoft.DesktopAppInstaller
    if (-not $appInstaller) { throw 'Desktop App Installer package was not found' }
    # Reuse runner-installed, signed packages; no extra software downloads.
    $manifests = @($appInstaller.Dependencies | ForEach-Object { Join-Path $_.InstallLocation 'AppxManifest.xml' })
    $manifests += Join-Path $appInstaller.InstallLocation 'AppxManifest.xml'
    $manifests | ConvertTo-Json -AsArray | Set-Content -LiteralPath (Join-Path $work 'manifests.json')
    @'
$ErrorActionPreference = 'Stop'
try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Retry unexpectedly has administrator privileges' }
    # CreateProcessWithLogonW inherited the administrator's environment.
    # Resolve this account's profile and keep temporary output in its own directory.
    $profileKey = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$($identity.User.Value)"
    $env:USERPROFILE = (Get-ItemProperty -LiteralPath $profileKey).ProfileImagePath
    $env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData\Local'
    $env:APPDATA = Join-Path $env:USERPROFILE 'AppData\Roaming'
    $env:TEMP = Join-Path $PSScriptRoot 'temp'
    $env:TMP = $env:TEMP
    New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
    Start-Transcript -Path "$PSScriptRoot\bootstrap.log" | Out-Null
    foreach ($manifest in (Get-Content "$PSScriptRoot\manifests.json" -Raw | ConvertFrom-Json)) {
        "Registering $manifest" | Set-Content "$PSScriptRoot\stage.txt"
        Add-AppxPackage -Register $manifest -DisableDevelopmentMode
    }
    $package = Get-AppxPackage -Name Microsoft.DesktopAppInstaller
    $userAliases = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
    $env:PATH = "$userAliases;$($package.InstallLocation);$env:PATH"
    Write-Host "Standard-user profile: $env:USERPROFILE"
    Write-Host "WinGet executable: $((Get-Command winget).Source)"
    New-Item -ItemType File -Path "$PSScriptRoot\ready" | Out-Null
    $arguments = Get-Content "$PSScriptRoot\arguments.json" -Raw | ConvertFrom-Json
    & "$PSScriptRoot\scan-app.ps1" -WingetId $arguments.id -ExpectedVersion $arguments.version -OutputPath "$PSScriptRoot\result.json"
} catch {
    $_.Exception.Message | Set-Content "$PSScriptRoot\bootstrap-error.txt"
    exit 1
}
'@ | Set-Content -LiteralPath (Join-Path $work 'bootstrap.ps1')
    @{ id = $WingetId; version = $ExpectedVersion } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $work 'arguments.json')
    $credential = [PSCredential]::new("$env:COMPUTERNAME\$userName", $securePassword)
    $process = Start-Process -FilePath $pwsh -ArgumentList "-NoProfile -File `"$(Join-Path $work 'bootstrap.ps1')`"" -WorkingDirectory $work -Credential $credential -LoadUserProfile -PassThru
    $deadline = (Get-Date).AddMinutes(23)
    $setupDeadline = (Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Seconds 2
        $process.Refresh()
        if ((Get-Date) -gt $setupDeadline -and -not (Test-Path "$work\ready")) {
            $stage = Get-Content "$work\stage.txt" -Raw -ErrorAction SilentlyContinue
            throw "Standard-user setup exceeded three minutes. Last stage: $stage"
        }
        if ($process.HasExited) { break }
    } while ((Get-Date) -lt $deadline)
    if (Test-Path "$work\bootstrap-error.txt") { throw (Get-Content "$work\bootstrap-error.txt" -Raw) }
    if (-not (Test-Path -LiteralPath $retryOutput)) { throw 'Standard-user scan timed out' }
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
    if ($process -and -not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
    if (Test-Path "$work\bootstrap.log") { Copy-Item "$work\bootstrap.log" 'scan-standard-user.log' -Force }
    Remove-LocalUser -Name $userName -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
