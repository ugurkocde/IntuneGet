<#
.SYNOPSIS
    Creates a PSADT (PSAppDeployToolkit) package for Intune deployment.
.DESCRIPTION
    This script is called by the GitHub Actions workflow to generate the
    Invoke-AppDeployToolkit.ps1 deployment script based on installer type
    and configuration. All inputs are read from environment variables to
    avoid PowerShell parsing issues with special characters.
.NOTES
    Required environment variables:
    - INPUT_JOB_ID: Unique job identifier for callback tracking
    - INPUT_CALLBACK_URL: URL to send progress callbacks
    - INPUT_SILENT_SWITCHES: Silent installation switches for the installer
    - INPUT_UNINSTALL_COMMAND: Command to uninstall the application
    - INPUT_DISPLAY_NAME: Application display name
    - INPUT_PUBLISHER: Application publisher
    - INPUT_VERSION: Application version
    - INPUT_WINGET_ID: Winget package identifier
    - INPUT_INSTALLER_TYPE: Type of installer (exe, msi, msix, etc.)
#>

# Read inputs from environment variables (avoids PowerShell parsing issues with special chars)
$JobId = $env:INPUT_JOB_ID
$CallbackUrl = $env:INPUT_CALLBACK_URL
$SilentSwitches = $env:INPUT_SILENT_SWITCHES
$UninstallCommand = $env:INPUT_UNINSTALL_COMMAND
$DisplayName = $env:INPUT_DISPLAY_NAME
$Publisher = $env:INPUT_PUBLISHER
$Version = $env:INPUT_VERSION
$WingetId = $env:INPUT_WINGET_ID
$InstallerType = $env:INPUT_INSTALLER_TYPE
$NestedInstallerType = $env:INPUT_NESTED_INSTALLER_TYPE
$NestedInstallerPath = $env:INPUT_NESTED_INSTALLER_PATH
$InstallScope = if ($env:INPUT_INSTALL_SCOPE) { $env:INPUT_INSTALL_SCOPE } else { 'machine' }
$IsUserScope = $InstallScope -eq 'user'

# Validate required inputs
$requiredVars = @('INPUT_JOB_ID', 'INPUT_CALLBACK_URL', 'INPUT_DISPLAY_NAME', 'INPUT_PUBLISHER', 'INPUT_VERSION', 'INPUT_WINGET_ID', 'INPUT_INSTALLER_TYPE')
foreach ($var in $requiredVars) {
    if (-not (Get-Item "env:$var" -ErrorAction SilentlyContinue)) {
        throw "Required environment variable $var is not set"
    }
}

# Load callback helper
. "$env:GITHUB_WORKSPACE\Send-Callback.ps1"

# Send progress callback
Send-Callback -Body @{
    jobId = $JobId
    status = "packaging"
    message = "Creating PSADT package..."
    progress = 40
} -CallbackUrl $CallbackUrl -CallbackSecret $env:CALLBACK_SECRET | Out-Null

$packageDir = ".\package"
New-Item -ItemType Directory -Path $packageDir -Force

# PSADT v4 native structure
Copy-Item -Path ".\psadt\PSAppDeployToolkit" -Destination "$packageDir\PSAppDeployToolkit" -Recurse -Force
Copy-Item -Path ".\psadt\Config" -Destination "$packageDir\Config" -Recurse -Force
Copy-Item -Path ".\psadt\Strings" -Destination "$packageDir\Strings" -Recurse -Force
Copy-Item -Path ".\psadt\Assets" -Destination "$packageDir\Assets" -Recurse -Force
Copy-Item -Path ".\psadt\Invoke-AppDeployToolkit.exe" -Destination $packageDir -Force

$filesDir = "$packageDir\Files"
New-Item -ItemType Directory -Path $filesDir -Force

# Validate installer file exists
if (-not $env:INSTALLER_PATH) {
    throw "INSTALLER_PATH environment variable is not set"
}
if (-not (Test-Path -LiteralPath $env:INSTALLER_PATH)) {
    throw "Installer file not found: $env:INSTALLER_PATH"
}
if (-not $env:INSTALLER_FILENAME) {
    throw "INSTALLER_FILENAME environment variable is not set"
}
# Use -LiteralPath to handle filenames with special characters like brackets
Copy-Item -LiteralPath $env:INSTALLER_PATH -Destination $filesDir

# Parse PSADT configuration
$psadtConfig = @{}
if ($env:PSADT_CONFIG -and $env:PSADT_CONFIG -ne '{}') {
    try {
        $psadtConfig = $env:PSADT_CONFIG | ConvertFrom-Json -AsHashtable
    } catch {
        Write-Host "Warning: Could not parse PSADT config, using defaults"
    }
}

function ConvertTo-PSADTConfigValue {
    param(
        [AllowNull()][string]$Value,
        [switch]$AllowNumericLike
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return '$null'
    }

    if ($AllowNumericLike -and $Value -match '^(?i)0x[0-9A-F]{8}$') {
        return $Value.ToUpper()
    }
    return "'" + ($Value -replace "'", "''") + "'"
}

function ConvertTo-PSADTAccentValue {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        return '$null'
    }

    $trimmed = $Value.Trim()
    if ($trimmed -match '^(?i)0x[0-9A-F]{8}$') {
        return $trimmed.ToUpper()
    }

    if ($trimmed -match '^#[0-9A-F]{6}$') {
        return "0xFF$($trimmed.TrimStart('#').ToUpper())"
    }

    if ($trimmed -match '^#[0-9A-F]{8}$') {
        return "0x$($trimmed.TrimStart('#').ToUpper())"
    }

    return "'" + ($trimmed -replace "'", "''") + "'"
}

function Update-PowerShellDataSetting {
    param(
        [string]$Path,
        [string]$Section,
        [string]$Setting,
        [string]$ValueLiteral
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $lines = Get-Content -Path $Path
    $sectionStart = -1
    $sectionEnd = $lines.Count - 1
    $inSection = $false
    $sectionIndent = ''
    $settingIndent = ''
    $sectionDepth = 0
    $updated = $false

    for ($index = 0; $index -lt $lines.Count; $index++) {
        $line = $lines[$index]

        if (-not $inSection -and $line -match "^\s*$([regex]::Escape($Section))\s*=\s*@\{") {
            $inSection = $true
            $sectionStart = $index
            $sectionIndent = $line -replace '(^\s*).+', '$1'
            $settingIndent = "$sectionIndent    "
            $sectionDepth = 1
            continue
        }

        if (-not $inSection) {
            continue
        }

        $sectionDepth += (([regex]::Matches($line, '\{')).Count)
        $sectionDepth -= (([regex]::Matches($line, '\}')).Count)

        if ($line -match "^\s*$([regex]::Escape($Setting))\s*=") {
            $lines[$index] = "$settingIndent$Setting = $ValueLiteral"
            $updated = $true
            break
        }

        if ($sectionDepth -le 0) {
            $sectionEnd = $index
            break
        }
    }

    if (-not $inSection) {
        return
    }

    if (-not $updated -and -not [string]::IsNullOrWhiteSpace($ValueLiteral)) {
        if (-not $sectionEnd -or $sectionEnd -lt 0) {
            $sectionEnd = $lines.Count - 1
        }

        $lines = @(
            $lines[0..($sectionEnd - 1)]
            "$settingIndent$Setting = $ValueLiteral"
            $lines[$sectionEnd..($lines.Count - 1)]
        )
    }

    Set-Content -Path $Path -Value $lines -Encoding UTF8
}

function Use-PSADTBrandAsset {
    param(
        [string]$Source,
        [string]$TargetName,
        [string]$PackageAssetsPath
    )

    if ([string]::IsNullOrWhiteSpace($Source)) {
        return $false
    }

    $targetFile = Join-Path $PackageAssetsPath $TargetName

    if ($Source -match '^https?://') {
        try {
            Invoke-WebRequest -Uri $Source -OutFile $targetFile -UseBasicParsing
            return $true
        } catch {
            Write-Host "Warning: Could not download branding asset '$Source': $($_.Exception.Message)"
            return $false
        }
    }

    if (Test-Path -LiteralPath $Source) {
        Copy-Item -LiteralPath $Source -Destination $targetFile -Force
        return $true
    }

    $workspacePath = Join-Path $env:GITHUB_WORKSPACE $Source
    if ($workspacePath -and (Test-Path -LiteralPath $workspacePath)) {
        Copy-Item -LiteralPath $workspacePath -Destination $targetFile -Force
        return $true
    }

    Write-Host "Warning: Branding asset not found: $Source"
    return $false
}

function Get-PSADTAssetFileName {
    param(
        [string]$Source,
        [string]$Fallback
    )

    if ([string]::IsNullOrWhiteSpace($Source)) {
        return $Fallback
    }

    $trimmed = $Source.Trim()
    if ($trimmed -match '^https?://') {
        try {
            $uri = [uri]$trimmed
            $fileName = [System.IO.Path]::GetFileName($uri.AbsolutePath)
            if ($fileName) {
                return $fileName
            }
        } catch {
            Write-Host "Warning: Could not parse branding URL: $trimmed"
        }
    }

    $fileName = [System.IO.Path]::GetFileName($trimmed)
    if ($fileName) {
        return $fileName
    }

    return $Fallback
}

# Extract config values with defaults
# Escape special PowerShell characters for embedding in generated script
$silentSwitchesEscaped = $SilentSwitches -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
$uninstallCmd = $UninstallCommand -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
$displayNameEscaped = $DisplayName -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
$publisherEscaped = $Publisher -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
$sanitizedWingetId = $WingetId -replace '[\.\-]', '_'
$installerFileName = $env:INSTALLER_FILENAME
# Escaped variant for embedding in single-quoted strings in the generated script
$installerFileNameSingleQuoteEscaped = $installerFileName -replace "'", "''"
$installerTypeLower = $InstallerType.ToLower()
$psadtVersion = '4.1.8'

# Custom install/uninstall command overrides from PSADT config
# Non-empty values replace the synthesized install/uninstall commands entirely
$customInstallCommand = if ($psadtConfig.installCommand) { ([string]$psadtConfig.installCommand).Trim() } else { '' }
$customUninstallCommand = if ($psadtConfig.uninstallCommand) { ([string]$psadtConfig.uninstallCommand).Trim() } else { '' }
# Only escape single quotes - overrides are embedded in single-quoted strings in the generated script
$customInstallCommandEscaped = $customInstallCommand -replace "'", "''"
$customUninstallCommandEscaped = $customUninstallCommand -replace "'", "''"

# Additional post-install / post-uninstall commands (issue #118). Each runs as its
# own Start-ADTProcess (cmd.exe /c) step after the main install/uninstall, in order.
# Collapse embedded newlines to spaces so a command can never break out of the
# single-quoted string it is embedded in within the generated script.
$postInstallCommands = @()
if ($psadtConfig.postInstallCommands) {
    $postInstallCommands = @($psadtConfig.postInstallCommands | ForEach-Object { (([string]$_) -replace '[\r\n]+', ' ').Trim() } | Where-Object { $_ })
}
$postUninstallCommands = @()
if ($psadtConfig.postUninstallCommands) {
    $postUninstallCommands = @($psadtConfig.postUninstallCommands | ForEach-Object { (([string]$_) -replace '[\r\n]+', ' ').Trim() } | Where-Object { $_ })
}
# Custom detection marker root from PSADT config (issue #106)
# Subpath under the hive (no hive prefix), e.g. SOFTWARE\Contoso\Apps
# Normalization mirrors normalizeMarkerPath in lib/registry-marker.ts - keep in sync
$registryMarkerPath = if ($psadtConfig.registryMarkerPath) { ([string]$psadtConfig.registryMarkerPath).Trim() } else { '' }
$registryMarkerPath = $registryMarkerPath -replace '/', '\'
$registryMarkerPath = $registryMarkerPath -replace '\\+', '\'
$registryMarkerPath = $registryMarkerPath.Trim('\')
$registryMarkerPath = $registryMarkerPath -replace '^(HKLM|HKCU|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER):?(\\|$)', ''
$registryMarkerPath = $registryMarkerPath -replace '[*?"''<>|\x00-\x1f]', ''
$markerSegments = @($registryMarkerPath -split '\\' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$registryMarkerPath = $markerSegments -join '\'
if ([string]::IsNullOrWhiteSpace($registryMarkerPath)) { $registryMarkerPath = 'SOFTWARE\IntuneGet\Apps' }
# Escape for single-quoted embedding in the generated script (quotes are already
# stripped by normalization, this is defense in depth)
$registryMarkerPathEscaped = $registryMarkerPath -replace "'", "''"
# Optional pre-install removal of any existing installation (opt-in via PSADT config)
$removeExistingInstall = if ($psadtConfig.removeExistingInstall) { $true } else { $false }
# Optional post-install verification against Add/Remove Programs (opt-in via PSADT config)
$verifyInstall = if ($psadtConfig.verifyInstall) { $true } else { $false }
# Only escape single quotes - the app name is embedded in a single-quoted string in the generated script
$displayNameSingleQuoteEscaped = $DisplayName -replace "'", "''"
$brandingCompanyName = $psadtConfig.brandingCompanyName
$brandingWelcomeTitle = $psadtConfig.brandingWelcomeTitle
$brandingWelcomeMessage = $psadtConfig.brandingWelcomeMessage
$brandingAccentColor = $psadtConfig.brandingAccentColor
$brandingLogoPath = $psadtConfig.brandingLogoPath
$brandingLogoDarkPath = $psadtConfig.brandingLogoDarkPath
$brandingBannerPath = $psadtConfig.brandingBannerPath
$configPath = "$packageDir\Config\Config.psd1"
$stringsPath = "$packageDir\Strings\strings.psd1"

# Apply optional branding and asset customizations
if (-not [string]::IsNullOrWhiteSpace($brandingCompanyName)) {
    Update-PowerShellDataSetting -Path $configPath -Section 'Toolkit' -Setting 'CompanyName' -ValueLiteral (ConvertTo-PSADTConfigValue $brandingCompanyName)
}

if (-not [string]::IsNullOrWhiteSpace($brandingAccentColor)) {
    Update-PowerShellDataSetting -Path $configPath -Section 'UI' -Setting 'FluentAccentColor' -ValueLiteral (ConvertTo-PSADTAccentValue $brandingAccentColor)
}

if (-not [string]::IsNullOrWhiteSpace($brandingWelcomeMessage)) {
    Update-PowerShellDataSetting -Path $stringsPath -Section 'CloseAppsPrompt' -Setting 'CustomMessage' -ValueLiteral (ConvertTo-PSADTConfigValue $brandingWelcomeMessage)
}

$logoTarget = Get-PSADTAssetFileName -Source $brandingLogoPath -Fallback 'AppIcon.png'
if (Use-PSADTBrandAsset -Source $brandingLogoPath -TargetName $logoTarget -PackageAssetsPath "$packageDir\Assets") {
    Update-PowerShellDataSetting -Path $configPath -Section 'Assets' -Setting 'Logo' -ValueLiteral (ConvertTo-PSADTConfigValue $logoTarget)
}

$logoDarkTarget = Get-PSADTAssetFileName -Source $brandingLogoDarkPath -Fallback 'AppIconDark.png'
if (Use-PSADTBrandAsset -Source $brandingLogoDarkPath -TargetName $logoDarkTarget -PackageAssetsPath "$packageDir\Assets") {
    Update-PowerShellDataSetting -Path $configPath -Section 'Assets' -Setting 'LogoDark' -ValueLiteral (ConvertTo-PSADTConfigValue $logoDarkTarget)
}

$bannerTarget = Get-PSADTAssetFileName -Source $brandingBannerPath -Fallback 'Banner.png'
if (Use-PSADTBrandAsset -Source $brandingBannerPath -TargetName $bannerTarget -PackageAssetsPath "$packageDir\Assets") {
    Update-PowerShellDataSetting -Path $configPath -Section 'Assets' -Setting 'Banner' -ValueLiteral (ConvertTo-PSADTConfigValue $bannerTarget)
}

# User-scope apps run as the logged-in user who cannot write to C:\Windows\Logs\Software
# Override the PSADT log directory to ProgramData which is writable by all authenticated users
if ($IsUserScope) {
    # Use literal path since .psd1 files load in restricted language mode
    # where PSADT runtime variables like $envProgramData are not available
    Update-PowerShellDataSetting -Path $configPath -Section 'Toolkit' -Setting 'LogPath' -ValueLiteral "'C:\ProgramData\IntuneGet\Logs'"
    Write-Host "User-scope: Log directory overridden to C:\ProgramData\IntuneGet\Logs"
}

# Auto-detect installer type from file extension (override incorrect manifest data)
$fileExtension = [System.IO.Path]::GetExtension($installerFileName).ToLower()
$originalInstallerType = $installerTypeLower

# Map file extensions to correct installer types
$extensionTypeMap = @{
    '.exe' = 'exe'
    '.msi' = 'msi'
    '.msix' = 'msix'
    '.msixbundle' = 'msix'
    '.appx' = 'appx'
    '.appxbundle' = 'appx'
    '.zip' = 'zip'
}

# Override if extension doesn't match declared type
if ($extensionTypeMap.ContainsKey($fileExtension)) {
    $detectedType = $extensionTypeMap[$fileExtension]
    $shouldOverride = $false

    switch ($fileExtension) {
        '.exe' {
            if ($installerTypeLower -in 'portable', 'zip') {
                $shouldOverride = $true
            }
        }
        '.msi' {
            if ($installerTypeLower -notin 'msi', 'wix') {
                $shouldOverride = $true
            }
        }
        '.msix' {
            if ($installerTypeLower -ne 'msix') {
                $shouldOverride = $true
            }
        }
        '.msixbundle' {
            if ($installerTypeLower -ne 'msix') {
                $shouldOverride = $true
            }
        }
        '.appx' {
            if ($installerTypeLower -ne 'appx') {
                $shouldOverride = $true
            }
        }
        '.appxbundle' {
            if ($installerTypeLower -ne 'appx') {
                $shouldOverride = $true
            }
        }
    }

    if ($shouldOverride) {
        $installerTypeLower = $detectedType
        Write-Host "WARNING: Installer type overridden from '$originalInstallerType' to '$installerTypeLower' based on file extension"
    }
}

# Check if uninstall command uses special handling
$useRegistryUninstall = $false
$useMsixUninstall = $false
$usePortableUninstall = $false
$registryUninstallDisplayName = ''
$msixPackageName = ''

if ($uninstallCmd -match '^REGISTRY_UNINSTALL:(.+)$') {
    $useRegistryUninstall = $true
    $registryUninstallDisplayName = $Matches[1]

    # Strip common winget package suffixes that don't appear in registry
    $suffixesToRemove = @(
        '\s*\(Install\)$',
        '\s*\(Machine-Wide Install\)$',
        '\s*\(Machine Wide Install\)$',
        '\s*\(User\)$',
        '\s*\(x64\)$',
        '\s*\(x86\)$',
        '\s*\(64-bit\)$',
        '\s*\(32-bit\)$'
    )
    foreach ($suffix in $suffixesToRemove) {
        $registryUninstallDisplayName = $registryUninstallDisplayName -replace $suffix, ''
    }
    $registryUninstallDisplayName = $registryUninstallDisplayName.Trim()

    Write-Host "Using registry-based uninstall for: $registryUninstallDisplayName"
} elseif ($uninstallCmd -match '^MSIX_UNINSTALL:(.+)$') {
    $useMsixUninstall = $true
    $msixPackageName = $Matches[1]
    Write-Host "Using MSIX uninstall for package: $msixPackageName"
} elseif ($installerTypeLower -in 'zip', 'portable') {
    $usePortableUninstall = $true
    Write-Host "Using portable uninstall (folder removal)"
}

# Extract app close configuration
$processesToClose = @()
if ($psadtConfig.processesToClose -and $psadtConfig.processesToClose.Count -gt 0) {
    $processesToClose = $psadtConfig.processesToClose | Where-Object { $_.name -and $_.name.Trim() -ne '' }
}
$showClosePrompt = if ($psadtConfig.showClosePrompt) { $true } else { $false }
$closeCountdown = if ($psadtConfig.closeCountdown) { [int]$psadtConfig.closeCountdown } else { 60 }
$allowDefer = if ($psadtConfig.ContainsKey('allowDefer')) { [bool]$psadtConfig.allowDefer } else { $false }
$deferTimes = if ($psadtConfig.deferTimes) { [int]$psadtConfig.deferTimes } else { 3 }

# Extended welcome parameters
$blockExecution = if ($psadtConfig.blockExecution) { $true } else { $false }
$promptToSave = if ($psadtConfig.promptToSave) { $true } else { $false }
$deferDeadline = if ($psadtConfig.deferDeadline) { ([string]$psadtConfig.deferDeadline) -replace "'", "''" -replace '`', '``' -replace '\$', '`$' } else { $null }
$deferDays = $psadtConfig.deferDays
$forceCloseCountdown = $psadtConfig.forceCloseProcessesCountdown
$persistPrompt = if ($psadtConfig.persistPrompt) { $true } else { $false }
$minimizeWindows = if ($psadtConfig.minimizeWindows) { $true } else { $false }
$windowLocation = if ($psadtConfig.windowLocation) { ([string]$psadtConfig.windowLocation) -replace "'", "''" -replace '`', '``' -replace '\$', '`$' } else { 'Default' }
$checkDiskSpace = if ($psadtConfig.checkDiskSpace) { $true } else { $false }
$requiredDiskSpace = $psadtConfig.requiredDiskSpace
$welcomeTitle = if ([string]::IsNullOrWhiteSpace($brandingWelcomeTitle)) { "$displayNameEscaped Installation" } else { $brandingWelcomeTitle -replace "'", "''" -replace '`', '``' -replace '\$', '`$' }
$welcomeMessageEscaped = if ($brandingWelcomeMessage) { $brandingWelcomeMessage -replace "'", "''" -replace '`', '``' -replace '\$', '`$' } else { '' }
$welcomeMessageEscaped = $welcomeMessageEscaped -replace "`r`n", "`r`n"

# UI elements
$progressConfig = $psadtConfig.progressDialog
$customPrompts = $psadtConfig.customPrompts
$restartPromptConfig = $psadtConfig.restartPrompt
$balloonTips = $psadtConfig.balloonTips

Write-Host "Install scope: $InstallScope (IsUserScope: $IsUserScope)"
Write-Host "Close prompt enabled: $showClosePrompt"
Write-Host "Processes to close: $($processesToClose.Count)"
if ($processesToClose.Count -gt 0) {
    Write-Host "  - $($processesToClose | ForEach-Object { $_.name } | Join-String -Separator ', ')"
}

# Build processes array as separate script-level variable
$processesArrayStr = '@()'
$processesVarBlock = ''
if ($processesToClose.Count -gt 0) {
    $processEntries = $processesToClose | ForEach-Object {
        $procName = $_.name -replace "'", "''"
        $procDesc = if ($_.description) { $_.description -replace "'", "''" } else { $procName }
        "@{ Name = '$procName'; Description = '$procDesc' }"
    }
    $processesArrayStr = "@(`n    $($processEntries -join ",`n    ")`n)"
    $processesVarBlock = "`$script:ProcessesToClose = $processesArrayStr"
}

# Build Show-ADTInstallationWelcome call if enabled
$welcomeCall = ''
if ($allowDefer -or ($showClosePrompt -and $processesToClose.Count -gt 0) -or $blockExecution -or $checkDiskSpace) {
    $welcomeParams = @()

    if (-not [string]::IsNullOrWhiteSpace($welcomeMessageEscaped)) {
        $welcomeParams += '-CustomText'
    }

    # Handle parameter sets correctly for PSADT v4
    # When both deferrals AND close prompts are enabled, use -AllowDeferCloseProcesses
    if ($processesToClose.Count -gt 0 -and $allowDefer) {
        $welcomeParams += '-CloseProcesses $script:ProcessesToClose'
        $welcomeParams += '-AllowDeferCloseProcesses'
        $welcomeParams += "-ForceCloseProcessesCountdown $closeCountdown"
        $welcomeParams += "-DeferTimes $deferTimes"
        if ($blockExecution) { $welcomeParams += '-BlockExecution' }
    } elseif ($processesToClose.Count -gt 0) {
        # Only close prompts, no deferrals
        $welcomeParams += '-CloseProcesses $script:ProcessesToClose'
        $welcomeParams += "-CloseProcessesCountdown $closeCountdown"
        if ($blockExecution) { $welcomeParams += '-BlockExecution' }
    } elseif ($allowDefer) {
        # Only deferrals, no close prompts
        $welcomeParams += '-AllowDefer'
        $welcomeParams += "-DeferTimes $deferTimes"
        if ($deferDeadline) { $welcomeParams += "-DeferDeadline '$deferDeadline'" }
        if ($deferDays) { $welcomeParams += "-DeferDays $deferDays" }
    }
    if ($forceCloseCountdown) { $welcomeParams += "-ForceCloseProcessesCountdown $forceCloseCountdown" }
    if ($persistPrompt) { $welcomeParams += '-PersistPrompt' }
    if ($minimizeWindows) { $welcomeParams += '-MinimizeWindows' }
    if ($windowLocation -ne 'Default') { $welcomeParams += "-WindowLocation '$windowLocation'" }
    if ($checkDiskSpace) {
        $welcomeParams += '-CheckDiskSpace'
        if ($requiredDiskSpace) { $welcomeParams += "-RequiredDiskSpace $requiredDiskSpace" }
    }

    $welcomeCall = @(
        ''
        '    # Show installation welcome dialog (for deferrals and/or close prompts)'
        "    Show-ADTInstallationWelcome $($welcomeParams -join ' ')"
        ''
    ) -join "`r`n"
}

# Build progress dialog call if enabled
$progressCall = ''
if ($progressConfig -and $progressConfig.enabled) {
    $progressParams = @()
    if ($progressConfig.statusMessage) {
        $statusMsgEscaped = $progressConfig.statusMessage -replace "'", "''"
        $progressParams += "-StatusMessage '$statusMsgEscaped'"
    }
    if ($progressConfig.windowLocation -and $progressConfig.windowLocation -ne 'Default') {
        $progressWindowLocationEscaped = ([string]$progressConfig.windowLocation) -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
        $progressParams += "-WindowLocation '$progressWindowLocationEscaped'"
    }
    $progressParamsStr = if ($progressParams.Count -gt 0) { " $($progressParams -join ' ')" } else { "" }
    $progressCall = @(
        ''
        '    # Show progress dialog during installation'
        "    Show-ADTInstallationProgress$progressParamsStr"
        ''
    ) -join "`r`n"
}

# Build custom prompt calls for pre-install
$preInstallPromptCalls = ''
if ($customPrompts -and $customPrompts.Count -gt 0) {
    $preInstallPrompts = $customPrompts | Where-Object { $_.enabled -and $_.timing -eq 'pre-install' }
    foreach ($prompt in $preInstallPrompts) {
        $promptParams = @()
        $titleEscaped = $prompt.title -replace "'", "''"
        $messageEscaped = $prompt.message -replace "'", "''"
        $promptParams += "-Title '$titleEscaped'"
        $promptParams += "-Message '$messageEscaped'"
        if ($prompt.icon -and $prompt.icon -ne 'None') { $promptParams += "-Icon '$($prompt.icon)'" }
        if ($prompt.buttonLeftText) {
            $btnLeft = $prompt.buttonLeftText -replace "'", "''"
            $promptParams += "-ButtonLeftText '$btnLeft'"
        }
        if ($prompt.buttonMiddleText) {
            $btnMiddle = $prompt.buttonMiddleText -replace "'", "''"
            $promptParams += "-ButtonMiddleText '$btnMiddle'"
        }
        if ($prompt.buttonRightText) {
            $btnRight = $prompt.buttonRightText -replace "'", "''"
            $promptParams += "-ButtonRightText '$btnRight'"
        }
        if ($prompt.timeout -and $prompt.timeout -gt 0) { $promptParams += "-Timeout $($prompt.timeout)" }
        if ($prompt.persistPrompt) { $promptParams += '-PersistPrompt' }

        $preInstallPromptCalls += @(
            ''
            '    # Show custom pre-installation prompt'
            "    Show-ADTInstallationPrompt $($promptParams -join ' ')"
        ) -join "`r`n"
    }
}

# Build custom prompt calls for post-install
$postInstallPromptCalls = ''
if ($customPrompts -and $customPrompts.Count -gt 0) {
    $postInstallPrompts = $customPrompts | Where-Object { $_.enabled -and $_.timing -eq 'post-install' }
    foreach ($prompt in $postInstallPrompts) {
        $promptParams = @()
        $titleEscaped = $prompt.title -replace "'", "''"
        $messageEscaped = $prompt.message -replace "'", "''"
        $promptParams += "-Title '$titleEscaped'"
        $promptParams += "-Message '$messageEscaped'"
        if ($prompt.icon -and $prompt.icon -ne 'None') { $promptParams += "-Icon '$($prompt.icon)'" }
        if ($prompt.buttonLeftText) {
            $btnLeft = $prompt.buttonLeftText -replace "'", "''"
            $promptParams += "-ButtonLeftText '$btnLeft'"
        }
        if ($prompt.buttonMiddleText) {
            $btnMiddle = $prompt.buttonMiddleText -replace "'", "''"
            $promptParams += "-ButtonMiddleText '$btnMiddle'"
        }
        if ($prompt.buttonRightText) {
            $btnRight = $prompt.buttonRightText -replace "'", "''"
            $promptParams += "-ButtonRightText '$btnRight'"
        }
        if ($prompt.timeout -and $prompt.timeout -gt 0) { $promptParams += "-Timeout $($prompt.timeout)" }
        if ($prompt.persistPrompt) { $promptParams += '-PersistPrompt' }

        $postInstallPromptCalls += @(
            ''
            '    # Show custom post-installation prompt'
            "    Show-ADTInstallationPrompt $($promptParams -join ' ')"
        ) -join "`r`n"
    }
}

# Build balloon tip calls for start
$startBalloonCalls = ''
if ($balloonTips -and $balloonTips.Count -gt 0) {
    $startTips = $balloonTips | Where-Object { $_.enabled -and $_.timing -eq 'start' }
    foreach ($tip in $startTips) {
        $tipParams = @()
        $titleEscaped = $tip.title -replace "'", "''"
        $textEscaped = $tip.text -replace "'", "''"
        $tipParams += "-BalloonTipTitle '$titleEscaped'"
        $tipParams += "-BalloonTipText '$textEscaped'"
        if ($tip.icon -and $tip.icon -ne 'None') { $tipParams += "-BalloonTipIcon '$($tip.icon)'" }
        if ($tip.displayTime) { $tipParams += "-BalloonTipTime $($tip.displayTime)" }

        $startBalloonCalls += @(
            ''
            '    # Show balloon notification at start'
            "    Show-ADTBalloonTip $($tipParams -join ' ')"
        ) -join "`r`n"
    }
}

# Build balloon tip calls for end
$endBalloonCalls = ''
if ($balloonTips -and $balloonTips.Count -gt 0) {
    $endTips = $balloonTips | Where-Object { $_.enabled -and $_.timing -eq 'end' }
    foreach ($tip in $endTips) {
        $tipParams = @()
        $titleEscaped = $tip.title -replace "'", "''"
        $textEscaped = $tip.text -replace "'", "''"
        $tipParams += "-BalloonTipTitle '$titleEscaped'"
        $tipParams += "-BalloonTipText '$textEscaped'"
        if ($tip.icon -and $tip.icon -ne 'None') { $tipParams += "-BalloonTipIcon '$($tip.icon)'" }
        if ($tip.displayTime) { $tipParams += "-BalloonTipTime $($tip.displayTime)" }

        $endBalloonCalls += @(
            ''
            '    # Show balloon notification at end'
            "    Show-ADTBalloonTip $($tipParams -join ' ')"
        ) -join "`r`n"
    }
}

# Build custom prompt calls for pre-uninstall
$preUninstallPromptCalls = ''
if ($customPrompts -and $customPrompts.Count -gt 0) {
    $preUninstallPrompts = $customPrompts | Where-Object { $_.enabled -and $_.timing -eq 'pre-uninstall' }
    foreach ($prompt in $preUninstallPrompts) {
        $promptParams = @()
        $titleEscaped = $prompt.title -replace "'", "''"
        $messageEscaped = $prompt.message -replace "'", "''"
        $promptParams += "-Title '$titleEscaped'"
        $promptParams += "-Message '$messageEscaped'"
        if ($prompt.icon -and $prompt.icon -ne 'None') { $promptParams += "-Icon '$($prompt.icon)'" }
        if ($prompt.buttonLeftText) {
            $btnLeft = $prompt.buttonLeftText -replace "'", "''"
            $promptParams += "-ButtonLeftText '$btnLeft'"
        }
        if ($prompt.buttonMiddleText) {
            $btnMiddle = $prompt.buttonMiddleText -replace "'", "''"
            $promptParams += "-ButtonMiddleText '$btnMiddle'"
        }
        if ($prompt.buttonRightText) {
            $btnRight = $prompt.buttonRightText -replace "'", "''"
            $promptParams += "-ButtonRightText '$btnRight'"
        }
        if ($prompt.timeout -and $prompt.timeout -gt 0) { $promptParams += "-Timeout $($prompt.timeout)" }
        if ($prompt.persistPrompt) { $promptParams += '-PersistPrompt' }

        $preUninstallPromptCalls += @(
            ''
            '    # Show custom pre-uninstall prompt'
            "    Show-ADTInstallationPrompt $($promptParams -join ' ')"
        ) -join "`r`n"
    }
}

# Build custom prompt calls for post-uninstall
$postUninstallPromptCalls = ''
if ($customPrompts -and $customPrompts.Count -gt 0) {
    $postUninstallPrompts = $customPrompts | Where-Object { $_.enabled -and $_.timing -eq 'post-uninstall' }
    foreach ($prompt in $postUninstallPrompts) {
        $promptParams = @()
        $titleEscaped = $prompt.title -replace "'", "''"
        $messageEscaped = $prompt.message -replace "'", "''"
        $promptParams += "-Title '$titleEscaped'"
        $promptParams += "-Message '$messageEscaped'"
        if ($prompt.icon -and $prompt.icon -ne 'None') { $promptParams += "-Icon '$($prompt.icon)'" }
        if ($prompt.buttonLeftText) {
            $btnLeft = $prompt.buttonLeftText -replace "'", "''"
            $promptParams += "-ButtonLeftText '$btnLeft'"
        }
        if ($prompt.buttonMiddleText) {
            $btnMiddle = $prompt.buttonMiddleText -replace "'", "''"
            $promptParams += "-ButtonMiddleText '$btnMiddle'"
        }
        if ($prompt.buttonRightText) {
            $btnRight = $prompt.buttonRightText -replace "'", "''"
            $promptParams += "-ButtonRightText '$btnRight'"
        }
        if ($prompt.timeout -and $prompt.timeout -gt 0) { $promptParams += "-Timeout $($prompt.timeout)" }
        if ($prompt.persistPrompt) { $promptParams += '-PersistPrompt' }

        $postUninstallPromptCalls += @(
            ''
            '    # Show custom post-uninstall prompt'
            "    Show-ADTInstallationPrompt $($promptParams -join ' ')"
        ) -join "`r`n"
    }
}

# Build restart prompt call if enabled
$restartPromptCall = ''
if ($restartPromptConfig -and $restartPromptConfig.enabled) {
    $restartParams = @()
    $countdownSeconds = if ($restartPromptConfig.countdownSeconds) { $restartPromptConfig.countdownSeconds } else { 600 }
    $countdownNoHideSeconds = if ($restartPromptConfig.countdownNoHideSeconds) { $restartPromptConfig.countdownNoHideSeconds } else { 60 }
    $restartParams += "-CountdownSeconds $countdownSeconds"
    $restartParams += "-CountdownNoHideSeconds $countdownNoHideSeconds"

    $restartPromptCall = @(
        ''
        '    # Show restart prompt with countdown'
        "    Show-ADTInstallationRestartPrompt $($restartParams -join ' ')"
    ) -join "`r`n"
}

# Build Invoke-AppDeployToolkit.ps1 script content using PSADT v4 native syntax
$lines = @(
    '<#'
    '.SYNOPSIS'
    "    $displayNameEscaped Deployment Script"
    '.DESCRIPTION'
    '    Deploys the application using PSAppDeployToolkit v4'
    '#>'
    ''
    '[CmdletBinding()]'
    'param'
    '('
    '    [Parameter(Mandatory = $false)]'
    '    [ValidateSet(''Install'', ''Uninstall'', ''Repair'')]'
    '    [System.String]$DeploymentType,'
    ''
    '    [Parameter(Mandatory = $false)]'
    '    [ValidateSet(''Auto'', ''Interactive'', ''NonInteractive'', ''Silent'')]'
    '    [System.String]$DeployMode,'
    ''
    '    [Parameter(Mandatory = $false)]'
    '    [System.Management.Automation.SwitchParameter]$SuppressRebootPassThru,'
    ''
    '    [Parameter(Mandatory = $false)]'
    '    [System.Management.Automation.SwitchParameter]$TerminalServerMode,'
    ''
    '    [Parameter(Mandatory = $false)]'
    '    [System.Management.Automation.SwitchParameter]$DisableLogging'
    ')'
    ''
    '##================================================'
    '## MARK: Variables'
    '##================================================'
    ''
    "# Processes to close before installation"
    "$processesVarBlock"
    ''
    '$adtSession = @{'
    "    AppVendor = '$publisherEscaped'"
    "    AppName = '$displayNameEscaped'"
    "    AppVersion = '$Version'"
    '    AppArch = '''''
    '    AppLang = ''EN'''
    '    AppRevision = ''01'''
    '    AppSuccessExitCodes = @(0)'
    '    AppRebootExitCodes = @(1641, 3010)'
    '    AppScriptVersion = ''1.0.0'''
    '    AppScriptDate = (Get-Date -Format ''yyyy-MM-dd'')'
    '    AppScriptAuthor = ''IntuneGet'''
    "    RequireAdmin = `$$(-not $IsUserScope)"
    '    InstallName = '''''
    '    InstallTitle = '''''
    '    DeployAppScriptFriendlyName = $MyInvocation.MyCommand.Name'
    '    DeployAppScriptParameters = $PSBoundParameters'
    "    DeployAppScriptVersion = '$psadtVersion'"
    '}'
    ''
    'function Install-ADTDeployment'
    '{'
    '    [CmdletBinding()]'
    '    param ()'
    $startBalloonCalls
    $welcomeCall
    $preInstallPromptCalls
    $progressCall
)

# Add installer file existence check and progress display before install commands
$lines += @(
    ''
    '    # Verify installer file exists before proceeding'
    "    `$installerPath = Join-Path `$adtSession.DirFiles '$installerFileNameSingleQuoteEscaped'"
    '    if (-not (Test-Path -LiteralPath $installerPath)) {'
    '        Write-ADTLogEntry -Message "Installer file not found: $installerPath" -Severity ''Error'' -Source ''Install-ADTDeployment'''
    '        throw "Installer file not found: $installerPath"'
    '    }'
    ''
    '    # Show installation progress'
    "    Show-ADTInstallationProgress -StatusMessage `"Installing `$(`$adtSession.AppName)...`""
    ''
)

# Optional pre-install removal of existing installations (opt-in via PSADT config)
if ($removeExistingInstall) {
    Write-Host "Pre-install removal of existing installations enabled"
    $lines += @(
        '    ## Remove any existing installation before installing'
        '    try {'
        "        `$existingApps = Get-ADTApplication -Name '$displayNameSingleQuoteEscaped' -NameMatch 'Contains' -ErrorAction SilentlyContinue"
        '        if ($existingApps) {'
        '            Write-ADTLogEntry -Message "Found $($existingApps.Count) existing installation(s), removing before install" -Source ''Install-ADTDeployment'''
        '            Uninstall-ADTApplication -InstalledApplication $existingApps -ErrorAction SilentlyContinue'
        '        }'
        '    }'
        '    catch {'
        '        Write-ADTLogEntry -Message "Pre-install removal failed: $($_.Exception.Message)" -Severity ''Warning'' -Source ''Install-ADTDeployment'''
        '    }'
        ''
    )
}

# Generate install command - custom override takes precedence over installer type synthesis
if (-not [string]::IsNullOrWhiteSpace($customInstallCommand)) {
    Write-Host "Using custom install command override from PSADT config"
    $lines += @(
        '    # Custom install command override (user-specified)'
        "    Write-ADTLogEntry -Message 'Executing custom install command' -Severity 'Info' -Source 'Install-ADTDeployment'"
        "    Start-ADTProcess -FilePath `"`$env:SystemRoot\System32\cmd.exe`" -ArgumentList '/c $customInstallCommandEscaped' -WorkingDirectory `$adtSession.DirFiles -WindowStyle Hidden"
    )
} else {
    switch ($installerTypeLower) {
        { $_ -in 'msi', 'wix' } {
            $msiProperties = ($silentSwitchesEscaped -replace '/q[nbrfu]?\s*', '' -replace '/quiet\s*', '').Trim()
            if ($msiProperties) {
                $lines += @(
                    "    Start-ADTMsiProcess -Action 'Install' -FilePath '$installerFileNameSingleQuoteEscaped' -AdditionalArgumentList '$msiProperties'"
                )
            } else {
                $lines += @(
                    "    Start-ADTMsiProcess -Action 'Install' -FilePath '$installerFileNameSingleQuoteEscaped'"
                )
            }
        }
        { $_ -in 'msix', 'appx' } {
            $lines += @(
                "    `$msixPath = `"`$(`$adtSession.DirFiles)\$installerFileName`""
                '    Write-ADTLogEntry -Message "Provisioning MSIX/APPX package for all users: $msixPath" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                '    try {'
                '        Add-AppxProvisionedPackage -Online -PackagePath $msixPath -SkipLicense -ErrorAction Stop'
                '        Write-ADTLogEntry -Message "MSIX/APPX package provisioned successfully" -Severity ''Success'' -Source ''Install-ADTDeployment'''
                '    } catch {'
                '        Write-ADTLogEntry -Message "Failed to provision MSIX/APPX package: $_" -Severity ''Error'' -Source ''Install-ADTDeployment'''
                '        throw'
                '    }'
            )
        }
        'zip' {
            # Zip archives carry a nested installer (winget nestedInstallerType/nestedInstallerPath)
            # Never execute the .zip itself - extract it and run the declared nested installer
            if ([string]::IsNullOrWhiteSpace($NestedInstallerPath)) {
                Write-Host "Zip installer without nested installer path - emitting install-time error"
                $lines += @(
                    '    # Zip archives cannot be executed directly and no nested installer was declared'
                    '    throw "Zip package does not declare a nested installer; cannot install"'
                )
            } else {
                $nestedInstallerPathEscaped = $NestedInstallerPath -replace "'", "''"
                $nestedInstallerTypeLower = if ($NestedInstallerType) { $NestedInstallerType.ToLower() } else { '' }
                Write-Host "Zip installer with nested installer: type='$nestedInstallerTypeLower' path='$NestedInstallerPath'"

                # Build the execution line for the nested installer (dispatch on nested type)
                switch ($nestedInstallerTypeLower) {
                    { $_ -in 'msi', 'wix' } {
                        $msiProperties = ($silentSwitchesEscaped -replace '/q[nbrfu]?\s*', '' -replace '/quiet\s*', '').Trim()
                        if ($msiProperties) {
                            $nestedExecuteLine = "        Start-ADTMsiProcess -Action 'Install' -FilePath `$nestedInstallerPath -AdditionalArgumentList '$msiProperties'"
                        } else {
                            $nestedExecuteLine = "        Start-ADTMsiProcess -Action 'Install' -FilePath `$nestedInstallerPath"
                        }
                    }
                    'portable' {
                        $nestedExecuteLine = '        throw "Portable nested installers are not supported yet"'
                    }
                    default {
                        if ($IsUserScope) {
                            $nestedExecuteLine = "        Start-ADTProcess -FilePath `$nestedInstallerPath -ArgumentList '$silentSwitchesEscaped' -UseShellExecute -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 30) -TimeoutAction Stop"
                        } else {
                            $nestedExecuteLine = "        Start-ADTProcess -FilePath `$nestedInstallerPath -ArgumentList '$silentSwitchesEscaped' -WindowStyle Hidden -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 30) -TimeoutAction Stop"
                        }
                    }
                }

                $lines += @(
                    ''
                    '    # Extract the zip archive to a unique temp directory and run the nested installer'
                    '    $zipExtractDir = [System.IO.Path]::Combine($env:TEMP, "IntuneGet_Zip_" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))'
                    '    $null = New-Item -Path $zipExtractDir -ItemType Directory -Force'
                    '    try {'
                    '        Write-ADTLogEntry -Message "Extracting zip archive to: $zipExtractDir" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                )
                if ($IsUserScope) {
                    # Per-user installs: copy the zip to user temp first (consistent with the
                    # exe branch - some installers fail when run from the IMECache directory)
                    $lines += @(
                        "        Copy-Item -LiteralPath `"`$(`$adtSession.DirFiles)\$installerFileName`" -Destination `$zipExtractDir -Force"
                        "        Expand-Archive -Path (Join-Path `$zipExtractDir '$installerFileNameSingleQuoteEscaped') -DestinationPath `$zipExtractDir -Force"
                    )
                } else {
                    $lines += @(
                        "        Expand-Archive -Path `"`$(`$adtSession.DirFiles)\$installerFileName`" -DestinationPath `$zipExtractDir -Force"
                    )
                }
                $lines += @(
                    "        `$nestedInstallerPath = Join-Path `$zipExtractDir '$nestedInstallerPathEscaped'"
                    '        if (-not (Test-Path -LiteralPath $nestedInstallerPath)) {'
                    "            throw `"Nested installer not found in archive: $nestedInstallerPathEscaped`""
                    '        }'
                    '        Write-ADTLogEntry -Message "Running nested installer: $nestedInstallerPath" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                    $nestedExecuteLine
                    '    }'
                    '    finally {'
                    '        if (Test-Path -LiteralPath $zipExtractDir) {'
                    '            Remove-Item -Path $zipExtractDir -Recurse -Force -ErrorAction SilentlyContinue'
                    '        }'
                    '    }'
                )
            }
        }
        'portable' {
            $lines += @(
                "    `$zipPath = `"`$(`$adtSession.DirFiles)\$installerFileName`""
                "    `$extractPath = `"`$env:ProgramFiles\$displayNameEscaped`""
                '    Write-ADTLogEntry -Message "Extracting portable app to: $extractPath" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                '    try {'
                '        if (-not (Test-Path $extractPath)) {'
                '            New-Item -Path $extractPath -ItemType Directory -Force | Out-Null'
                '        }'
                '        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force'
                '        Write-ADTLogEntry -Message "Portable app extracted successfully" -Severity ''Success'' -Source ''Install-ADTDeployment'''
                '    } catch {'
                '        Write-ADTLogEntry -Message "Failed to extract portable app: $_" -Severity ''Error'' -Source ''Install-ADTDeployment'''
                '        throw'
                '    }'
            )
        }
        default {
            # EXE installers: Use -WaitForMsiExec for bootstrappers that spawn MSI, and -Timeout to prevent indefinite hangs
            # Many installers (NSIS, Inno Setup, etc.) can spawn child processes that wait for user input in SYSTEM context
            if ($IsUserScope) {
                # Per-user installers: When Intune runs with runAsAccount=user, we're already in user context
                # Some installers (like Spotify) fail when run from C:\Windows\IMECache because:
                # 1. They need to download/extract components to the same directory
                # 2. They check their launch path and fail if it's a system directory
                # Solution: Copy installer to user's temp directory and run from there
                $lines += @(
                    ''
                    '    # Per-user installer - copy to user temp directory first'
                    '    # Some installers (Spotify, etc.) fail from IMECache system directory'
                    "    `$installerSource = `"`$(`$adtSession.DirFiles)\$installerFileName`""
                    '    $userTempDir = [System.IO.Path]::Combine($env:TEMP, "IntuneGet_" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))'
                    '    $null = New-Item -Path $userTempDir -ItemType Directory -Force'
                    "    `$installerDest = Join-Path `$userTempDir '$installerFileNameSingleQuoteEscaped'"
                    '    Write-ADTLogEntry -Message "Copying installer to user temp: $installerDest" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                    '    Copy-Item -Path $installerSource -Destination $installerDest -Force'
                    ''
                    '    try {'
                    '        Write-ADTLogEntry -Message "Running per-user installer from user temp directory" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                    '        # Use -UseShellExecute for shell context which inherits environment variables'
                    "        Start-ADTProcess -FilePath `$installerDest -ArgumentList '$silentSwitchesEscaped' -UseShellExecute -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 30) -TimeoutAction Stop"
                    '    }'
                    '    finally {'
                    '        # Cleanup temp directory'
                    '        if (Test-Path $userTempDir) {'
                    '            Remove-Item -Path $userTempDir -Recurse -Force -ErrorAction SilentlyContinue'
                    '        }'
                    '    }'
                )
            } else {
                $lines += @(
                    "    Start-ADTProcess -FilePath `"`$(`$adtSession.DirFiles)\$installerFileName`" -ArgumentList '$silentSwitchesEscaped' -WindowStyle Hidden -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 30) -TimeoutAction Stop"
                )
            }
        }
    }
}

# Close progress dialog after install operations complete
$lines += @(
    ''
    '    # Close installation progress dialog'
    '    Close-ADTInstallationProgress'
)

# Optional post-install verification (opt-in via PSADT config)
# Throwing here routes through the standard catch -> Close-ADTSession error exit,
# and the detection marker write below is skipped because it never runs
if ($verifyInstall) {
    Write-Host "Post-install verification enabled"
    $lines += @(
        ''
        '    ## Verify the application actually installed before writing the detection marker'
        "    `$verifyApps = Get-ADTApplication -Name '$displayNameSingleQuoteEscaped' -NameMatch 'Contains' -ErrorAction SilentlyContinue"
        '    if (-not $verifyApps) {'
        "        throw `"Post-install verification failed: '$displayNameSingleQuoteEscaped' was not found in the installed applications list. The installer exited without error but the application does not appear to be installed.`""
        '    }'
        "    Write-ADTLogEntry -Message `"Post-install verification passed`" -Source 'Install-ADTDeployment'"
    )
}

# Additional post-install commands (issue #118) - run after the app installs and is
# verified, before the detection marker is written. A failure throws and routes to the
# error exit so the marker is skipped and the deployment is retried.
if ($postInstallCommands.Count -gt 0) {
    Write-Host "Adding $($postInstallCommands.Count) custom post-install command(s) from PSADT config"
    $lines += @(
        ''
        '    ## Custom post-install commands (user-specified)'
    )
    foreach ($postCmd in $postInstallCommands) {
        $postCmdEscaped = $postCmd -replace "'", "''"
        $lines += @(
            "    Write-ADTLogEntry -Message 'Executing post-install command: $postCmdEscaped' -Severity 'Info' -Source 'Install-ADTDeployment'"
            "    Start-ADTProcess -FilePath `"`$env:SystemRoot\System32\cmd.exe`" -ArgumentList '/c $postCmdEscaped' -WorkingDirectory `$adtSession.DirFiles -WindowStyle Hidden"
        )
    }
}

# Write registry marker - scope-aware
if ($IsUserScope) {
    # User-scope: Write to all user hives via Invoke-ADTAllUsersRegistryAction (handles SYSTEM context)
    $lines += @(
        ''
        '    # Write IntuneGet detection marker to all user registry hives'
        '    try {'
        '        Invoke-ADTAllUsersRegistryAction -ScriptBlock {'
        "            Set-ADTRegistryKey -LiteralPath 'HKCU\$registryMarkerPathEscaped\$sanitizedWingetId' -Name 'DisplayName' -Value '$displayNameEscaped' -Type String -SID `$_.SID"
        "            Set-ADTRegistryKey -LiteralPath 'HKCU\$registryMarkerPathEscaped\$sanitizedWingetId' -Name 'Version' -Value '$Version' -Type String -SID `$_.SID"
        "            Set-ADTRegistryKey -LiteralPath 'HKCU\$registryMarkerPathEscaped\$sanitizedWingetId' -Name 'Publisher' -Value '$publisherEscaped' -Type String -SID `$_.SID"
        "            Set-ADTRegistryKey -LiteralPath 'HKCU\$registryMarkerPathEscaped\$sanitizedWingetId' -Name 'WingetId' -Value '$WingetId' -Type String -SID `$_.SID"
        '            Set-ADTRegistryKey -LiteralPath ''HKCU\' + $registryMarkerPathEscaped + '\' + $sanitizedWingetId + ''' -Name ''InstalledDate'' -Value (Get-Date -Format ''o'') -Type String -SID $_.SID'
        '        }'
        '        Write-ADTLogEntry -Message "IntuneGet detection marker written to all user hives" -Severity ''Success'' -Source ''Install-ADTDeployment'''
        '    } catch {'
        '        Write-ADTLogEntry -Message "Warning: Could not write detection marker to user hives: $_" -Severity ''Warning'' -Source ''Install-ADTDeployment'''
        '    }'
    )
} else {
    # Machine-scope: Write to HKLM
    $lines += @(
        ''
        '    # Write IntuneGet detection marker to HKLM (machine-scope app)'
        '    try {'
        "        `$regPath = 'HKLM\$registryMarkerPathEscaped\$sanitizedWingetId'"
        "        Set-ADTRegistryKey -LiteralPath `$regPath -Name 'DisplayName' -Value '$displayNameEscaped' -Type String"
        "        Set-ADTRegistryKey -LiteralPath `$regPath -Name 'Version' -Value '$Version' -Type String"
        "        Set-ADTRegistryKey -LiteralPath `$regPath -Name 'Publisher' -Value '$publisherEscaped' -Type String"
        "        Set-ADTRegistryKey -LiteralPath `$regPath -Name 'WingetId' -Value '$WingetId' -Type String"
        '        Set-ADTRegistryKey -LiteralPath $regPath -Name ''InstalledDate'' -Value (Get-Date -Format ''o'') -Type String'
        '        Write-ADTLogEntry -Message "IntuneGet detection marker written to HKLM registry" -Severity ''Success'' -Source ''Install-ADTDeployment'''
        '    } catch {'
        '        Write-ADTLogEntry -Message "Warning: Could not write detection marker: $_" -Severity ''Warning'' -Source ''Install-ADTDeployment'''
        '    }'
    )
}

# Add post-install UI calls
if ($postInstallPromptCalls) {
    $lines += $postInstallPromptCalls
}
if ($endBalloonCalls) {
    $lines += $endBalloonCalls
}
if ($restartPromptCall) {
    $lines += $restartPromptCall
}

$lines += @(
    '}'
)

$lines += @(
    ''
    'function Uninstall-ADTDeployment'
    '{'
    '    [CmdletBinding()]'
    '    param ()'
)

# Add pre-uninstall prompts
if ($preUninstallPromptCalls) {
    $lines += $preUninstallPromptCalls
}

# Generate uninstall command - custom override takes precedence over registry lookup
if (-not [string]::IsNullOrWhiteSpace($customUninstallCommand)) {
    Write-Host "Using custom uninstall command override from PSADT config"
    $lines += @(
        ''
        '    # Custom uninstall command override (user-specified)'
        "    Write-ADTLogEntry -Message 'Executing custom uninstall command' -Severity 'Info' -Source 'Uninstall-ADTDeployment'"
        "    Start-ADTProcess -FilePath `"`$env:SystemRoot\System32\cmd.exe`" -ArgumentList '/c $customUninstallCommandEscaped' -WorkingDirectory `$adtSession.DirFiles -WindowStyle Hidden"
    )
} elseif ($useRegistryUninstall) {
    $wingetIdEscaped = $WingetId -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
    $lines += @(
        ''
        '    # Use PSADT v4 Uninstall-ADTApplication to find and uninstall'
        '    # This handles the registry lookup, MSI vs EXE detection, and silent'
        '    # switches automatically using the app''s registered QuietUninstallString'
        "    `$appName = '$registryUninstallDisplayName'"
        "    `$wingetId = '$wingetIdEscaped'"
        ''
        '    Write-ADTLogEntry -Message "Searching for installed application: $appName" -Source ''Uninstall-ADTDeployment'''
        '    $installedApp = Get-ADTApplication -Name $appName'
        ''
        '    if ($installedApp) {'
        '        Write-ADTLogEntry -Message "Found via registry name, uninstalling..." -Source ''Uninstall-ADTDeployment'''
        '        Uninstall-ADTApplication -Name $appName -SuccessExitCodes @(0, 1605, 1614) -RebootExitCodes @(1641, 3010)'
        '    } else {'
        '        Write-ADTLogEntry -Message "Not found by name ''$appName'', falling back to winget uninstall --id $wingetId" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
        ''
        '        # Find winget.exe (may not be in PATH when running as SYSTEM)'
        '        $wingetExe = Get-Command winget.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source'
        '        if (-not $wingetExe) {'
        '            $wingetExe = Get-ChildItem "C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*_*__8wekyb3d8bbwe\winget.exe" -ErrorAction SilentlyContinue |'
        '                Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName'
        '        }'
        ''
        '        if ($wingetExe) {'
        '            Start-ADTProcess -FilePath $wingetExe -ArgumentList "uninstall --id $wingetId --silent --accept-source-agreements --disable-interactivity" -WindowStyle Hidden -SuccessExitCodes @(0)'
        '        } else {'
        '            throw "Could not find installed application: $appName (winget not available for fallback)"'
        '        }'
        '    }'
    )
} elseif ($useMsixUninstall) {
    $lines += @(
        ''
        '    # Remove MSIX/APPX provisioned package and installed instances'
        "    `$packageName = '$msixPackageName'"
        '    Write-ADTLogEntry -Message "Removing MSIX package: $packageName" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
        '    try {'
        '        $provPackage = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -like "*$packageName*" }'
        '        if ($provPackage) {'
        '            Write-ADTLogEntry -Message "Removing provisioned package: $($provPackage.DisplayName)" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
        '            $provPackage | Remove-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue'
        '        }'
        '        $packages = Get-AppxPackage -Name "*$packageName*" -AllUsers -ErrorAction SilentlyContinue'
        '        if ($packages) {'
        '            foreach ($pkg in $packages) {'
        '                Write-ADTLogEntry -Message "Removing installed package: $($pkg.PackageFullName)" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
        '                Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers -ErrorAction SilentlyContinue'
        '            }'
        '        }'
        '        Write-ADTLogEntry -Message "MSIX package removal completed" -Severity ''Success'' -Source ''Uninstall-ADTDeployment'''
        '    } catch {'
        '        Write-ADTLogEntry -Message "Failed to remove MSIX package: $_" -Severity ''Error'' -Source ''Uninstall-ADTDeployment'''
        '        throw'
        '    }'
    )
} elseif ($usePortableUninstall) {
    $lines += @(
        ''
        '    # Remove portable app folder'
        "    `$installPath = `"`$env:ProgramFiles\$displayNameEscaped`""
        '    Write-ADTLogEntry -Message "Removing portable app folder: $installPath" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
        '    try {'
        '        if (Test-Path $installPath) {'
        '            Remove-Item -Path $installPath -Recurse -Force -ErrorAction Stop'
        '            Write-ADTLogEntry -Message "Portable app folder removed successfully" -Severity ''Success'' -Source ''Uninstall-ADTDeployment'''
        '        } else {'
        '            Write-ADTLogEntry -Message "Portable app folder not found: $installPath" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
        '        }'
        '    } catch {'
        '        Write-ADTLogEntry -Message "Failed to remove portable app folder: $_" -Severity ''Error'' -Source ''Uninstall-ADTDeployment'''
        '        throw'
        '    }'
    )
} else {
    $lines += @(
        ''
        '    # Execute uninstall command'
        "    `$uninstallCmd = '$uninstallCmd'"
        ''
        '    # Check if this is an MSI uninstall (contains product code GUID)'
        '    if ($uninstallCmd -match ''\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}'') {'
        '        $productCode = $Matches[0]'
        '        Write-ADTLogEntry -Message "Detected MSI product code: $productCode - using Start-ADTMsiProcess" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
        '        Start-ADTMsiProcess -Action ''Uninstall'' -ProductCode $productCode -SuccessExitCodes @(0, 1605, 1614, 3010, 1641)'
        '    } else {'
        '        # EXE-based uninstaller - parse and execute with timeout'
        '        if ($uninstallCmd -match ''^"([^"]+)"(.*)$'') {'
        '            $uninstallExe = $Matches[1]'
        '            $uninstallArgs = $Matches[2].Trim()'
        '        } elseif ($uninstallCmd -match ''^([^\s]+)(.*)$'') {'
        '            $uninstallExe = $Matches[1]'
        '            $uninstallArgs = $Matches[2].Trim()'
        '        } else {'
        '            $uninstallExe = $uninstallCmd'
        '            $uninstallArgs = ""'
        '        }'
        ''
        '        # PSADT v4 requires fully qualified paths - resolve common executables'
        '        if (-not [System.IO.Path]::IsPathRooted($uninstallExe)) {'
        '            $resolved = Get-Command $uninstallExe -ErrorAction SilentlyContinue | Select-Object -First 1'
        '            if ($resolved) { $uninstallExe = $resolved.Source }'
        '        }'
        ''
        '        Write-ADTLogEntry -Message "Executing EXE uninstall: $uninstallExe $uninstallArgs" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
        '        Start-ADTProcess -FilePath $uninstallExe -ArgumentList $uninstallArgs -WindowStyle Hidden -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 15) -TimeoutAction Stop -SuccessExitCodes @(0, 1605, 1614, 3010, 1641)'
        '    }'
    )
}

# Additional post-uninstall commands (issue #118) - run after the app is uninstalled,
# before the detection marker is removed.
if ($postUninstallCommands.Count -gt 0) {
    Write-Host "Adding $($postUninstallCommands.Count) custom post-uninstall command(s) from PSADT config"
    $lines += @(
        ''
        '    ## Custom post-uninstall commands (user-specified)'
    )
    foreach ($postCmd in $postUninstallCommands) {
        $postCmdEscaped = $postCmd -replace "'", "''"
        $lines += @(
            "    Write-ADTLogEntry -Message 'Executing post-uninstall command: $postCmdEscaped' -Severity 'Info' -Source 'Uninstall-ADTDeployment'"
            "    Start-ADTProcess -FilePath `"`$env:SystemRoot\System32\cmd.exe`" -ArgumentList '/c $postCmdEscaped' -WorkingDirectory `$adtSession.DirFiles -WindowStyle Hidden"
        )
    }
}

# Add registry marker removal - scope-aware cleanup
if ($IsUserScope) {
    # User-scope: enumerate all user hives to remove marker (handles SYSTEM context)
    $lines += @(
        ''
        '    # Remove IntuneGet detection marker from all user registry hives'
        '    try {'
        '        Invoke-ADTAllUsersRegistryAction -ScriptBlock {'
        "            Remove-ADTRegistryKey -LiteralPath 'HKCU\$registryMarkerPathEscaped\$sanitizedWingetId' -SID `$_.SID -Recurse -ErrorAction SilentlyContinue"
        '        }'
        '        Write-ADTLogEntry -Message "IntuneGet detection marker cleanup completed across all user hives" -Severity ''Success'' -Source ''Uninstall-ADTDeployment'''
        '    } catch {'
        '        Write-ADTLogEntry -Message "Warning: Could not enumerate user hives for marker cleanup: $_" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
        '    }'
        ''
        '    # Also remove from current HKCU context (fallback for user-context uninstall)'
        '    try {'
        "        `$regPathHKCU = 'HKCU\$registryMarkerPathEscaped\$sanitizedWingetId'"
        '        if (Test-Path -LiteralPath ''Registry::HKEY_CURRENT_USER\' + $registryMarkerPathEscaped + '\' + $sanitizedWingetId + ''' -PathType Container) {'
        '            Remove-ADTRegistryKey -LiteralPath $regPathHKCU -Recurse'
        '        }'
        '    } catch { }'
    )
} else {
    # Machine-scope: marker is only in HKLM
    $lines += @(
        ''
        '    # Remove IntuneGet detection marker from HKLM'
        '    try {'
        "        `$regPathHKLM = 'HKLM\$registryMarkerPathEscaped\$sanitizedWingetId'"
        '        if (Test-Path -LiteralPath ''Registry::HKEY_LOCAL_MACHINE\' + $registryMarkerPathEscaped + '\' + $sanitizedWingetId + ''' -PathType Container) {'
        '            Remove-ADTRegistryKey -LiteralPath $regPathHKLM -Recurse'
        '            Write-ADTLogEntry -Message "IntuneGet detection marker removed from HKLM" -Severity ''Success'' -Source ''Uninstall-ADTDeployment'''
        '        }'
        '    } catch {'
        '        Write-ADTLogEntry -Message "Warning: Could not remove detection marker: $_" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
        '    }'
    )
}

# Add post-uninstall prompts
if ($postUninstallPromptCalls) {
    $lines += $postUninstallPromptCalls
}

$lines += @(
    '}'
)

$lines += @(
    ''
    'function Repair-ADTDeployment'
    '{'
    '    [CmdletBinding()]'
    '    param ()'
    ''
    '    Write-ADTLogEntry -Message "Repair operation is not implemented for this package" -Severity ''Warning'' -Source ''Repair-ADTDeployment'''
    '    Write-ADTLogEntry -Message "To repair, please uninstall and reinstall the application" -Severity ''Info'' -Source ''Repair-ADTDeployment'''
    '}'
    ''
    '##================================================'
    '## MARK: Initialization'
    '##================================================'
    ''
    '$ErrorActionPreference = [System.Management.Automation.ActionPreference]::Stop'
    '$ProgressPreference = [System.Management.Automation.ActionPreference]::SilentlyContinue'
    'Set-StrictMode -Version 1'
    ''
    'try'
    '{'
    '    if (Test-Path -LiteralPath "$PSScriptRoot\PSAppDeployToolkit\PSAppDeployToolkit.psd1" -PathType Leaf)'
    '    {'
    '        Get-ChildItem -LiteralPath "$PSScriptRoot\PSAppDeployToolkit" -Recurse -File | Unblock-File -ErrorAction Ignore'
    "        Import-Module -FullyQualifiedName @{ ModuleName = `"`$PSScriptRoot\PSAppDeployToolkit\PSAppDeployToolkit.psd1`"; Guid = '8c3c366b-8606-4576-9f2d-4051144f7ca2'; ModuleVersion = '$psadtVersion' } -Force"
    '    }'
    '    else'
    '    {'
    "        Import-Module -FullyQualifiedName @{ ModuleName = 'PSAppDeployToolkit'; Guid = '8c3c366b-8606-4576-9f2d-4051144f7ca2'; ModuleVersion = '$psadtVersion' } -Force"
    '    }'
    ''
    '    # Verify module loaded successfully'
    '    if (-not (Get-Module -Name PSAppDeployToolkit)) {'
    '        throw "Failed to import PSAppDeployToolkit module"'
    '    }'
    ''
    '    $iadtParams = Get-ADTBoundParametersAndDefaultValues -Invocation $MyInvocation'
    '    $adtSession = Remove-ADTHashtableNullOrEmptyValues -Hashtable $adtSession'
    '    $adtSession = Open-ADTSession @adtSession @iadtParams -PassThru'
    '}'
    'catch'
    '{'
    '    $Host.UI.WriteErrorLine((Out-String -InputObject $_ -Width ([System.Int32]::MaxValue)))'
    '    exit 60008'
    '}'
    ''
    '##================================================'
    '## MARK: Invocation'
    '##================================================'
    ''
    'try'
    '{'
    '    & "$($adtSession.DeploymentType)-ADTDeployment"'
    '    Close-ADTSession'
    '}'
    'catch'
    '{'
    '    Write-ADTLogEntry -Message "An error occurred: $(Resolve-ADTErrorRecord -ErrorRecord $_)" -Severity ''Error'' -Source ''Main'''
    '    Close-ADTSession -ExitCode 60001'
    '}'
)

$scriptContent = $lines -join "`r`n"
Set-Content -Path "$packageDir\Invoke-AppDeployToolkit.ps1" -Value $scriptContent -Encoding UTF8
Write-Host "Generated PSADT v4 deployment script"
