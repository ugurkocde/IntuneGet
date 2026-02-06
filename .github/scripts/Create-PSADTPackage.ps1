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

# Extract config values with defaults
$installMode = if ($psadtConfig.installMode) { $psadtConfig.installMode } else { 'Auto' }
# Escape special PowerShell characters for embedding in generated script
$silentSwitchesEscaped = $SilentSwitches -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
$uninstallCmd = $UninstallCommand -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
$displayNameEscaped = $DisplayName -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
$publisherEscaped = $Publisher -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
$sanitizedWingetId = $WingetId -replace '[\.\-]', '_'
$installerFileName = $env:INSTALLER_FILENAME
$installerTypeLower = $InstallerType.ToLower()
$psadtVersion = '4.1.8'

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
$registryUninstallSilentSwitch = '/S'
$msixPackageName = ''

if ($uninstallCmd -match '^REGISTRY_UNINSTALL:(.+):(.+)$') {
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

    $registryUninstallSilentSwitch = $Matches[2]
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
$allowDefer = if ($psadtConfig.ContainsKey('allowDefer')) { [bool]$psadtConfig.allowDefer } else { $true }
$deferTimes = if ($psadtConfig.deferTimes) { [int]$psadtConfig.deferTimes } else { 3 }

# Extended welcome parameters
$blockExecution = if ($psadtConfig.blockExecution) { $true } else { $false }
$promptToSave = if ($psadtConfig.promptToSave) { $true } else { $false }
$deferDeadline = $psadtConfig.deferDeadline
$deferDays = $psadtConfig.deferDays
$forceCloseCountdown = $psadtConfig.forceCloseProcessesCountdown
$persistPrompt = if ($psadtConfig.persistPrompt) { $true } else { $false }
$minimizeWindows = if ($psadtConfig.minimizeWindows) { $true } else { $false }
$windowLocation = if ($psadtConfig.windowLocation) { $psadtConfig.windowLocation } else { 'Default' }
$checkDiskSpace = if ($psadtConfig.checkDiskSpace) { $true } else { $false }
$requiredDiskSpace = $psadtConfig.requiredDiskSpace

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
    $welcomeParams = @(
        "-Title '$displayNameEscaped Installation'"
    )

    # Handle parameter sets correctly for PSADT v4
    # When both deferrals AND close prompts are enabled, use -AllowDeferCloseProcesses
    if ($processesToClose.Count -gt 0 -and $allowDefer) {
        $welcomeParams += "-Subtitle 'The following applications must be closed before installation can proceed'"
        $welcomeParams += '-CloseProcesses $script:ProcessesToClose'
        $welcomeParams += '-AllowDeferCloseProcesses'
        $welcomeParams += "-ForceCloseProcessesCountdown $closeCountdown"
        $welcomeParams += "-DeferTimes $deferTimes"
    } elseif ($processesToClose.Count -gt 0) {
        # Only close prompts, no deferrals
        $welcomeParams += "-Subtitle 'The following applications must be closed before installation can proceed'"
        $welcomeParams += '-CloseProcesses $script:ProcessesToClose'
        $welcomeParams += "-CloseProcessesCountdown $closeCountdown"
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
        $progressParams += "-WindowLocation '$($progressConfig.windowLocation)'"
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
    '    RequireAdmin = $true'
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
    "    `$installerPath = Join-Path `$adtSession.DirFiles '$installerFileName'"
    '    if (-not (Test-Path -LiteralPath $installerPath)) {'
    '        Write-ADTLogEntry -Message "Installer file not found: $installerPath" -Severity ''Error'' -Source ''Install-ADTDeployment'''
    '        throw "Installer file not found: $installerPath"'
    '    }'
    ''
    '    # Show installation progress'
    "    Show-ADTInstallationProgress -StatusMessage `"Installing `$(`$adtSession.AppName)...`""
    ''
)

# Generate install command based on installer type
switch ($installerTypeLower) {
    { $_ -in 'msi', 'wix' } {
        $msiProperties = ($silentSwitchesEscaped -replace '/q[nbrfu]?\s*', '' -replace '/quiet\s*', '').Trim()
        if ($msiProperties) {
            $lines += @(
                "    Start-ADTMsiProcess -Action 'Install' -FilePath '$installerFileName' -AdditionalArgumentList '$msiProperties' -IgnoreExitCodes @(0, 3010, 1641)"
            )
        } else {
            $lines += @(
                "    Start-ADTMsiProcess -Action 'Install' -FilePath '$installerFileName' -IgnoreExitCodes @(0, 3010, 1641)"
            )
        }
    }
    { $_ -in 'msix', 'appx' } {
        $lines += @(
            "    `$msixPath = `"`$(`$adtSession.DirFiles)\$installerFileName`""
            '    Write-ADTLogEntry -Message "Provisioning MSIX/APPX package for all users: $msixPath" -Severity ''Info'' -Source ''Install-ADTDeployment'''
            '    try {'
            '        Add-AppxProvisionedPackage -Online -PackagePath $msixPath -SkipLicense -ErrorAction Stop'
            '        Write-ADTLogEntry -Message "MSIX/APPX package provisioned successfully" -Severity ''Info'' -Source ''Install-ADTDeployment'''
            '    } catch {'
            '        Write-ADTLogEntry -Message "Failed to provision MSIX/APPX package: $_" -Severity ''Error'' -Source ''Install-ADTDeployment'''
            '        throw'
            '    }'
        )
    }
    { $_ -in 'zip', 'portable' } {
        $lines += @(
            "    `$zipPath = `"`$(`$adtSession.DirFiles)\$installerFileName`""
            "    `$extractPath = `"`$env:ProgramFiles\$displayNameEscaped`""
            '    Write-ADTLogEntry -Message "Extracting portable app to: $extractPath" -Severity ''Info'' -Source ''Install-ADTDeployment'''
            '    try {'
            '        if (-not (Test-Path $extractPath)) {'
            '            New-Item -Path $extractPath -ItemType Directory -Force | Out-Null'
            '        }'
            '        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force'
            '        Write-ADTLogEntry -Message "Portable app extracted successfully" -Severity ''Info'' -Source ''Install-ADTDeployment'''
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
                "    `$installerDest = Join-Path `$userTempDir '$installerFileName'"
                '    Write-ADTLogEntry -Message "Copying installer to user temp: $installerDest" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                '    Copy-Item -Path $installerSource -Destination $installerDest -Force'
                ''
                '    try {'
                '        Write-ADTLogEntry -Message "Running per-user installer from user temp directory" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                '        # Use -UseShellExecute for shell context which inherits environment variables'
                "        Start-ADTProcess -FilePath `$installerDest -ArgumentList '$silentSwitchesEscaped' -UseShellExecute -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 30) -TimeoutAction SilentlyContinue -IgnoreExitCodes @(0, 3010, 1641)"
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
                "    Start-ADTProcess -FilePath `"`$(`$adtSession.DirFiles)\$installerFileName`" -ArgumentList '$silentSwitchesEscaped' -WindowStyle Hidden -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 30) -TimeoutAction SilentlyContinue -IgnoreExitCodes @(0, 3010, 1641)"
            )
        }
    }
}

# Write registry marker - use HKCU for user-scope (non-admin) apps, HKLM for machine-scope
if ($IsUserScope) {
    # User-scope: Write to HKCU (user has write access)
    $lines += @(
        ''
        '    # Write IntuneGet detection marker to HKCU (user-scope app)'
        '    try {'
        "        `$regPath = 'HKCU:\SOFTWARE\IntuneGet\Apps\$sanitizedWingetId'"
        '        if (-not (Test-Path $regPath)) {'
        '            New-Item -Path $regPath -Force | Out-Null'
        '        }'
        "        Set-ItemProperty -Path `$regPath -Name 'DisplayName' -Value '$displayNameEscaped' -Type String -Force"
        "        Set-ItemProperty -Path `$regPath -Name 'Version' -Value '$Version' -Type String -Force"
        "        Set-ItemProperty -Path `$regPath -Name 'Publisher' -Value '$publisherEscaped' -Type String -Force"
        "        Set-ItemProperty -Path `$regPath -Name 'WingetId' -Value '$WingetId' -Type String -Force"
        '        Set-ItemProperty -Path $regPath -Name ''InstalledDate'' -Value (Get-Date -Format ''o'') -Type String -Force'
        '        Write-ADTLogEntry -Message "IntuneGet detection marker written to HKCU registry" -Severity ''Info'' -Source ''Install-ADTDeployment'''
        '    } catch {'
        '        Write-ADTLogEntry -Message "Warning: Could not write detection marker: $_" -Severity ''Warning'' -Source ''Install-ADTDeployment'''
        '    }'
    )
} else {
    # Machine-scope: Write to HKLM (SYSTEM has write access)
    $lines += @(
        ''
        '    # Write IntuneGet detection marker to HKLM (machine-scope app)'
        '    try {'
        "        `$regPath = 'HKLM:\SOFTWARE\IntuneGet\Apps\$sanitizedWingetId'"
        '        if (-not (Test-Path $regPath)) {'
        '            New-Item -Path $regPath -Force | Out-Null'
        '        }'
        "        Set-ItemProperty -Path `$regPath -Name 'DisplayName' -Value '$displayNameEscaped' -Type String -Force"
        "        Set-ItemProperty -Path `$regPath -Name 'Version' -Value '$Version' -Type String -Force"
        "        Set-ItemProperty -Path `$regPath -Name 'Publisher' -Value '$publisherEscaped' -Type String -Force"
        "        Set-ItemProperty -Path `$regPath -Name 'WingetId' -Value '$WingetId' -Type String -Force"
        '        Set-ItemProperty -Path $regPath -Name ''InstalledDate'' -Value (Get-Date -Format ''o'') -Type String -Force'
        '        Write-ADTLogEntry -Message "IntuneGet detection marker written to HKLM registry" -Severity ''Info'' -Source ''Install-ADTDeployment'''
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

# Generate uninstall command based on whether registry lookup is needed
if ($useRegistryUninstall) {
    $lines += @(
        ''
        '    # Use PSADT v4 native functions to find and uninstall application'
        "    `$appName = '$registryUninstallDisplayName'"
        "    `$silentArgs = '$registryUninstallSilentSwitch'"
        ''
        '    Write-ADTLogEntry -Message "Searching for installed application: $appName" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
        ''
        '    # Use Get-ADTApplication to find the installed app (handles all registry paths automatically)'
        '    $installedApp = Get-ADTApplication -Name $appName -NameMatch ''Contains'''
        ''
        '    # If not found with contains, try regex for more flexible matching'
        '    if (-not $installedApp) {'
        '        # Build regex pattern that handles common suffixes'
        '        $regexPattern = [regex]::Escape($appName) -replace ''\\s+'', ''\s+'''
        '        $installedApp = Get-ADTApplication -Name $regexPattern -NameMatch ''RegEx'''
        '    }'
        ''
        '    if ($installedApp) {'
        '        # If multiple matches, prefer shorter DisplayName (more likely to be main app)'
        '        if ($installedApp -is [array]) {'
        '            $installedApp = $installedApp | Sort-Object { $_.DisplayName.Length } | Select-Object -First 1'
        '        }'
        '        Write-ADTLogEntry -Message "Found installed application: $($installedApp.DisplayName)" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
        ''
        '        # Check if this is an MSI-based installation'
        '        if ($installedApp.ProductCode) {'
        '            Write-ADTLogEntry -Message "Detected MSI product code: $($installedApp.ProductCode) - using Start-ADTMsiProcess" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
        '            Start-ADTMsiProcess -Action ''Uninstall'' -ProductCode $installedApp.ProductCode -IgnoreExitCodes @(0, 3010, 1605, 1614)'
        '        } else {'
        '            # EXE-based uninstaller - use Uninstall-ADTApplication for automatic handling'
        '            Write-ADTLogEntry -Message "Using Uninstall-ADTApplication for EXE-based uninstaller" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
        '            Uninstall-ADTApplication -Name $installedApp.DisplayName -NameMatch ''Exact'' -ApplicationType ''EXE'' -ArgumentList $silentArgs -IgnoreExitCodes @(0, 3010, 1641, 1605)'
        '        }'
        '    } else {'
        '        Write-ADTLogEntry -Message "No installed application found for: $appName" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
        '        throw "Could not find installed application: $appName"'
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
        '        Write-ADTLogEntry -Message "MSIX package removal completed" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
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
        '            Write-ADTLogEntry -Message "Portable app folder removed successfully" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
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
        '        Start-ADTMsiProcess -Action ''Uninstall'' -ProductCode $productCode -IgnoreExitCodes @(0, 3010, 1605, 1614)'
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
        '        Start-ADTProcess -FilePath $uninstallExe -ArgumentList $uninstallArgs -WindowStyle Hidden -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 15) -TimeoutAction Stop -IgnoreExitCodes @(0, 3010, 1641, 1605)'
        '    }'
    )
}

# Add registry marker removal - check both HKLM and HKCU for cleanup
$lines += @(
    ''
    '    # Remove IntuneGet detection marker from registry (check both HKLM and HKCU)'
    '    try {'
    "        `$regPathHKLM = 'HKLM:\SOFTWARE\IntuneGet\Apps\$sanitizedWingetId'"
    "        `$regPathHKCU = 'HKCU:\SOFTWARE\IntuneGet\Apps\$sanitizedWingetId'"
    '        if (Test-Path $regPathHKLM) {'
    '            Remove-Item -Path $regPathHKLM -Force -Recurse'
    '            Write-ADTLogEntry -Message "IntuneGet detection marker removed from HKLM" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
    '        }'
    '        if (Test-Path $regPathHKCU) {'
    '            Remove-Item -Path $regPathHKCU -Force -Recurse'
    '            Write-ADTLogEntry -Message "IntuneGet detection marker removed from HKCU" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
    '        }'
    '    } catch {'
    '        Write-ADTLogEntry -Message "Warning: Could not remove detection marker: $_" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
    '    }'
)

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
