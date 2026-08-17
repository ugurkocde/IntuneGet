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
$InstallerSuccessCodes = @()
if (-not [string]::IsNullOrWhiteSpace($env:INPUT_INSTALLER_SUCCESS_CODES)) {
    try {
        $InstallerSuccessCodes = @($env:INPUT_INSTALLER_SUCCESS_CODES | ConvertFrom-Json -ErrorAction Stop)
    }
    catch {
        throw 'INPUT_INSTALLER_SUCCESS_CODES must be a JSON array of integer exit codes.'
    }
}
$InstallerSuccessCodes = @($InstallerSuccessCodes | ForEach-Object {
    $parsedCode = 0
    if (-not [int]::TryParse([string]$_, [ref]$parsedCode) -or $parsedCode -lt 0 -or $parsedCode -gt 65535) {
        throw "Invalid installer success exit code: $_"
    }
    $parsedCode
} | Sort-Object -Unique)
$appSuccessExitCodesLiteral = (@(0) + $InstallerSuccessCodes | Sort-Object -Unique) -join ', '
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
$PackageDependencies = @()
if (-not [string]::IsNullOrWhiteSpace($env:INPUT_PACKAGE_DEPENDENCIES)) {
    try {
        $PackageDependencies = @($env:INPUT_PACKAGE_DEPENDENCIES | ConvertFrom-Json -ErrorAction Stop)
    }
    catch {
        throw 'INPUT_PACKAGE_DEPENDENCIES must be a JSON array.'
    }
}
if ($PackageDependencies.Count -gt 8) {
    throw 'INPUT_PACKAGE_DEPENDENCIES cannot contain more than 8 packages.'
}

foreach ($dependency in $PackageDependencies) {
    if ([string]::IsNullOrWhiteSpace([string]$dependency.packageIdentifier) -or
        [string]::IsNullOrWhiteSpace([string]$dependency.version) -or
        [string]::IsNullOrWhiteSpace([string]$dependency.fileName) -or
        [string]::IsNullOrWhiteSpace([string]$dependency.installerSha256)) {
        throw 'Every package dependency must include an identifier, version, filename, and SHA-256.'
    }
    $dependencyIdentifier = [string]$dependency.packageIdentifier
    $dependencyInstallerType = ([string]$dependency.installerType).ToLowerInvariant()
    $isVCRedistributable = $dependencyIdentifier -match '^Microsoft\.VCRedist\.[A-Za-z0-9+.-]+\.(x86|x64|arm64)$'
    $isDotNetDesktopRuntime = $dependencyIdentifier -match '^Microsoft\.DotNet\.DesktopRuntime\.\d+$'
    $isDotNetAspNetCoreRuntime = $dependencyIdentifier -match '^Microsoft\.DotNet\.AspNetCore\.\d+$'
    $isPowerShell = $dependencyIdentifier -eq 'Microsoft.PowerShell'
    $isVCLibsDesktop = $dependencyIdentifier -eq 'Microsoft.VCLibs.Desktop.14'
    if (-not ($isVCRedistributable -or $isDotNetDesktopRuntime -or $isDotNetAspNetCoreRuntime -or $isPowerShell -or $isVCLibsDesktop)) {
        throw "Package dependency is not in the reviewed redistribution allowlist: $($dependency.packageIdentifier)"
    }
    $reviewedInstallerTypes = if ($isPowerShell) {
        @('msi', 'wix')
    }
    elseif ($isVCLibsDesktop) {
        @('zip')
    }
    else {
        @('exe', 'burn')
    }
    if ($dependencyInstallerType -notin $reviewedInstallerTypes) {
        throw "Package dependency uses an unreviewed installer type: $($dependency.installerType)"
    }
    if ($isVCLibsDesktop) {
        $dependencyNestedType = ([string]$dependency.nestedInstallerType).ToLowerInvariant()
        $dependencyNestedPath = ([string]$dependency.nestedInstallerPath).Replace('/', '\')
        $dependencyPackageFamilyName = [string]$dependency.packageFamilyName
        if ($dependencyNestedType -ne 'appx' -or
            [string]::IsNullOrWhiteSpace($dependencyNestedPath) -or
            [string]::IsNullOrWhiteSpace($dependencyPackageFamilyName) -or
            [System.IO.Path]::IsPathRooted($dependencyNestedPath) -or
            @($dependencyNestedPath.Split('\')) -contains '..') {
            throw 'Microsoft.VCLibs.Desktop.14 must use the reviewed relative APPX payload from its ZIP package.'
        }
    }
    if ([string]$dependency.fileName -match '[\\/:*?"<>|]' -or
        [System.IO.Path]::GetFileName([string]$dependency.fileName) -ne [string]$dependency.fileName) {
        throw "Package dependency filename is unsafe: $($dependency.fileName)"
    }
    if ([string]$dependency.installerSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
        throw "Package dependency SHA-256 is invalid: $($dependency.packageIdentifier)"
    }
    foreach ($exitCode in @($dependency.successCodes) + @($dependency.rebootCodes)) {
        $parsedDependencyExitCode = 0
        if (-not [int]::TryParse([string]$exitCode, [ref]$parsedDependencyExitCode)) {
            throw "Package dependency exit code is invalid: $exitCode"
        }
    }
}

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

if ($PackageDependencies.Count -gt 0) {
    if ([string]::IsNullOrWhiteSpace($env:DEPENDENCIES_PATH) -or
        -not (Test-Path -LiteralPath $env:DEPENDENCIES_PATH -PathType Container)) {
        throw 'DEPENDENCIES_PATH must point to the verified dependency download directory.'
    }
    $dependencyFilesDir = Join-Path $filesDir 'Dependencies'
    $null = New-Item -ItemType Directory -Path $dependencyFilesDir -Force
    foreach ($dependency in $PackageDependencies) {
        $dependencySource = Join-Path $env:DEPENDENCIES_PATH ([string]$dependency.fileName)
        if (-not (Test-Path -LiteralPath $dependencySource -PathType Leaf)) {
            throw "Verified package dependency file was not found: $($dependency.packageIdentifier)"
        }
        $dependencyHash = (Get-FileHash -LiteralPath $dependencySource -Algorithm SHA256).Hash
        if ($dependencyHash -ne ([string]$dependency.installerSha256).ToUpperInvariant()) {
            throw "Package dependency hash changed before packaging: $($dependency.packageIdentifier)"
        }
        Copy-Item -LiteralPath $dependencySource -Destination (Join-Path $dependencyFilesDir ([string]$dependency.fileName)) -Force
    }
}

# Parse PSADT configuration
$psadtConfig = @{}
if ($env:PSADT_CONFIG -and $env:PSADT_CONFIG -ne '{}') {
    try {
        $psadtConfig = $env:PSADT_CONFIG | ConvertFrom-Json -AsHashtable -NoEnumerate
        if ($psadtConfig -isnot [System.Collections.IDictionary]) {
            throw 'The top-level PSADT_CONFIG value must be a JSON object.'
        }
    } catch {
        throw "PSADT_CONFIG must be valid JSON; refusing to package with different defaults. $($_.Exception.Message)"
    }
}

# Parse the bounded values supplied only by reviewed application adapters.
# These are not a customer-facing free-form command surface.
$reviewedInstallArguments = @()
if ($psadtConfig.Contains('reviewedInstallArguments') -and
    $null -ne $psadtConfig['reviewedInstallArguments']) {
    $rawReviewedInstallArguments = $psadtConfig['reviewedInstallArguments']
    if ($rawReviewedInstallArguments -is [string] -or
        $rawReviewedInstallArguments -isnot [System.Collections.IEnumerable]) {
        throw 'PSADT reviewedInstallArguments must be an array.'
    }

    $seenReviewedInstallArguments = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($rawReviewedInstallArgument in @($rawReviewedInstallArguments)) {
        if ($rawReviewedInstallArgument -isnot [string]) {
            throw 'Every PSADT reviewed install argument must be a string.'
        }
        $reviewedInstallArgument = $rawReviewedInstallArgument.Trim()
        if ([string]::IsNullOrWhiteSpace($reviewedInstallArgument) -or
            $reviewedInstallArgument.Length -gt 256 -or
            [regex]::IsMatch($reviewedInstallArgument, '[\x00-\x1F\x7F]')) {
            throw 'Every PSADT reviewed install argument must be a non-empty, bounded, single-line string.'
        }
        if ($seenReviewedInstallArguments.Add($reviewedInstallArgument)) {
            $reviewedInstallArguments += $reviewedInstallArgument
        }
    }
    if ($reviewedInstallArguments.Count -gt 20) {
        throw 'PSADT reviewedInstallArguments must contain at most 20 entries.'
    }
}

$reviewedInstallArgumentsOverride = ''
if ($psadtConfig.Contains('reviewedInstallArgumentsOverride') -and
    $null -ne $psadtConfig['reviewedInstallArgumentsOverride']) {
    if ($psadtConfig['reviewedInstallArgumentsOverride'] -isnot [string]) {
        throw 'PSADT reviewedInstallArgumentsOverride must be a string.'
    }
    $reviewedInstallArgumentsOverride = $psadtConfig['reviewedInstallArgumentsOverride'].Trim()
    if ([string]::IsNullOrWhiteSpace($reviewedInstallArgumentsOverride) -or
        $reviewedInstallArgumentsOverride.Length -gt 256 -or
        [regex]::IsMatch($reviewedInstallArgumentsOverride, '[\x00-\x1F\x7F]')) {
        throw 'PSADT reviewedInstallArgumentsOverride must be a non-empty, bounded, single-line string.'
    }
}

$reviewedInstallShieldAdministrativeImageConfigured = $false
$reviewedInstallShieldMsiExpectedFileName = ''
if ($psadtConfig.Contains('reviewedInstallShieldAdministrativeImage') -and
    $null -ne $psadtConfig['reviewedInstallShieldAdministrativeImage']) {
    $rawInstallShieldAdministrativeImage = $psadtConfig['reviewedInstallShieldAdministrativeImage']
    if ($rawInstallShieldAdministrativeImage -isnot [System.Collections.IDictionary]) {
        throw 'PSADT reviewedInstallShieldAdministrativeImage must be a JSON object.'
    }
    foreach ($installShieldAdministrativeImageKey in $rawInstallShieldAdministrativeImage.Keys) {
        if ([string]$installShieldAdministrativeImageKey -notin @('expectedMsiFileName')) {
            throw "PSADT reviewedInstallShieldAdministrativeImage contains an unsupported property: $installShieldAdministrativeImageKey"
        }
    }
    if (-not $rawInstallShieldAdministrativeImage.Contains('expectedMsiFileName') -or
        $rawInstallShieldAdministrativeImage['expectedMsiFileName'] -isnot [string]) {
        throw 'PSADT reviewedInstallShieldAdministrativeImage must include expectedMsiFileName as a string.'
    }
    $reviewedInstallShieldMsiExpectedFileName =
        ([string]$rawInstallShieldAdministrativeImage['expectedMsiFileName']).Trim()
    if ([string]::IsNullOrWhiteSpace($reviewedInstallShieldMsiExpectedFileName) -or
        $reviewedInstallShieldMsiExpectedFileName.Length -gt 128 -or
        [System.IO.Path]::GetFileName($reviewedInstallShieldMsiExpectedFileName) -ne $reviewedInstallShieldMsiExpectedFileName -or
        $reviewedInstallShieldMsiExpectedFileName -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._()-]*\.msi$' -or
        $reviewedInstallShieldMsiExpectedFileName.Contains('..')) {
        throw 'PSADT reviewedInstallShieldAdministrativeImage expectedMsiFileName must be a safe literal MSI filename.'
    }
    $reviewedInstallShieldAdministrativeImageConfigured = $true
}

$reviewedUninstallArguments = @()
if ($psadtConfig.Contains('reviewedUninstallArguments') -and
    $null -ne $psadtConfig['reviewedUninstallArguments']) {
    $rawReviewedArguments = $psadtConfig['reviewedUninstallArguments']
    if ($rawReviewedArguments -is [string] -or
        $rawReviewedArguments -isnot [System.Collections.IEnumerable]) {
        throw 'PSADT reviewedUninstallArguments must be an array.'
    }

    $seenReviewedArguments = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($rawReviewedArgument in @($rawReviewedArguments)) {
        if ($rawReviewedArgument -isnot [string]) {
            throw 'Every PSADT reviewed uninstall argument must be a string.'
        }
        $reviewedArgument = $rawReviewedArgument.Trim()
        if ([string]::IsNullOrWhiteSpace($reviewedArgument) -or
            $reviewedArgument.Length -gt 256 -or
            [regex]::IsMatch($reviewedArgument, '[\x00-\x1F\x7F]')) {
            throw 'Every PSADT reviewed uninstall argument must be a non-empty, bounded, single-line string.'
        }
        if ($seenReviewedArguments.Add($reviewedArgument)) {
            $reviewedUninstallArguments += $reviewedArgument
        }
    }
    if ($reviewedUninstallArguments.Count -gt 20) {
        throw 'PSADT reviewedUninstallArguments must contain at most 20 entries.'
    }
}
$reviewedUninstallArgumentsLiteral = @(
    $reviewedUninstallArguments | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }
) -join ', '

$reviewedUninstallProcessGuardConfigured = $false
$reviewedUninstallProcessGuardName = ''
$reviewedUninstallProcessGuardPattern = ''
$reviewedUninstallProcessGuardGraceSeconds = 0
if ($psadtConfig.Contains('reviewedUninstallProcessGuard') -and
    $null -ne $psadtConfig['reviewedUninstallProcessGuard']) {
    $rawProcessGuard = $psadtConfig['reviewedUninstallProcessGuard']
    if ($rawProcessGuard -isnot [System.Collections.IDictionary]) {
        throw 'PSADT reviewedUninstallProcessGuard must be an object.'
    }

    $reviewedUninstallProcessGuardName = ([string]$rawProcessGuard['processName']).Trim()
    $reviewedUninstallProcessGuardPattern = ([string]$rawProcessGuard['argumentsPattern']).Trim()
    $rawProcessGuardGraceSeconds = $rawProcessGuard['graceSeconds']
    if ($reviewedUninstallProcessGuardName -notmatch '^[A-Za-z0-9 _().-]+\.exe$' -or
        $reviewedUninstallProcessGuardName.Length -gt 128) {
        throw 'PSADT reviewedUninstallProcessGuard.processName must be a bounded executable leaf name.'
    }
    if ([string]::IsNullOrWhiteSpace($reviewedUninstallProcessGuardPattern) -or
        $reviewedUninstallProcessGuardPattern.Length -gt 256 -or
        [regex]::IsMatch($reviewedUninstallProcessGuardPattern, '[\x00-\x1F\x7F]')) {
        throw 'PSADT reviewedUninstallProcessGuard.argumentsPattern must be a bounded, single-line regular expression.'
    }
    try {
        [void][regex]::new($reviewedUninstallProcessGuardPattern)
    }
    catch {
        throw 'PSADT reviewedUninstallProcessGuard.argumentsPattern must be a valid regular expression.'
    }
    if (($rawProcessGuardGraceSeconds -isnot [byte] -and
         $rawProcessGuardGraceSeconds -isnot [int16] -and
         $rawProcessGuardGraceSeconds -isnot [int32] -and
         $rawProcessGuardGraceSeconds -isnot [int64]) -or
        [int]$rawProcessGuardGraceSeconds -lt 5 -or
        [int]$rawProcessGuardGraceSeconds -gt 120) {
        throw 'PSADT reviewedUninstallProcessGuard.graceSeconds must be an integer from 5 to 120.'
    }
    $reviewedUninstallProcessGuardGraceSeconds = [int]$rawProcessGuardGraceSeconds
    $reviewedUninstallProcessGuardConfigured = $true
}

$reviewedUninstallProcessGuardMsiLines = @(
    '        Start-ADTMsiProcess -Action ''Uninstall'' -ProductCode $capturedMsiProductCode -SuccessExitCodes @(0, 1605, 1614) -RebootExitCodes @(1641, 3010)'
)
if ($reviewedUninstallProcessGuardConfigured) {
    $reviewedUninstallProcessGuardNameLiteral = $reviewedUninstallProcessGuardName -replace "'", "''"
    $reviewedUninstallProcessGuardPatternLiteral = $reviewedUninstallProcessGuardPattern -replace "'", "''"
    $reviewedUninstallProcessGuardMsiLines = @(
        "        `$reviewedGuardProcessName = '$reviewedUninstallProcessGuardNameLiteral'"
        "        `$reviewedGuardArgumentsPattern = '$reviewedUninstallProcessGuardPatternLiteral'"
        "        `$reviewedGuardGraceSeconds = $reviewedUninstallProcessGuardGraceSeconds"
        '        $reviewedGuardStartedAt = [DateTime]::UtcNow.AddSeconds(-2)'
        '        $reviewedGuardJob = Start-Job -ScriptBlock {'
        '            param($ProcessName, $ArgumentsPattern, $StartedAt, $GraceSeconds)'
        '            $deadline = [DateTime]::UtcNow.AddMinutes(3)'
        '            do {'
        '                $candidate = Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue | Where-Object {'
        '                    $_.Name -ieq $ProcessName -and'
        '                    $null -ne $_.CreationDate -and'
        '                    $_.CreationDate.ToUniversalTime() -ge $StartedAt -and'
        '                    [regex]::IsMatch([string]$_.CommandLine, $ArgumentsPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)'
        '                } | Select-Object -First 1'
        '                if ($null -ne $candidate) {'
        '                    Start-Sleep -Seconds $GraceSeconds'
        '                    $current = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $($candidate.ProcessId)" -ErrorAction SilentlyContinue'
        '                    if ($null -ne $current -and'
        '                        $current.Name -ieq $ProcessName -and'
        '                        [regex]::IsMatch([string]$current.CommandLine, $ArgumentsPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {'
        '                        Stop-Process -Id $current.ProcessId -Force -ErrorAction Stop'
        '                        return "Ended the reviewed vendor uninstall helper after its grace period."'
        '                    }'
        '                    return'
        '                }'
        '                Start-Sleep -Seconds 1'
        '            } while ([DateTime]::UtcNow -lt $deadline)'
        '        } -ArgumentList $reviewedGuardProcessName, $reviewedGuardArgumentsPattern, $reviewedGuardStartedAt, $reviewedGuardGraceSeconds'
        '        try {'
        '            Start-ADTMsiProcess -Action ''Uninstall'' -ProductCode $capturedMsiProductCode -SuccessExitCodes @(0, 1605, 1614) -RebootExitCodes @(1641, 3010)'
        '        } finally {'
        '            if ($null -ne $reviewedGuardJob) {'
        '                if ($reviewedGuardJob.State -in @(''NotStarted'', ''Running'')) {'
        '                    Stop-Job -Job $reviewedGuardJob -ErrorAction SilentlyContinue'
        '                }'
        '                foreach ($guardMessage in @(Receive-Job -Job $reviewedGuardJob -ErrorAction SilentlyContinue)) {'
        '                    if (-not [string]::IsNullOrWhiteSpace([string]$guardMessage)) {'
        '                        Write-ADTLogEntry -Message ([string]$guardMessage) -Source ''Uninstall-ADTDeployment'''
        '                    }'
        '                }'
        '                Remove-Job -Job $reviewedGuardJob -Force -ErrorAction SilentlyContinue'
        '            }'
        '        }'
    )
}

$reviewedMultiProductInstallDisplayNamePrefixes = @()
if ($psadtConfig.Contains('reviewedMultiProductInstallDisplayNamePrefixes') -and
    $null -ne $psadtConfig['reviewedMultiProductInstallDisplayNamePrefixes']) {
    $rawMultiProductPrefixes = $psadtConfig['reviewedMultiProductInstallDisplayNamePrefixes']
    if ($rawMultiProductPrefixes -is [string] -or
        $rawMultiProductPrefixes -isnot [System.Collections.IEnumerable]) {
        throw 'PSADT reviewedMultiProductInstallDisplayNamePrefixes must be an array.'
    }

    $seenMultiProductPrefixes = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($rawMultiProductPrefix in @($rawMultiProductPrefixes)) {
        if ($rawMultiProductPrefix -isnot [string]) {
            throw 'Every reviewed multi-product display-name prefix must be a string.'
        }
        $multiProductPrefix = $rawMultiProductPrefix.Trim()
        if ([string]::IsNullOrWhiteSpace($multiProductPrefix) -or
            $multiProductPrefix.Length -gt 128 -or
            [regex]::IsMatch($multiProductPrefix, '[\x00-\x1F\x7F]')) {
            throw 'Every reviewed multi-product display-name prefix must be non-empty, bounded, and single-line.'
        }
        if ($seenMultiProductPrefixes.Add($multiProductPrefix)) {
            $reviewedMultiProductInstallDisplayNamePrefixes += $multiProductPrefix
        }
    }
    if ($reviewedMultiProductInstallDisplayNamePrefixes.Count -gt 20) {
        throw 'PSADT reviewedMultiProductInstallDisplayNamePrefixes must contain at most 20 entries.'
    }
}
$reviewedMultiProductInstallDisplayNamePrefixesLiteral = @(
    $reviewedMultiProductInstallDisplayNamePrefixes | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }
) -join ', '
$reviewedMultiProductInstallMinimumCount = 0
if ($reviewedMultiProductInstallDisplayNamePrefixes.Count -gt 0) {
    $rawMultiProductMinimumCount = $psadtConfig['reviewedMultiProductInstallMinimumCount']
    if (-not $psadtConfig.Contains('reviewedMultiProductInstallMinimumCount') -or
        ($rawMultiProductMinimumCount -isnot [byte] -and
         $rawMultiProductMinimumCount -isnot [int16] -and
         $rawMultiProductMinimumCount -isnot [int32] -and
         $rawMultiProductMinimumCount -isnot [int64]) -or
        [int]$rawMultiProductMinimumCount -lt 2 -or
        [int]$rawMultiProductMinimumCount -gt 100) {
        throw 'PSADT reviewedMultiProductInstallMinimumCount must be an integer from 2 to 100 when multi-product evidence is configured.'
    }
    $reviewedMultiProductInstallMinimumCount = [int]$rawMultiProductMinimumCount
}

$reviewedRegistryInstallEvidenceConfigured = $false
$reviewedRegistryInstallEvidenceKeyPath = ''
$reviewedRegistryInstallEvidenceProviderPath = ''
$reviewedRegistryInstallEvidenceValueName = ''
$reviewedRegistryInstallEvidenceMinimumDword = [uint64]0
if ($psadtConfig.Contains('reviewedRegistryInstallEvidence') -and
    $null -ne $psadtConfig['reviewedRegistryInstallEvidence']) {
    $rawRegistryEvidence = $psadtConfig['reviewedRegistryInstallEvidence']
    if ($rawRegistryEvidence -isnot [System.Collections.IDictionary]) {
        throw 'PSADT reviewedRegistryInstallEvidence must be a JSON object.'
    }

    $allowedRegistryEvidenceKeys = @('keyPath', 'valueName', 'minimumDword')
    foreach ($registryEvidenceKey in @($rawRegistryEvidence.Keys)) {
        if ([string]$registryEvidenceKey -notin $allowedRegistryEvidenceKeys) {
            throw "PSADT reviewedRegistryInstallEvidence contains an unsupported property: $registryEvidenceKey"
        }
    }
    foreach ($requiredRegistryEvidenceKey in $allowedRegistryEvidenceKeys) {
        if (-not $rawRegistryEvidence.Contains($requiredRegistryEvidenceKey)) {
            throw "PSADT reviewedRegistryInstallEvidence must include $requiredRegistryEvidenceKey."
        }
    }
    if ($rawRegistryEvidence['keyPath'] -isnot [string] -or
        $rawRegistryEvidence['valueName'] -isnot [string]) {
        throw 'PSADT reviewedRegistryInstallEvidence keyPath and valueName must be strings.'
    }

    $reviewedRegistryInstallEvidenceKeyPath = ([string]$rawRegistryEvidence['keyPath']).Trim()
    if ($reviewedRegistryInstallEvidenceKeyPath.Length -gt 260 -or
        $reviewedRegistryInstallEvidenceKeyPath -notmatch '^HKLM:\\SOFTWARE\\[^\\/*?"<>|\x00-\x1F\x7F]+(?:\\[^\\/*?"<>|\x00-\x1F\x7F]+)*$' -or
        @($reviewedRegistryInstallEvidenceKeyPath -split '\\') -contains '..') {
        throw 'PSADT reviewedRegistryInstallEvidence keyPath must be a safe literal path below HKLM:\SOFTWARE.'
    }
    $reviewedRegistryInstallEvidenceValueName = ([string]$rawRegistryEvidence['valueName']).Trim()
    if ([string]::IsNullOrWhiteSpace($reviewedRegistryInstallEvidenceValueName) -or
        $reviewedRegistryInstallEvidenceValueName.Length -gt 128 -or
        [regex]::IsMatch($reviewedRegistryInstallEvidenceValueName, '[\\/*?"<>|\x00-\x1F\x7F]')) {
        throw 'PSADT reviewedRegistryInstallEvidence valueName must be a safe bounded literal name.'
    }

    $rawRegistryMinimumDword = $rawRegistryEvidence['minimumDword']
    if (($rawRegistryMinimumDword -isnot [byte] -and
         $rawRegistryMinimumDword -isnot [uint16] -and
         $rawRegistryMinimumDword -isnot [int16] -and
         $rawRegistryMinimumDword -isnot [uint32] -and
         $rawRegistryMinimumDword -isnot [int32] -and
         $rawRegistryMinimumDword -isnot [uint64] -and
         $rawRegistryMinimumDword -isnot [int64]) -or
        [int64]$rawRegistryMinimumDword -lt 1 -or
        [uint64]$rawRegistryMinimumDword -gt [uint32]::MaxValue) {
        throw 'PSADT reviewedRegistryInstallEvidence minimumDword must be an integer from 1 to 4294967295.'
    }
    $reviewedRegistryInstallEvidenceMinimumDword = [uint64]$rawRegistryMinimumDword
    $reviewedRegistryInstallEvidenceProviderPath =
        'Registry::HKEY_LOCAL_MACHINE\' + $reviewedRegistryInstallEvidenceKeyPath.Substring('HKLM:\'.Length)
    $reviewedRegistryInstallEvidenceConfigured = $true
}

if ($reviewedRegistryInstallEvidenceConfigured -and
    $reviewedMultiProductInstallDisplayNamePrefixes.Count -gt 0) {
    throw 'PSADT reviewed registry and multi-product install evidence cannot be combined.'
}

$uninstallCompletionTimeoutMinutes = 5
if ($psadtConfig.Contains('uninstallCompletionTimeoutMinutes') -and
    $null -ne $psadtConfig['uninstallCompletionTimeoutMinutes']) {
    $rawUninstallTimeout = $psadtConfig['uninstallCompletionTimeoutMinutes']
    if ($rawUninstallTimeout -isnot [byte] -and
        $rawUninstallTimeout -isnot [int16] -and
        $rawUninstallTimeout -isnot [int32] -and
        $rawUninstallTimeout -isnot [int64]) {
        throw 'PSADT uninstallCompletionTimeoutMinutes must be an integer from 1 to 30.'
    }
    $uninstallCompletionTimeoutMinutes = [int]$rawUninstallTimeout
    if ($uninstallCompletionTimeoutMinutes -lt 1 -or
        $uninstallCompletionTimeoutMinutes -gt 30) {
        throw 'PSADT uninstallCompletionTimeoutMinutes must be an integer from 1 to 30.'
    }
}

function Get-StrictPSADTBoolean {
    param(
        [Parameter(Mandatory = $true)]
        [System.Collections.IDictionary]$Config,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [bool]$Default = $false
    )

    if (-not $Config.Contains($Name) -or $null -eq $Config[$Name]) {
        return $Default
    }
    if ($Config[$Name] -isnot [bool]) {
        throw "PSADT $Name must be a JSON boolean."
    }
    return [bool]$Config[$Name]
}

$preserveVendorInstallationOnUninstall = Get-StrictPSADTBoolean `
    -Config $psadtConfig `
    -Name 'preserveVendorInstallationOnUninstall'
if ($reviewedRegistryInstallEvidenceConfigured -and
    -not $preserveVendorInstallationOnUninstall) {
    throw 'PSADT reviewedRegistryInstallEvidence requires preserveVendorInstallationOnUninstall.'
}

$reviewedManagedInstallDirectory = ''
if ($psadtConfig.Contains('reviewedManagedInstallDirectory') -and
    $null -ne $psadtConfig['reviewedManagedInstallDirectory']) {
    if ($psadtConfig['reviewedManagedInstallDirectory'] -isnot [string]) {
        throw 'PSADT reviewedManagedInstallDirectory must be a string.'
    }
    $reviewedManagedInstallDirectory = ([string]$psadtConfig['reviewedManagedInstallDirectory']).Trim()
    $isReviewedMachineManagedDirectory =
        $reviewedManagedInstallDirectory -match '^(?:%(?:ProgramW6432|ProgramFiles|ProgramFiles\(x86\))%\\|%SystemDrive%\\SWSetup\\)[^*?"<>|\x00-\x1f]+$'
    $isReviewedUserDesktopManagedDirectory =
        $IsUserScope -and
        $reviewedManagedInstallDirectory -match '^%USERPROFILE%\\Desktop\\[^*?"<>|\x00-\x1f]+$'
    if ($reviewedManagedInstallDirectory.Length -gt 260 -or
        -not ($isReviewedMachineManagedDirectory -or $isReviewedUserDesktopManagedDirectory) -or
        @($reviewedManagedInstallDirectory -split '\\') -contains '..') {
        throw 'PSADT reviewedManagedInstallDirectory must be a safe machine path or a reviewed user Desktop path for a user-scope package.'
    }
}

$reviewedManagedInstallEvidenceFile = ''
$reviewedManagedInstallCompletionProcess = ''
$reviewedManagedInstallCompletionTimeoutMinutes = 0
$hasManagedInstallCompletionContract =
    ($psadtConfig.Contains('reviewedManagedInstallEvidenceFile') -and
     $null -ne $psadtConfig['reviewedManagedInstallEvidenceFile']) -or
    ($psadtConfig.Contains('reviewedManagedInstallCompletionProcess') -and
     $null -ne $psadtConfig['reviewedManagedInstallCompletionProcess']) -or
    ($psadtConfig.Contains('reviewedManagedInstallCompletionTimeoutMinutes') -and
     $null -ne $psadtConfig['reviewedManagedInstallCompletionTimeoutMinutes'])
if ($hasManagedInstallCompletionContract) {
    if ([string]::IsNullOrWhiteSpace($reviewedManagedInstallDirectory)) {
        throw 'PSADT reviewed managed install completion requires reviewedManagedInstallDirectory.'
    }
    if ($psadtConfig['reviewedManagedInstallEvidenceFile'] -isnot [string]) {
        throw 'PSADT reviewedManagedInstallEvidenceFile must be a string.'
    }
    $reviewedManagedInstallEvidenceFile = ([string]$psadtConfig['reviewedManagedInstallEvidenceFile']).Trim()
    if ($reviewedManagedInstallEvidenceFile.Length -gt 260 -or
        $reviewedManagedInstallEvidenceFile -notmatch '^(?:%(?:ProgramW6432|ProgramFiles|ProgramFiles\(x86\))%\\|%SystemDrive%\\SWSetup\\)[^*?"<>|\x00-\x1f]+$' -or
        @($reviewedManagedInstallEvidenceFile -split '\\') -contains '..' -or
        -not $reviewedManagedInstallEvidenceFile.StartsWith(
            $reviewedManagedInstallDirectory.TrimEnd('\') + '\',
            [System.StringComparison]::OrdinalIgnoreCase
        )) {
        throw 'PSADT reviewedManagedInstallEvidenceFile must be a safe file below reviewedManagedInstallDirectory.'
    }
    if ($psadtConfig.Contains('reviewedManagedInstallCompletionProcess') -and
        $null -ne $psadtConfig['reviewedManagedInstallCompletionProcess']) {
        if ($psadtConfig['reviewedManagedInstallCompletionProcess'] -isnot [string]) {
            throw 'PSADT reviewedManagedInstallCompletionProcess must be a string.'
        }
        $reviewedManagedInstallCompletionProcess = ([string]$psadtConfig['reviewedManagedInstallCompletionProcess']).Trim()
        if ($reviewedManagedInstallCompletionProcess.Length -gt 260 -or
            $reviewedManagedInstallCompletionProcess -notmatch '^%(?:ProgramW6432|ProgramFiles|ProgramFiles\(x86\))%\\[^*?"<>|\x00-\x1f]+\.exe$' -or
            @($reviewedManagedInstallCompletionProcess -split '\\') -contains '..') {
            throw 'PSADT reviewedManagedInstallCompletionProcess must be a safe executable below a Program Files environment variable.'
        }
    }
    $rawManagedInstallCompletionTimeoutMinutes = $psadtConfig['reviewedManagedInstallCompletionTimeoutMinutes']
    if (($rawManagedInstallCompletionTimeoutMinutes -isnot [byte] -and
         $rawManagedInstallCompletionTimeoutMinutes -isnot [int16] -and
         $rawManagedInstallCompletionTimeoutMinutes -isnot [int32] -and
         $rawManagedInstallCompletionTimeoutMinutes -isnot [int64]) -or
        [int]$rawManagedInstallCompletionTimeoutMinutes -lt 1 -or
        [int]$rawManagedInstallCompletionTimeoutMinutes -gt 60) {
        throw 'PSADT reviewedManagedInstallCompletionTimeoutMinutes must be an integer from 1 to 60.'
    }
    $reviewedManagedInstallCompletionTimeoutMinutes = [int]$rawManagedInstallCompletionTimeoutMinutes
}

$reviewedManagedUninstallConfigured = $false
$reviewedManagedUninstallExecutable = ''
$reviewedManagedUninstallArguments = @()
$reviewedManagedUninstallTimeoutMinutes = 0
if ($psadtConfig.Contains('reviewedManagedUninstall') -and
    $null -ne $psadtConfig['reviewedManagedUninstall']) {
    $rawManagedUninstall = $psadtConfig['reviewedManagedUninstall']
    if ($rawManagedUninstall -isnot [System.Collections.IDictionary]) {
        throw 'PSADT reviewedManagedUninstall must be an object.'
    }
    if ([string]::IsNullOrWhiteSpace($reviewedManagedInstallDirectory)) {
        throw 'PSADT reviewedManagedUninstall requires reviewedManagedInstallDirectory.'
    }
    $reviewedManagedUninstallExecutable = ([string]$rawManagedUninstall['executablePath']).Trim()
    if ($reviewedManagedUninstallExecutable.Contains('<VERSION>')) {
        if ([regex]::Matches($reviewedManagedUninstallExecutable, '<VERSION>').Count -ne 1 -or
            $Version -notmatch '^[0-9A-Za-z][0-9A-Za-z._+-]{0,127}$') {
            throw 'PSADT reviewedManagedUninstall.executablePath contains an invalid version placeholder or package version.'
        }
        $reviewedManagedUninstallExecutable = $reviewedManagedUninstallExecutable.Replace('<VERSION>', $Version)
    }
    if ($reviewedManagedUninstallExecutable.Length -gt 260 -or
        $reviewedManagedUninstallExecutable -notmatch '^%(?:ProgramW6432|ProgramFiles|ProgramFiles\(x86\))%\\[^*?"<>|\x00-\x1f]+\.exe$' -or
        @($reviewedManagedUninstallExecutable -split '\\') -contains '..') {
        throw 'PSADT reviewedManagedUninstall.executablePath must be a safe executable below a Program Files environment variable.'
    }
    $rawManagedUninstallArguments = $rawManagedUninstall['arguments']
    if ($rawManagedUninstallArguments -is [string] -or
        $rawManagedUninstallArguments -isnot [System.Collections.IEnumerable]) {
        throw 'PSADT reviewedManagedUninstall.arguments must be an array.'
    }
    foreach ($rawManagedUninstallArgument in @($rawManagedUninstallArguments)) {
        if ($rawManagedUninstallArgument -isnot [string]) {
            throw 'Every PSADT reviewed managed uninstall argument must be a string.'
        }
        $managedUninstallArgument = $rawManagedUninstallArgument.Trim()
        if ([string]::IsNullOrWhiteSpace($managedUninstallArgument) -or
            $managedUninstallArgument.Length -gt 260 -or
            [regex]::IsMatch($managedUninstallArgument, '[\x00-\x1F\x7F]')) {
            throw 'Every PSADT reviewed managed uninstall argument must be non-empty, bounded, and single-line.'
        }
        $reviewedManagedUninstallArguments += $managedUninstallArgument
    }
    if ($reviewedManagedUninstallArguments.Count -gt 20) {
        throw 'PSADT reviewedManagedUninstall.arguments must contain at most 20 entries.'
    }
    $rawManagedUninstallTimeoutMinutes = $rawManagedUninstall['completionTimeoutMinutes']
    if (($rawManagedUninstallTimeoutMinutes -isnot [byte] -and
         $rawManagedUninstallTimeoutMinutes -isnot [int16] -and
         $rawManagedUninstallTimeoutMinutes -isnot [int32] -and
         $rawManagedUninstallTimeoutMinutes -isnot [int64]) -or
        [int]$rawManagedUninstallTimeoutMinutes -lt 1 -or
        [int]$rawManagedUninstallTimeoutMinutes -gt 60) {
        throw 'PSADT reviewedManagedUninstall.completionTimeoutMinutes must be an integer from 1 to 60.'
    }
    $reviewedManagedUninstallTimeoutMinutes = [int]$rawManagedUninstallTimeoutMinutes
    $reviewedManagedUninstallConfigured = $true
}

$reviewedExactUninstallConfigured = $false
$reviewedExactUninstallExecutable = ''
$reviewedExactUninstallArguments = @()
$reviewedExactUninstallTimeoutMinutes = 0
if ($psadtConfig.Contains('reviewedExactUninstall') -and
    $null -ne $psadtConfig['reviewedExactUninstall']) {
    $rawExactUninstall = $psadtConfig['reviewedExactUninstall']
    if ($rawExactUninstall -isnot [System.Collections.IDictionary]) {
        throw 'PSADT reviewedExactUninstall must be an object.'
    }
    $reviewedExactUninstallExecutable = ([string]$rawExactUninstall['executablePath']).Trim()
    $usesPackagedInstaller = $reviewedExactUninstallExecutable -eq '%PackageInstaller%'
    if (-not $usesPackagedInstaller -and
        ($reviewedExactUninstallExecutable.Length -gt 260 -or
         $reviewedExactUninstallExecutable -notmatch '^%(?:ProgramW6432|ProgramFiles|ProgramFiles\(x86\))%\\[^*?"<>|\x00-\x1f]+\.exe$' -or
         @($reviewedExactUninstallExecutable -split '\\') -contains '..')) {
        throw 'PSADT reviewedExactUninstall.executablePath must be %PackageInstaller% or a safe executable below a Program Files environment variable.'
    }
    $rawExactUninstallArguments = $rawExactUninstall['arguments']
    if ($rawExactUninstallArguments -is [string] -or
        $rawExactUninstallArguments -isnot [System.Collections.IEnumerable]) {
        throw 'PSADT reviewedExactUninstall.arguments must be an array.'
    }
    foreach ($rawExactUninstallArgument in @($rawExactUninstallArguments)) {
        if ($rawExactUninstallArgument -isnot [string]) {
            throw 'Every PSADT reviewed exact uninstall argument must be a string.'
        }
        $exactUninstallArgument = $rawExactUninstallArgument.Trim()
        if ([string]::IsNullOrWhiteSpace($exactUninstallArgument) -or
            $exactUninstallArgument.Length -gt 260 -or
            [regex]::IsMatch($exactUninstallArgument, '[\x00-\x1F\x7F]')) {
            throw 'Every PSADT reviewed exact uninstall argument must be non-empty, bounded, and single-line.'
        }
        $reviewedExactUninstallArguments += $exactUninstallArgument
    }
    if ($reviewedExactUninstallArguments.Count -gt 20) {
        throw 'PSADT reviewedExactUninstall.arguments must contain at most 20 entries.'
    }
    $rawExactUninstallTimeoutMinutes = $rawExactUninstall['completionTimeoutMinutes']
    if (($rawExactUninstallTimeoutMinutes -isnot [byte] -and
         $rawExactUninstallTimeoutMinutes -isnot [int16] -and
         $rawExactUninstallTimeoutMinutes -isnot [int32] -and
         $rawExactUninstallTimeoutMinutes -isnot [int64]) -or
        [int]$rawExactUninstallTimeoutMinutes -lt 1 -or
        [int]$rawExactUninstallTimeoutMinutes -gt 60) {
        throw 'PSADT reviewedExactUninstall.completionTimeoutMinutes must be an integer from 1 to 60.'
    }
    $reviewedExactUninstallTimeoutMinutes = [int]$rawExactUninstallTimeoutMinutes
    $reviewedExactUninstallConfigured = $true
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

function Get-MsiPropertyValue {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Property
    )

    $installer = $null
    $database = $null
    $view = $null
    $record = $null

    try {
        $installer = New-Object -ComObject WindowsInstaller.Installer
        $database = $installer.GetType().InvokeMember(
            'OpenDatabase',
            [System.Reflection.BindingFlags]::InvokeMethod,
            $null,
            $installer,
            @($Path, 0)
        )
        $escapedProperty = $Property -replace "'", "''"
        $view = $database.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = '$escapedProperty'")
        # Windows Installer COM methods can emit incidental pipeline output.
        # Suppress it so this helper always returns exactly one scalar property
        # value instead of an Object[] that later breaks string normalization.
        [void]$view.Execute()
        $record = $view.Fetch()

        if ($record) {
            $value = [string]$record.StringData(1)
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return $value
            }
        }
    } catch {
        Write-Warning "Could not read MSI property [$Property] from [$Path]: $($_.Exception.Message)"
    } finally {
        if ($view) {
            try { [void]$view.Close() } catch { }
        }
        foreach ($comObject in @($record, $view, $database, $installer)) {
            if ($comObject -and [System.Runtime.InteropServices.Marshal]::IsComObject($comObject)) {
                [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($comObject)
            }
        }
    }

    return $null
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
# Reviewed application adapters may append bounded vendor properties to the
# manifest-derived command. Do this before quote encoding so MSI properties are
# passed identically by QA and customer packages.
$effectiveSilentSwitches = if ($reviewedInstallArgumentsOverride) {
    $reviewedInstallArgumentsOverride
} else {
    $SilentSwitches.Trim()
}
foreach ($reviewedInstallArgument in $reviewedInstallArguments) {
    $argumentPattern = '(?i)(^|\s)' + [regex]::Escape($reviewedInstallArgument) + '(\s|$)'
    if ($effectiveSilentSwitches -notmatch $argumentPattern) {
        $effectiveSilentSwitches = "$effectiveSilentSwitches $reviewedInstallArgument".Trim()
    }
}

# This value is embedded in a single-quoted string in the generated script.
# Only a single quote needs escaping; changing backticks or dollar signs would
# silently change valid vendor arguments.
$silentSwitchesEscaped = $effectiveSilentSwitches -replace "'", "''"
$versionSingleQuoteEscaped = $Version -replace "'", "''"
$uninstallCmd = [string]$UninstallCommand
$uninstallCmdSingleQuoteEscaped = $uninstallCmd -replace "'", "''"
$reviewedManagedInstallDirectoryEscaped = $reviewedManagedInstallDirectory -replace "'", "''"
$reviewedManagedInstallEvidenceFileEscaped = $reviewedManagedInstallEvidenceFile -replace "'", "''"
$reviewedManagedInstallCompletionProcessEscaped = $reviewedManagedInstallCompletionProcess -replace "'", "''"
$reviewedManagedUninstallExecutableEscaped = $reviewedManagedUninstallExecutable -replace "'", "''"
$reviewedManagedUninstallArgumentsLiteral = @(
    $reviewedManagedUninstallArguments | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }
) -join ', '
$reviewedExactUninstallExecutableEscaped = $reviewedExactUninstallExecutable -replace "'", "''"
$reviewedExactUninstallArgumentsLiteral = @(
    $reviewedExactUninstallArguments | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }
) -join ', '
$reviewedRegistryInstallEvidenceProviderPathEscaped = $reviewedRegistryInstallEvidenceProviderPath -replace "'", "''"
$reviewedRegistryInstallEvidenceValueNameEscaped = $reviewedRegistryInstallEvidenceValueName -replace "'", "''"
$reviewedInstallShieldMsiExpectedFileNameEscaped = $reviewedInstallShieldMsiExpectedFileName -replace "'", "''"
$displayNameEscaped = $DisplayName -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
$publisherEscaped = $Publisher -replace "'", "''" -replace '`', '``' -replace '\$', '`$'
$publisherSingleQuoteEscaped = $Publisher -replace "'", "''"
$sanitizedWingetId = $WingetId -replace '[\.\-]', '_'
$registryUninstallLocaleHint = ''
if ($WingetId -cmatch '\.([a-z]{2,3}(?:-[A-Z]{2})?)$') {
    $registryUninstallLocaleHint = $Matches[1]
}
$registryUninstallLocaleHintEscaped = $registryUninstallLocaleHint -replace "'", "''"
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

# PSADT 4.1 selects LogPathNoAdminRights when RequireAdmin is false. Its default
# ProgramData location is not writable by a standard user when the parent folder
# does not already exist, so session initialization can fail with exit code 60008.
if ($IsUserScope) {
    # Keep the PSADT variable as a literal for expansion when the toolkit opens
    # the user session; the resulting path is owned and writable by that user.
    $userLogPathLiteral = "'`$envLocalAppData\IntuneGet\Logs'"
    Update-PowerShellDataSetting -Path $configPath -Section 'Toolkit' -Setting 'LogPathNoAdminRights' -ValueLiteral $userLogPathLiteral
    Write-Host 'User-scope: non-admin log directory set below the current user LocalAppData path'
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
            if ($installerTypeLower -eq 'zip') {
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

if ($installerTypeLower -eq 'zip' -and -not [string]::IsNullOrWhiteSpace($NestedInstallerPath)) {
    if ([string]::IsNullOrWhiteSpace($NestedInstallerType)) {
        throw "Zip package declares a nested installer path but no nested installer type; refusing unsafe default execution."
    }
    $NestedInstallerPath = $NestedInstallerPath.Trim() -replace '/', '\'
    $nestedPathSegments = @($NestedInstallerPath -split '\\')
    $nestedPathIsUnsafe = [System.IO.Path]::IsPathRooted($NestedInstallerPath) -or
        $NestedInstallerPath.StartsWith('\\') -or
        $nestedPathSegments -contains '..' -or
        $NestedInstallerPath.Contains(':') -or
        $NestedInstallerPath -match '[\x00-\x1f]'
    if ($nestedPathIsUnsafe) {
        throw "Unsafe nested installer path: $NestedInstallerPath"
    }
}

# Registry uninstall behavior belongs to the executable inside an archive, not
# to the ZIP transport. Preserve the outer type for extraction while carrying
# the effective nested engine into quiet-uninstall normalization.
$registeredInstallerTypeLower = if ($installerTypeLower -eq 'zip' -and
    -not [string]::IsNullOrWhiteSpace($NestedInstallerType)) {
    $NestedInstallerType.Trim().ToLowerInvariant()
} else {
    $installerTypeLower
}

$isNestedPortable = $installerTypeLower -eq 'zip' -and
    -not [string]::IsNullOrWhiteSpace($NestedInstallerType) -and
    $NestedInstallerType.Trim().ToLowerInvariant() -eq 'portable'
$isPlainPortableArchive = $installerTypeLower -eq 'zip' -and
    [string]::IsNullOrWhiteSpace($NestedInstallerType) -and
    [string]::IsNullOrWhiteSpace($NestedInstallerPath)

$portableFolderName = ($DisplayName -replace '[<>:"/\\|?*\x00-\x1f]', '_').Trim().TrimEnd('.')
if ([string]::IsNullOrWhiteSpace($portableFolderName) -or
    $portableFolderName -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$') {
    $portableFolderName = $sanitizedWingetId
}
$portableFolderNameSingleQuoteEscaped = $portableFolderName -replace "'", "''"
$portableInstallPathLine = if ($IsUserScope) {
    "    `$installPath = Join-Path `$env:LOCALAPPDATA 'Programs\$portableFolderNameSingleQuoteEscaped'"
} else {
    "    `$installPath = Join-Path `$env:ProgramFiles '$portableFolderNameSingleQuoteEscaped'"
}

# Check if uninstall command uses special handling
$useRegistryUninstall = $false
$useMsixUninstall = $false
$usePortableUninstall = $false
$registryUninstallDisplayName = ''
$registryUninstallProductCode = ''
$msixPackageName = ''

if ($installerTypeLower -eq 'portable' -or $isNestedPortable -or $isPlainPortableArchive) {
    $usePortableUninstall = $true
    Write-Host "Using portable uninstall (folder removal)"
} elseif ($uninstallCmd -match '^REGISTRY_UNINSTALL_PRODUCT:(\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}):(.+)$') {
    $useRegistryUninstall = $true
    $registryUninstallProductCode = $Matches[1]
    $registryUninstallDisplayName = $Matches[2]
} elseif ($uninstallCmd -match '^REGISTRY_UNINSTALL_KEY:((?:[A-Za-z0-9][A-Za-z0-9 ._{}()+-]{0,255}|\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}_[A-Za-z0-9._+-]{1,32})):(.+)$') {
    # Non-MSI WinGet manifests can expose a stable, edition-specific ARP key,
    # including keys with spaces or a version suffix. Reuse the existing exact
    # PSChildName lifecycle rather than broadening name matching.
    $useRegistryUninstall = $true
    $registryUninstallProductCode = $Matches[1]
    $registryUninstallDisplayName = $Matches[2]
} elseif ($uninstallCmd -match '^REGISTRY_UNINSTALL:(.+)$') {
    $useRegistryUninstall = $true
    $registryUninstallDisplayName = $Matches[1]
} elseif ($uninstallCmd -match '^REGISTRY_UNINSTALL_(PRODUCT|KEY):') {
    throw 'The exact vendor uninstall identity is malformed; refusing to interpret any embedded GUID as an MSI product code.'
} elseif ($installerTypeLower -in @('msi', 'wix') -and $uninstallCmd -match '(\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\})') {
    # Deployment profiles commonly carry the concrete msiexec uninstall command
    # instead of the internal REGISTRY_UNINSTALL_PRODUCT marker. Treat its product
    # code as the same immutable registry identity so install verification and
    # removal never fall back to a human/Winget display name.
    $useRegistryUninstall = $true
    $registryUninstallProductCode = $Matches[1]
    $registryUninstallDisplayName = $DisplayName
}

# WinGet metadata can omit, decorate, stale-cache, or leave a literal
# {PRODUCT_CODE} placeholder in an MSI uninstall command. Always read the
# authoritative identity from the downloaded MSI so neither customer packages
# nor QA can execute an unresolved template such as `msiexec /x {PRODUCT_CODE}`.
if ($fileExtension -eq '.msi') {
    $msiProductCode = [string](Get-MsiPropertyValue -Path $env:INSTALLER_PATH -Property 'ProductCode')
    if ($msiProductCode -match '^\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}$') {
        $useRegistryUninstall = $true
        $registryUninstallProductCode = $msiProductCode.ToUpperInvariant()
        if (-not $registryUninstallDisplayName) {
            $registryUninstallDisplayName = $DisplayName
        }
        Write-Host "Using MSI database product code for registry identity: $registryUninstallProductCode"
    } else {
        throw 'The MSI database did not expose a valid ProductCode; refusing ambiguous detection or removal.'
    }
}

$useManagedDirectoryLifecycle = -not [string]::IsNullOrWhiteSpace($reviewedManagedInstallDirectory)
if ($useManagedDirectoryLifecycle) {
    # A reviewed extractor lifecycle is deliberately not an ARP lifecycle.
    # Never let unrelated background servicing become the captured identity.
    $useRegistryUninstall = $false
    Write-Host "Using reviewed managed-directory lifecycle: $reviewedManagedInstallDirectory"
}

if ($reviewedRegistryInstallEvidenceConfigured) {
    if (-not $useRegistryUninstall -or $IsUserScope) {
        throw 'PSADT reviewedRegistryInstallEvidence requires a machine-scope registry uninstall package.'
    }
    Write-Host "Using reviewed registry installation evidence: $reviewedRegistryInstallEvidenceKeyPath"
}

if ($reviewedInstallShieldAdministrativeImageConfigured) {
    if ($IsUserScope -or $installerTypeLower -ne 'exe' -or $fileExtension -ne '.exe') {
        throw 'PSADT reviewedInstallShieldAdministrativeImage requires a machine-scope EXE package.'
    }
    if (-not $useRegistryUninstall -or
        $registryUninstallProductCode -notmatch '^\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}$') {
        throw 'PSADT reviewedInstallShieldAdministrativeImage requires an exact manifest MSI product code.'
    }
    if (-not [string]::IsNullOrWhiteSpace($customInstallCommand)) {
        throw 'PSADT reviewedInstallShieldAdministrativeImage cannot be combined with a custom install command.'
    }
    Write-Host "Using reviewed InstallShield administrative-image lifecycle: $reviewedInstallShieldMsiExpectedFileName"
}

if ($useRegistryUninstall) {

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
    $registryUninstallDisplayNameEscaped = $registryUninstallDisplayName -replace "'", "''"

    $registryIdentity = if ($registryUninstallProductCode) { "product $registryUninstallProductCode" } else { 'display name fallback' }
    Write-Host "Using registry-based uninstall for: $registryUninstallDisplayName ($registryIdentity)"
} elseif (-not $usePortableUninstall -and $uninstallCmd -match '^MSIX_UNINSTALL:(.+)$') {
    $useMsixUninstall = $true
    $msixPackageName = $Matches[1]
    if ($msixPackageName -notmatch '^[A-Za-z0-9.-]+$') {
        throw "The MSIX/APPX package identity is missing or unsafe; refusing an ambiguous deployment."
    }
    Write-Host "Using MSIX uninstall for package: $msixPackageName"
} elseif (-not $usePortableUninstall -and $uninstallCmd -eq 'MSI_UNINSTALL_IDENTITY_REQUIRED') {
    if ([string]::IsNullOrWhiteSpace($customUninstallCommand)) {
        throw "The MSI/WiX package has neither a product code nor a display name for safe uninstall discovery."
    }
} elseif ($installerTypeLower -eq 'zip') {
    $usePortableUninstall = $true
    Write-Host "Using portable uninstall (folder removal)"
}

if ($installerTypeLower -in @('msix', 'appx') -and
    [string]::IsNullOrWhiteSpace($msixPackageName) -and
    ([string]::IsNullOrWhiteSpace($customInstallCommand) -or [string]::IsNullOrWhiteSpace($customUninstallCommand))) {
    throw "The MSIX/APPX package identity is missing; refusing to generate install or uninstall commands from a display-name guess."
}

# Validate and normalize app close configuration before embedding it in the
# generated deployment script. Invalid entries must fail packaging rather than
# silently omitting a required lifecycle action.
$processesToClose = @()
if ($psadtConfig.ContainsKey('processesToClose') -and $null -ne $psadtConfig.processesToClose) {
    if ($psadtConfig.processesToClose -isnot [System.Array]) {
        throw 'PSADT processesToClose must be a JSON array.'
    }
    $rawProcessesToClose = @($psadtConfig.processesToClose)
    if ($rawProcessesToClose.Count -gt 50) {
        throw 'PSADT processesToClose cannot contain more than 50 entries.'
    }

    $configuredProcessNames = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    foreach ($process in $rawProcessesToClose) {
        if ($process -isnot [System.Collections.IDictionary] -or
            -not $process.Contains('name') -or
            $process.name -isnot [string]) {
            throw 'Each PSADT process entry must contain a string name.'
        }
        $procName = ([string]$process.name).Trim() -replace '(?i)\.exe$', ''
        if ([string]::IsNullOrWhiteSpace($procName) -or
            $procName.Length -gt 260 -or
            $procName -match '[\x00-\x1F\x7F\\/:*?"<>|]') {
            throw "Invalid PSADT process name [$($process.name)]. Use an executable name without a path or .exe suffix."
        }

        $procDesc = $procName
        if ($process.Contains('description') -and $null -ne $process.description) {
            if ($process.description -isnot [string]) {
                throw "The PSADT process description for [$procName] must be a string."
            }
            if (-not [string]::IsNullOrWhiteSpace([string]$process.description)) {
                $procDesc = ([string]$process.description).Trim() -replace '[\x00-\x1F\x7F]+', ' '
            }
        }
        if ($procDesc.Length -gt 260) {
            throw "The PSADT process description for [$procName] cannot exceed 260 characters."
        }

        if ($configuredProcessNames.Add($procName)) {
            $processesToClose += [pscustomobject]@{
                name = $procName
                description = $procDesc
            }
        }
    }
}
$showClosePrompt = Get-StrictPSADTBoolean -Config $psadtConfig -Name 'showClosePrompt'
$closeCountdown = 60
if ($psadtConfig.ContainsKey('closeCountdown') -and $null -ne $psadtConfig.closeCountdown) {
    $parsedCloseCountdown = 0L
    if (-not [long]::TryParse([string]$psadtConfig.closeCountdown, [ref]$parsedCloseCountdown) -or
        $parsedCloseCountdown -lt 0 -or $parsedCloseCountdown -gt 86400) {
        throw 'PSADT closeCountdown must be an integer from 0 through 86400.'
    }
    $closeCountdown = [int]$parsedCloseCountdown
}
$allowDefer = Get-StrictPSADTBoolean -Config $psadtConfig -Name 'allowDefer'
$deferTimes = 3
if ($psadtConfig.ContainsKey('deferTimes') -and $null -ne $psadtConfig.deferTimes) {
    $parsedDeferTimes = 0L
    if (-not [long]::TryParse([string]$psadtConfig.deferTimes, [ref]$parsedDeferTimes) -or
        $parsedDeferTimes -lt 0 -or $parsedDeferTimes -gt 1000) {
        throw 'PSADT deferTimes must be an integer from 0 through 1000.'
    }
    $deferTimes = [int]$parsedDeferTimes
}

# Extended welcome parameters
$blockExecution = Get-StrictPSADTBoolean -Config $psadtConfig -Name 'blockExecution'
$promptToSave = Get-StrictPSADTBoolean -Config $psadtConfig -Name 'promptToSave'
$deferDeadline = $null
if ($psadtConfig.ContainsKey('deferDeadline') -and $null -ne $psadtConfig.deferDeadline) {
    if ($psadtConfig.deferDeadline -isnot [string]) {
        throw 'PSADT deferDeadline must be an ISO date string.'
    }
    $candidateDeferDeadline = ([string]$psadtConfig.deferDeadline).Trim()
    if (-not [string]::IsNullOrWhiteSpace($candidateDeferDeadline)) {
        $parsedDeferDeadline = [DateTimeOffset]::MinValue
        if ($candidateDeferDeadline.Length -gt 64 -or
            $candidateDeferDeadline -notmatch '^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,7})?)?(?:Z|[+-]\d{2}:\d{2})?)?$' -or
            -not [DateTimeOffset]::TryParse(
                $candidateDeferDeadline,
                [System.Globalization.CultureInfo]::InvariantCulture,
                [System.Globalization.DateTimeStyles]::AllowWhiteSpaces,
                [ref]$parsedDeferDeadline
            )) {
            throw 'PSADT deferDeadline must be a valid ISO date or date-time string.'
        }
        $deferDeadline = $candidateDeferDeadline
    }
}
$deferDays = $null
if ($psadtConfig.ContainsKey('deferDays') -and $null -ne $psadtConfig.deferDays) {
    $parsedDeferDays = 0.0
    if (-not [double]::TryParse(
            [string]$psadtConfig.deferDays,
            [System.Globalization.NumberStyles]::Float,
            [System.Globalization.CultureInfo]::InvariantCulture,
            [ref]$parsedDeferDays
        ) -or $parsedDeferDays -lt 0 -or $parsedDeferDays -gt 3650) {
        throw 'PSADT deferDays must be a number from 0 through 3650.'
    }
    # IntuneGet uses zero as the UI/API sentinel for no day-based limit. PSADT
    # v4.1 rejects an explicitly supplied DeferDays value of zero, so omit the
    # parameter unless the configured duration is positive.
    if ($parsedDeferDays -gt 0) {
        $deferDays = [Convert]::ToString($parsedDeferDays, [System.Globalization.CultureInfo]::InvariantCulture)
    }
}
$forceCloseCountdown = $null
if ($psadtConfig.ContainsKey('forceCloseProcessesCountdown') -and
    $null -ne $psadtConfig.forceCloseProcessesCountdown) {
    $parsedForceCloseCountdown = 0L
    if (-not [long]::TryParse([string]$psadtConfig.forceCloseProcessesCountdown, [ref]$parsedForceCloseCountdown) -or
        $parsedForceCloseCountdown -lt 0 -or $parsedForceCloseCountdown -gt 86400) {
        throw 'PSADT forceCloseProcessesCountdown must be an integer from 0 through 86400.'
    }
    $forceCloseCountdown = [int]$parsedForceCloseCountdown
}
$persistPrompt = Get-StrictPSADTBoolean -Config $psadtConfig -Name 'persistPrompt'
$minimizeWindows = Get-StrictPSADTBoolean -Config $psadtConfig -Name 'minimizeWindows'
$windowLocation = if ($psadtConfig.windowLocation) { [string]$psadtConfig.windowLocation } else { 'Default' }
if ($windowLocation -notin @('Default', 'Center', 'Top', 'Bottom', 'TopLeft', 'TopRight', 'BottomLeft', 'BottomRight')) {
    throw "Unsupported PSADT windowLocation [$windowLocation]."
}
$checkDiskSpace = Get-StrictPSADTBoolean -Config $psadtConfig -Name 'checkDiskSpace'
$requiredDiskSpace = $null
if ($psadtConfig.ContainsKey('requiredDiskSpace') -and $null -ne $psadtConfig.requiredDiskSpace) {
    $parsedRequiredDiskSpace = 0L
    if (-not [long]::TryParse([string]$psadtConfig.requiredDiskSpace, [ref]$parsedRequiredDiskSpace) -or
        $parsedRequiredDiskSpace -lt 0 -or $parsedRequiredDiskSpace -gt [uint32]::MaxValue) {
        throw 'PSADT requiredDiskSpace must be an unsigned 32-bit integer.'
    }
    $requiredDiskSpace = [long]$parsedRequiredDiskSpace
}
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

# Build the PSADT v4.1 AppProcessesToClose session value.
$processesArrayStr = '@()'
if ($processesToClose.Count -gt 0) {
    $processEntries = $processesToClose | ForEach-Object {
        $procName = $_.name -replace "'", "''"
        $procDesc = if ($_.description) { $_.description -replace "'", "''" } else { $procName }
        "@{ Name = '$procName'; Description = '$procDesc' }"
    }
    $processesArrayStr = "@(`n    $($processEntries -join ",`n    ")`n)"
}

# Build Show-ADTInstallationWelcome call if enabled
$welcomeCall = ''
if ($allowDefer -or $processesToClose.Count -gt 0 -or $checkDiskSpace) {
    $welcomeParams = @()
    $interactiveWelcome = $allowDefer -or ($processesToClose.Count -gt 0 -and $showClosePrompt)

    # Handle parameter sets correctly for PSADT v4
    # Deferral is interactive even when showClosePrompt is false because the
    # user must be able to choose whether to defer.
    if ($processesToClose.Count -gt 0 -and $allowDefer) {
        $welcomeParams += '-CloseProcesses $adtSession.AppProcessesToClose'
        $welcomeParams += '-AllowDeferCloseProcesses'
        if ($null -ne $forceCloseCountdown) {
            $welcomeParams += "-ForceCloseProcessesCountdown $forceCloseCountdown"
        } else {
            $welcomeParams += "-CloseProcessesCountdown $closeCountdown"
        }
        $welcomeParams += "-DeferTimes $deferTimes"
        if ($deferDeadline) { $welcomeParams += "-DeferDeadline '$deferDeadline'" }
        if ($null -ne $deferDays) { $welcomeParams += "-DeferDays $deferDays" }
        if ($blockExecution) { $welcomeParams += '-BlockExecution' }
    } elseif ($processesToClose.Count -gt 0) {
        $welcomeParams += '-CloseProcesses $adtSession.AppProcessesToClose'
        if ($showClosePrompt) {
            if ($null -ne $forceCloseCountdown) {
                $welcomeParams += "-ForceCloseProcessesCountdown $forceCloseCountdown"
            } else {
                $welcomeParams += "-CloseProcessesCountdown $closeCountdown"
            }
        } else {
            $welcomeParams += '-Silent'
        }
        if ($blockExecution) { $welcomeParams += '-BlockExecution' }
    } elseif ($allowDefer) {
        # Only deferrals, no close prompts
        $welcomeParams += '-AllowDefer'
        $welcomeParams += "-DeferTimes $deferTimes"
        if ($deferDeadline) { $welcomeParams += "-DeferDeadline '$deferDeadline'" }
        if ($null -ne $deferDays) { $welcomeParams += "-DeferDays $deferDays" }
    }
    if ($interactiveWelcome) {
        if (-not [string]::IsNullOrWhiteSpace($welcomeMessageEscaped)) { $welcomeParams += '-CustomText' }
        if ($promptToSave -and $processesToClose.Count -gt 0) { $welcomeParams += '-PromptToSave' }
        if ($persistPrompt) { $welcomeParams += '-PersistPrompt' }
        if ($minimizeWindows) { $welcomeParams += '-MinimizeWindows' }
        if ($windowLocation -ne 'Default') { $welcomeParams += "-WindowLocation '$windowLocation'" }
    }
    if ($checkDiskSpace) {
        $welcomeParams += '-CheckDiskSpace'
        if ($null -ne $requiredDiskSpace) { $welcomeParams += "-RequiredDiskSpace $requiredDiskSpace" }
    }

    $welcomeCall = @(
        ''
        '    # Show installation welcome dialog (for deferrals and/or close prompts)'
        "    Show-ADTInstallationWelcome $($welcomeParams -join ' ')"
        ''
    ) -join "`r`n"
}

$uninstallWelcomeCall = ''
if ($processesToClose.Count -gt 0) {
    $uninstallWelcomeParameters = @('-CloseProcesses $adtSession.AppProcessesToClose')
    if ($showClosePrompt) {
        if ($null -ne $forceCloseCountdown) {
            $uninstallWelcomeParameters += "-ForceCloseProcessesCountdown $forceCloseCountdown"
        } else {
            $uninstallWelcomeParameters += "-CloseProcessesCountdown $closeCountdown"
        }
        if ($promptToSave) { $uninstallWelcomeParameters += '-PromptToSave' }
        if ($persistPrompt) { $uninstallWelcomeParameters += '-PersistPrompt' }
        if ($minimizeWindows) { $uninstallWelcomeParameters += '-MinimizeWindows' }
        if ($windowLocation -ne 'Default') { $uninstallWelcomeParameters += "-WindowLocation '$windowLocation'" }
    } else {
        $uninstallWelcomeParameters += '-Silent'
    }
    if ($blockExecution) { $uninstallWelcomeParameters += '-BlockExecution' }
    $uninstallWelcomeCall = @(
        ''
        '    # Apply the PSADT v4.1 application process lifecycle before removal.'
        "    Show-ADTInstallationWelcome $($uninstallWelcomeParameters -join ' ')"
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

# Build a deterministic, offline prerequisite sequence. Dependency files were
# hash-verified before being copied into Files\Dependencies above. They are
# installed before the primary-app uninstall snapshot so their registry entries
# cannot be mistaken for the application's vendor identity.
$dependencyInstallLines = @()
foreach ($dependency in @($PackageDependencies | Sort-Object order)) {
    $dependencyIdEscaped = ([string]$dependency.packageIdentifier) -replace "'", "''"
    $dependencyVersionEscaped = ([string]$dependency.version) -replace "'", "''"
    $dependencyFileEscaped = ([string]$dependency.fileName) -replace "'", "''"
    $dependencyArgumentsEscaped = ([string]$dependency.silentArgs) -replace "'", "''"
    $dependencyInstallerType = ([string]$dependency.installerType).ToLowerInvariant()
    $dependencyNestedPathEscaped = ([string]$dependency.nestedInstallerPath) -replace "'", "''"
    $dependencyPackageNameEscaped = (([string]$dependency.packageFamilyName -split '_')[0]) -replace "'", "''"
    $dependencySuccessCodes = @(
        0
        @($dependency.successCodes) | ForEach-Object { [int]$_ }
    ) | Sort-Object -Unique
    $dependencyRebootCodes = @(
        @($dependency.rebootCodes) | ForEach-Object { [int]$_ }
    ) | Sort-Object -Unique
    if ($dependencyRebootCodes.Count -eq 0) {
        $dependencyRebootCodes = @(1641, 3010)
    }
    $dependencySuccessLiteral = $dependencySuccessCodes -join ', '
    $dependencyRebootLiteral = $dependencyRebootCodes -join ', '
    $dependencyInstallLines += @(
        ''
        "    # Install offline WinGet dependency: $dependencyIdEscaped $dependencyVersionEscaped"
        "    `$dependencyPath = Join-Path `$adtSession.DirFiles 'Dependencies\$dependencyFileEscaped'"
        '    if (-not (Test-Path -LiteralPath $dependencyPath -PathType Leaf)) {'
        "        throw 'Bundled dependency file is missing: $dependencyIdEscaped'"
        '    }'
        "    Write-ADTLogEntry -Message 'Installing bundled dependency [$dependencyIdEscaped] version [$dependencyVersionEscaped].' -Severity 'Info' -Source 'Install-ADTDeployment'"
    )
    if ($dependencyInstallerType -in @('msi', 'wix')) {
        $dependencyInstallLines += @(
            "    `$dependencyArgumentList = '/i `"{0}`" {1}' -f `$dependencyPath, '$dependencyArgumentsEscaped'"
            "    `$dependencyResult = Start-ADTProcess -FilePath `"`$env:SystemRoot\System32\msiexec.exe`" -ArgumentList `$dependencyArgumentList -WindowStyle Hidden -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 10) -TimeoutAction Stop -SuccessExitCodes @($dependencySuccessLiteral) -RebootExitCodes @($dependencyRebootLiteral) -PassThru"
        )
    }
    elseif ($dependencyInstallerType -eq 'zip') {
        $dependencyInstallLines += @(
            "    `$dependencyExtractRoot = Join-Path `$env:TEMP 'IntuneGet-Dependency-$([int]$dependency.order)'"
            '    if (Test-Path -LiteralPath $dependencyExtractRoot) {'
            '        Remove-Item -LiteralPath $dependencyExtractRoot -Recurse -Force'
            '    }'
            '    $null = New-Item -ItemType Directory -Path $dependencyExtractRoot -Force'
            '    try {'
            '        Expand-Archive -LiteralPath $dependencyPath -DestinationPath $dependencyExtractRoot -Force'
            "        `$dependencyNestedPath = [System.IO.Path]::GetFullPath((Join-Path `$dependencyExtractRoot '$dependencyNestedPathEscaped'))"
            '        $dependencyRootPrefix = [System.IO.Path]::GetFullPath($dependencyExtractRoot).TrimEnd(''\'') + ''\'''
            '        if (-not $dependencyNestedPath.StartsWith($dependencyRootPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or'
            '            -not (Test-Path -LiteralPath $dependencyNestedPath -PathType Leaf)) {'
            "            throw 'Reviewed dependency APPX payload is missing or escaped its extraction root: $dependencyIdEscaped'"
            '        }'
            "        `$existingDependency = Get-AppxProvisionedPackage -Online | Where-Object { `$_.DisplayName -eq '$dependencyPackageNameEscaped' } | Sort-Object Version -Descending | Select-Object -First 1"
            '        $dependencyNeedsInstall = $true'
            '        if ($existingDependency) {'
            "            try { `$dependencyNeedsInstall = [version]`$existingDependency.Version -lt [version]'$dependencyVersionEscaped' } catch { `$dependencyNeedsInstall = `$true }"
            '        }'
            '        if ($dependencyNeedsInstall) {'
            '            Add-AppxProvisionedPackage -Online -PackagePath $dependencyNestedPath -SkipLicense -ErrorAction Stop | Out-Null'
            "            Write-ADTLogEntry -Message 'Provisioned bundled APPX dependency [$dependencyIdEscaped].' -Severity 'Success' -Source 'Install-ADTDeployment'"
            '        }'
            '        else {'
            "            Write-ADTLogEntry -Message 'Bundled APPX dependency [$dependencyIdEscaped] is already satisfied.' -Severity 'Success' -Source 'Install-ADTDeployment'"
            '        }'
            '        $dependencyResult = [pscustomobject]@{ ExitCode = 0 }'
            '    }'
            '    finally {'
            '        if (Test-Path -LiteralPath $dependencyExtractRoot) {'
            '            Remove-Item -LiteralPath $dependencyExtractRoot -Recurse -Force -ErrorAction SilentlyContinue'
            '        }'
            '    }'
        )
    }
    else {
        $dependencyInstallLines += "    `$dependencyResult = Start-ADTProcess -FilePath `$dependencyPath -ArgumentList '$dependencyArgumentsEscaped' -WindowStyle Hidden -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 10) -TimeoutAction Stop -SuccessExitCodes @($dependencySuccessLiteral) -RebootExitCodes @($dependencyRebootLiteral) -PassThru"
    }
    $dependencyInstallLines += @(
        "    if (`$dependencyResult.ExitCode -in @($dependencyRebootLiteral)) {"
        '        $script:DependencyRebootExitCode = 3010'
        '    }'
    )
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
    '$adtSession = @{'
    "    AppVendor = '$publisherEscaped'"
    "    AppName = '$displayNameEscaped'"
    "    AppVersion = '$versionSingleQuoteEscaped'"
    '    AppArch = '''''
    '    AppLang = ''EN'''
    '    AppRevision = ''01'''
    "    AppSuccessExitCodes = @($appSuccessExitCodesLiteral)"
    '    AppRebootExitCodes = @(1641, 3010)'
    "    AppProcessesToClose = $processesArrayStr"
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

# Add installer file existence check before install commands. The progress dialog
# is emitted above only when progressDialog.enabled is true so package behavior
# continues to match the effective PSADT configuration.
$lines += @(
    ''
    '    # Verify installer file exists before proceeding'
    "    `$installerPath = Join-Path `$adtSession.DirFiles '$installerFileNameSingleQuoteEscaped'"
    '    if (-not (Test-Path -LiteralPath $installerPath)) {'
    '        Write-ADTLogEntry -Message "Installer file not found: $installerPath" -Severity ''Error'' -Source ''Install-ADTDeployment'''
    '        throw "Installer file not found: $installerPath"'
    '    }'
    ''
)
$lines += $dependencyInstallLines

if ($useRegistryUninstall -and $reviewedRegistryInstallEvidenceConfigured) {
    $lines += @(
        '    # Verify the adapter-reviewed Windows runtime signal instead of guessing an ARP identity.'
        '    $capturedUninstallKey = $null'
        '    $capturedUninstallName = $null'
        '    $reviewedRegistryInstallationVerified = $false'
        '    function Test-IntuneGetReviewedRegistryInstallEvidence {'
        '        try {'
        "            `$evidenceKey = Get-Item -LiteralPath '$reviewedRegistryInstallEvidenceProviderPathEscaped' -ErrorAction Stop"
        "            if (`$evidenceKey.GetValueKind('$reviewedRegistryInstallEvidenceValueNameEscaped') -ne [Microsoft.Win32.RegistryValueKind]::DWord) { return `$false }"
        "            `$evidenceValue = `$evidenceKey.GetValue('$reviewedRegistryInstallEvidenceValueNameEscaped', `$null)"
        "            return `$null -ne `$evidenceValue -and [uint64]`$evidenceValue -ge [uint64]$reviewedRegistryInstallEvidenceMinimumDword"
        '        } catch {'
        '            return $false'
        '        }'
        '    }'
        ''
    )
} elseif ($useRegistryUninstall) {
    $lines += @(
        '    # Snapshot uninstall entries so the exact vendor entry created or updated by this installer can be reused later.'
        '    $preInstallApplications = @(Get-ADTApplication -ErrorAction SilentlyContinue)'
        "    `$configuredUninstallProductCode = '$registryUninstallProductCode'"
        "    `$configuredUninstallDisplayName = '$registryUninstallDisplayNameEscaped'"
        "    `$configuredUninstallLocaleHint = '$registryUninstallLocaleHintEscaped'"
        '    $capturedUninstallKey = $null'
        '    $capturedUninstallName = $null'
        '    $multiProductInstallationVerified = $false'
        ''
    )
}

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

# Generate install command. Reviewed administrative-image adapters take
# precedence over generic launcher synthesis; application adapters remove
# customer overrides.
if ($reviewedInstallShieldAdministrativeImageConfigured) {
    $lines += @(
        '    # Create the reviewed administrative image in the target context; never run the vendor launcher as the installer.'
        '    $embeddedMsiAdminDir = [System.IO.Path]::Combine($env:TEMP, "IntuneGet_AdminImage_" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))'
        '    $null = New-Item -Path $embeddedMsiAdminDir -ItemType Directory -Force'
        '    try {'
        '        # InstallShield /a creates an administrative image. /s and /qn keep both launcher and MSI UI headless under LocalSystem.'
        '        $embeddedMsiAdminArguments = ''/a"'' + $embeddedMsiAdminDir + ''" /s /v"/qn TARGETDIR='' + $embeddedMsiAdminDir + '' REBOOT=ReallySuppress"'''
        '        Write-ADTLogEntry -Message "Creating reviewed InstallShield administrative image in a bounded temporary directory." -Severity ''Info'' -Source ''Install-ADTDeployment'''
        '        Start-ADTProcess -FilePath $installerPath -ArgumentList $embeddedMsiAdminArguments -WindowStyle Hidden -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 5) -TimeoutAction Stop'
        '        $embeddedMsiFiles = @(Get-ChildItem -LiteralPath $embeddedMsiAdminDir -Filter ''*.msi'' -File -Recurse -ErrorAction Stop)'
        "        if (`$embeddedMsiFiles.Count -ne 1 -or `$embeddedMsiFiles[0].Name -ine '$reviewedInstallShieldMsiExpectedFileNameEscaped') {"
        "            throw 'Reviewed InstallShield administrative image did not produce exactly one $reviewedInstallShieldMsiExpectedFileNameEscaped file.'"
        '        }'
        '        $embeddedMsiPath = $embeddedMsiFiles[0].FullName'
        "        `$expectedEmbeddedMsiProductCode = '$registryUninstallProductCode'"
        '        $embeddedMsiInstaller = $null'
        '        $embeddedMsiDatabase = $null'
        '        $embeddedMsiView = $null'
        '        $embeddedMsiRecord = $null'
        '        try {'
        '            $embeddedMsiInstaller = New-Object -ComObject WindowsInstaller.Installer'
        '            $embeddedMsiDatabase = $embeddedMsiInstaller.GetType().InvokeMember(''OpenDatabase'', [System.Reflection.BindingFlags]::InvokeMethod, $null, $embeddedMsiInstaller, @($embeddedMsiPath, 0))'
        '            $embeddedMsiView = $embeddedMsiDatabase.OpenView("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = ''ProductCode''")'
        '            [void]$embeddedMsiView.Execute()'
        '            $embeddedMsiRecord = $embeddedMsiView.Fetch()'
        '            $embeddedMsiProductCode = if ($embeddedMsiRecord) { [string]$embeddedMsiRecord.StringData(1) } else { $null }'
        '        }'
        '        finally {'
        '            if ($embeddedMsiView) { try { [void]$embeddedMsiView.Close() } catch { } }'
        '            foreach ($embeddedMsiComObject in @($embeddedMsiRecord, $embeddedMsiView, $embeddedMsiDatabase, $embeddedMsiInstaller)) {'
        '                if ($embeddedMsiComObject -and [System.Runtime.InteropServices.Marshal]::IsComObject($embeddedMsiComObject)) {'
        '                    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($embeddedMsiComObject)'
        '                }'
        '            }'
        '        }'
        '        if (-not [string]::Equals($embeddedMsiProductCode, $expectedEmbeddedMsiProductCode, [System.StringComparison]::OrdinalIgnoreCase)) {'
        '            throw "Administrative-image MSI product code [$embeddedMsiProductCode] does not match the manifest identity [$expectedEmbeddedMsiProductCode]."'
        '        }'
        '        Write-ADTLogEntry -Message "Validated the reviewed administrative-image MSI product identity; installing through PSADT." -Severity ''Info'' -Source ''Install-ADTDeployment'''
        '        Start-ADTMsiProcess -Action ''Install'' -FilePath $embeddedMsiPath -AdditionalArgumentList ''REBOOT=ReallySuppress'''
        '    }'
        '    finally {'
        '        if (Test-Path -LiteralPath $embeddedMsiAdminDir) {'
        '            Remove-Item -LiteralPath $embeddedMsiAdminDir -Recurse -Force -ErrorAction SilentlyContinue'
        '        }'
        '    }'
    )
} elseif (-not [string]::IsNullOrWhiteSpace($customInstallCommand)) {
    Write-Host "Using custom install command override from PSADT config"
    $lines += @(
        '    # Custom install command override (user-specified)'
        "    Write-ADTLogEntry -Message 'Executing custom install command' -Severity 'Info' -Source 'Install-ADTDeployment'"
        "    Start-ADTProcess -FilePath `"`$env:SystemRoot\System32\cmd.exe`" -ArgumentList '/c $customInstallCommandEscaped' -WorkingDirectory `$adtSession.DirFiles -WindowStyle Hidden"
    )
} else {
    $effectiveInstallerArgumentsEscaped = $silentSwitchesEscaped
    if ($installerTypeLower -eq 'inno') {
        $innoSwitches = $effectiveSilentSwitches.Trim()
        if ($innoSwitches -notmatch '(?i)(^|\s)/SP-(\s|$)') { $innoSwitches = "$innoSwitches /SP-".Trim() }
        # Keep automatic observability out of the vendor command line. Some Inno
        # packages fail during initialization when an injected /LOG target cannot
        # be created or when vendor code rejects an otherwise valid extra switch.
        # User-provided switches remain byte-for-byte authoritative apart from the
        # idempotent /SP- safety switch and PowerShell single-quote encoding.
        $innoSwitchesEscaped = $innoSwitches -replace "'", "''"
        $effectiveInstallerArgumentsEscaped = $innoSwitchesEscaped
    }
    $installerArgumentList = "'$effectiveInstallerArgumentsEscaped'"
    if ($effectiveInstallerArgumentsEscaped -match '%[A-Za-z][A-Za-z0-9()_]*%') {
        $lines += "    `$effectiveInstallerArguments = [Environment]::ExpandEnvironmentVariables('$effectiveInstallerArgumentsEscaped')"
        $installerArgumentList = '$effectiveInstallerArguments'
    }
    switch ($installerTypeLower) {
        { $_ -in 'msi', 'wix' } {
            $msiProperties = ($silentSwitchesEscaped -replace '/q[nbrfu]?\s*', '' -replace '/quiet\s*', '').Trim()
            if ($msiProperties) {
                $msiPropertiesEscaped = $msiProperties -replace "'", "''"
                if ($msiPropertiesEscaped -match '%[A-Za-z][A-Za-z0-9()_]*%') {
                    $lines += @(
                        "    `$effectiveMsiProperties = [Environment]::ExpandEnvironmentVariables('$msiPropertiesEscaped')"
                        "    Start-ADTMsiProcess -Action 'Install' -FilePath '$installerFileNameSingleQuoteEscaped' -AdditionalArgumentList `$effectiveMsiProperties"
                    )
                } else {
                    $lines += @(
                        "    Start-ADTMsiProcess -Action 'Install' -FilePath '$installerFileNameSingleQuoteEscaped' -AdditionalArgumentList '$msiPropertiesEscaped'"
                    )
                }
            } else {
                $lines += @(
                    "    Start-ADTMsiProcess -Action 'Install' -FilePath '$installerFileNameSingleQuoteEscaped'"
                )
            }
        }
        { $_ -in 'msix', 'appx' } {
            if ($IsUserScope) {
                $lines += @(
                    "    `$msixPath = `"`$(`$adtSession.DirFiles)\$installerFileName`""
                    "    `$packageName = '$msixPackageName'"
                    "    `$targetVersion = '$versionSingleQuoteEscaped'"
                    '    Write-ADTLogEntry -Message "Registering user-scoped MSIX/APPX package: $msixPath" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                    '    try {'
                    '        $existingPackage = Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1'
                    '        $shouldInstallPackage = $true'
                    '        if ($existingPackage) {'
                    '            try {'
                    '                $shouldInstallPackage = [version]$existingPackage.Version -lt [version]$targetVersion'
                    '            } catch {'
                    '                $shouldInstallPackage = [string]$existingPackage.Version -ne $targetVersion'
                    '            }'
                    '            if (-not $shouldInstallPackage) {'
                    '                Write-ADTLogEntry -Message "MSIX/APPX package [$packageName] version [$($existingPackage.Version)] already satisfies target [$targetVersion]; no registration change is required." -Severity ''Success'' -Source ''Install-ADTDeployment'''
                    '            }'
                    '        }'
                    '        if ($shouldInstallPackage) {'
                    '            Add-AppxPackage -Path $msixPath -ForceApplicationShutdown -ErrorAction Stop'
                    '            Write-ADTLogEntry -Message "User-scoped MSIX/APPX package registered successfully" -Severity ''Success'' -Source ''Install-ADTDeployment'''
                    '        }'
                    '    } catch {'
                    '        Write-ADTLogEntry -Message "Failed to register user-scoped MSIX/APPX package: $_" -Severity ''Error'' -Source ''Install-ADTDeployment'''
                    '        throw'
                    '    }'
                )
            } else {
                $lines += @(
                    "    `$msixPath = `"`$(`$adtSession.DirFiles)\$installerFileName`""
                    "    `$packageName = '$msixPackageName'"
                    "    `$targetVersion = '$versionSingleQuoteEscaped'"
                    '    Write-ADTLogEntry -Message "Provisioning machine-scoped MSIX/APPX package for all users: $msixPath" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                    '    try {'
                    '        $existingPackage = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq $packageName } | Sort-Object Version -Descending | Select-Object -First 1'
                    '        $shouldInstallPackage = $true'
                    '        if ($existingPackage) {'
                    '            try {'
                    '                $shouldInstallPackage = [version]$existingPackage.Version -lt [version]$targetVersion'
                    '            } catch {'
                    '                $shouldInstallPackage = [string]$existingPackage.Version -ne $targetVersion'
                    '            }'
                    '            if (-not $shouldInstallPackage) {'
                    '                Write-ADTLogEntry -Message "Provisioned MSIX/APPX package [$packageName] version [$($existingPackage.Version)] already satisfies target [$targetVersion]." -Severity ''Success'' -Source ''Install-ADTDeployment'''
                    '            }'
                    '        }'
                    '        if ($shouldInstallPackage) {'
                    '            Add-AppxProvisionedPackage -Online -PackagePath $msixPath -SkipLicense -ErrorAction Stop'
                    '            Write-ADTLogEntry -Message "Machine-scoped MSIX/APPX package provisioned successfully" -Severity ''Success'' -Source ''Install-ADTDeployment'''
                    '        }'
                    '    } catch {'
                    '        Write-ADTLogEntry -Message "Failed to provision machine-scoped MSIX/APPX package: $_" -Severity ''Error'' -Source ''Install-ADTDeployment'''
                    '        throw'
                    '    }'
                )
            }
        }
        'zip' {
            # Archives without a nested contract and nested portable archives are
            # safely staged as complete portable application folders.
            $nestedInstallerPathEscaped = $NestedInstallerPath -replace "'", "''"
            $nestedInstallerTypeLower = if ($NestedInstallerType) { $NestedInstallerType.ToLower() } else { '' }
            if ($isNestedPortable -or $isPlainPortableArchive) {
                    Write-Host "Staging zip as portable archive"
                    $lines += @(
                        ''
                        '    # Safely stage every portable archive entry before replacing the installed app'
                        $portableInstallPathLine
                        '    $portableStageDir = [System.IO.Path]::Combine($env:TEMP, "IntuneGet_Portable_" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))'
                        '    $replacementStarted = $false'
                        '    try {'
                        '        $null = New-Item -Path $portableStageDir -ItemType Directory -Force'
                        '        Add-Type -AssemblyName System.IO.Compression.FileSystem'
                        '        $stageRoot = [System.IO.Path]::GetFullPath($portableStageDir)'
                        '        $stageRootPrefix = $stageRoot.TrimEnd([char[]]@(''\'', ''/'')) + [System.IO.Path]::DirectorySeparatorChar'
                        '        $archive = [System.IO.Compression.ZipFile]::OpenRead($installerPath)'
                        '        try {'
                        '            foreach ($entry in $archive.Entries) {'
                        '                $entryRelativePath = $entry.FullName.Replace(''/'', [System.IO.Path]::DirectorySeparatorChar)'
                        '                if ([string]::IsNullOrWhiteSpace($entryRelativePath)) { continue }'
                        '                if ($entryRelativePath.Contains('':'')) { throw "Archive entry contains an unsupported path: $($entry.FullName)" }'
                        '                $targetPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($stageRoot, $entryRelativePath))'
                        '                if ($targetPath -ne $stageRoot -and -not $targetPath.StartsWith($stageRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {'
                        '                    throw "Archive entry escapes the portable staging directory: $($entry.FullName)"'
                        '                }'
                        '                if ([string]::IsNullOrEmpty($entry.Name)) {'
                        '                    $null = New-Item -Path $targetPath -ItemType Directory -Force'
                        '                    continue'
                        '                }'
                        '                $targetDirectory = [System.IO.Path]::GetDirectoryName($targetPath)'
                        '                if ($targetDirectory) { $null = New-Item -Path $targetDirectory -ItemType Directory -Force }'
                        '                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)'
                        '            }'
                        '        }'
                        '        finally {'
                        '            if ($archive) { $archive.Dispose() }'
                        '        }'
                    )
                    if ($isNestedPortable) {
                        $lines += @(
                            "        `$declaredNestedPath = [System.IO.Path]::GetFullPath((Join-Path `$stageRoot '$nestedInstallerPathEscaped'))"
                            '        if (-not $declaredNestedPath.StartsWith($stageRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {'
                            '            throw "Nested installer path escapes the portable staging directory"'
                            '        }'
                            '        if (-not (Test-Path -LiteralPath $declaredNestedPath -PathType Leaf)) {'
                            "            throw `"Nested installer not found in archive: $nestedInstallerPathEscaped`""
                            '        }'
                        )
                    }
                    $lines += @(
                        '        $installParent = [System.IO.Path]::GetDirectoryName($installPath)'
                        '        if ($installParent) { $null = New-Item -Path $installParent -ItemType Directory -Force }'
                        '        $replacementStarted = $true'
                        '        if (Test-Path -LiteralPath $installPath) { Remove-Item -LiteralPath $installPath -Recurse -Force -ErrorAction Stop }'
                        '        Move-Item -LiteralPath $portableStageDir -Destination $installPath -Force'
                        '        Write-ADTLogEntry -Message "Portable archive installed to: $installPath" -Severity ''Success'' -Source ''Install-ADTDeployment'''
                        '    }'
                        '    catch {'
                        '        if ($replacementStarted -and (Test-Path -LiteralPath $installPath)) {'
                        '            Remove-Item -LiteralPath $installPath -Recurse -Force -ErrorAction SilentlyContinue'
                        '        }'
                        '        Write-ADTLogEntry -Message "Failed to install portable archive: $_" -Severity ''Error'' -Source ''Install-ADTDeployment'''
                        '        throw'
                        '    }'
                        '    finally {'
                        '        if (Test-Path -LiteralPath $portableStageDir) {'
                        '            Remove-Item -LiteralPath $portableStageDir -Recurse -Force -ErrorAction SilentlyContinue'
                        '        }'
                        '    }'
                    )
                } else {
                    # Build the execution line for a non-portable nested installer.
                    switch ($nestedInstallerTypeLower) {
                        { $_ -in 'msi', 'wix' } {
                            $msiProperties = ($silentSwitchesEscaped -replace '/q[nbrfu]?\s*', '' -replace '/quiet\s*', '').Trim()
                            if ($msiProperties) {
                                $nestedExecuteLine = "        Start-ADTMsiProcess -Action 'Install' -FilePath `$nestedInstallerPath -AdditionalArgumentList '$msiProperties'"
                            } else {
                                $nestedExecuteLine = "        Start-ADTMsiProcess -Action 'Install' -FilePath `$nestedInstallerPath"
                            }
                        }
                        default {
                            if ($IsUserScope) {
                                $nestedExecuteLine = "        Start-ADTProcess -FilePath `$nestedInstallerPath -ArgumentList '$silentSwitchesEscaped' -UseShellExecute -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 15) -TimeoutAction Stop"
                            } else {
                                $nestedExecuteLine = "        Start-ADTProcess -FilePath `$nestedInstallerPath -ArgumentList '$silentSwitchesEscaped' -WindowStyle Hidden -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 15) -TimeoutAction Stop"
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
                "    `$sourcePath = `"`$(`$adtSession.DirFiles)\$installerFileName`""
                $portableInstallPathLine
                '    Write-ADTLogEntry -Message "Installing portable app to: $installPath" -Severity ''Info'' -Source ''Install-ADTDeployment'''
                '    try {'
                '        if (-not (Test-Path $installPath)) {'
                '            New-Item -Path $installPath -ItemType Directory -Force | Out-Null'
                '        }'
            )
            if ($fileExtension -eq '.zip') {
                $lines += '        Expand-Archive -LiteralPath $sourcePath -DestinationPath $installPath -Force'
            } else {
                $lines += @(
                    "        `$targetPath = Join-Path `$installPath '$installerFileNameSingleQuoteEscaped'"
                    '        Copy-Item -LiteralPath $sourcePath -Destination $targetPath -Force'
                )
            }
            $lines += @(
                '        Write-ADTLogEntry -Message "Portable app installed successfully" -Severity ''Success'' -Source ''Install-ADTDeployment'''
                '    } catch {'
                '        Write-ADTLogEntry -Message "Failed to install portable app: $_" -Severity ''Error'' -Source ''Install-ADTDeployment'''
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
                    "        Start-ADTProcess -FilePath `$installerDest -ArgumentList $installerArgumentList -UseShellExecute -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 15) -TimeoutAction Stop"
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
                    "    Start-ADTProcess -FilePath `"`$(`$adtSession.DirFiles)\$installerFileName`" -ArgumentList $installerArgumentList -WindowStyle Hidden -WaitForMsiExec -Timeout (New-TimeSpan -Minutes 15) -TimeoutAction Stop"
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

if ($useManagedDirectoryLifecycle) {
    $lines += @('', "    `$managedInstallDirectory = [Environment]::ExpandEnvironmentVariables('$reviewedManagedInstallDirectoryEscaped')")
    if ($hasManagedInstallCompletionContract) {
        $lines += @(
            "    `$managedInstallEvidenceFile = [Environment]::ExpandEnvironmentVariables('$reviewedManagedInstallEvidenceFileEscaped')"
            "    `$managedInstallCompletionProcess = [Environment]::ExpandEnvironmentVariables('$reviewedManagedInstallCompletionProcessEscaped')"
            "    `$managedInstallDeadline = [DateTime]::UtcNow.AddMinutes($reviewedManagedInstallCompletionTimeoutMinutes)"
            '    $managedInstallReadyObservations = 0'
            '    do {'
            '        $managedInstallEvidenceReady = Test-Path -LiteralPath $managedInstallEvidenceFile -PathType Leaf'
            '        $managedInstallProcessActive = $false'
            '        if (-not [string]::IsNullOrWhiteSpace($managedInstallCompletionProcess)) {'
            '            $managedInstallProcessActive = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {'
            '                [string]::Equals([string]$_.ExecutablePath, $managedInstallCompletionProcess, [System.StringComparison]::OrdinalIgnoreCase)'
            '            }).Count -gt 0'
            '        }'
            '        if ($managedInstallEvidenceReady -and -not $managedInstallProcessActive) {'
            '            $managedInstallReadyObservations++'
            '        } else {'
            '            $managedInstallReadyObservations = 0'
            '        }'
            '        if ($managedInstallReadyObservations -ge 2) { break }'
            '        Start-Sleep -Seconds 5'
            '    } while ([DateTime]::UtcNow -lt $managedInstallDeadline)'
            '    if ($managedInstallReadyObservations -lt 2) {'
            '        throw "The reviewed managed installation did not reach stable completion before the deadline: $managedInstallEvidenceFile"'
            '    }'
            '    Write-ADTLogEntry -Message "Verified stable managed installation evidence at [$managedInstallEvidenceFile]." -Severity ''Success'' -Source ''Install-ADTDeployment'''
        )
    } else {
        $lines += @(
            '    if (-not (Test-Path -LiteralPath $managedInstallDirectory -PathType Container)) {'
            '        throw "The reviewed managed install directory was not created: $managedInstallDirectory"'
            '    }'
            '    $managedPayloadFile = Get-ChildItem -LiteralPath $managedInstallDirectory -File -Recurse -ErrorAction Stop | Select-Object -First 1'
            '    if (-not $managedPayloadFile) {'
            '        throw "The reviewed managed install directory contains no payload files: $managedInstallDirectory"'
            '    }'
            '    Write-ADTLogEntry -Message "Verified managed extracted payload at [$managedInstallDirectory]." -Severity ''Success'' -Source ''Install-ADTDeployment'''
        )
    }
}

# Optional post-install verification (opt-in via PSADT config)
# Throwing here routes through the standard catch -> Close-ADTSession error exit,
# and the detection marker write below is skipped because it never runs
if ($useRegistryUninstall -and $reviewedRegistryInstallEvidenceConfigured) {
    $lines += @(
        '    # Wait briefly for the documented Windows runtime registry signal to become visible.'
        '    foreach ($verificationAttempt in 1..30) {'
        '        if (Test-IntuneGetReviewedRegistryInstallEvidence) {'
        '            $reviewedRegistryInstallationVerified = $true'
        '            break'
        '        }'
        '        if ($verificationAttempt -lt 30) { Start-Sleep -Seconds 2 }'
        '    }'
        '    if (-not $reviewedRegistryInstallationVerified) {'
        "        throw 'Reviewed registry install verification failed: expected a DWORD value of at least $reviewedRegistryInstallEvidenceMinimumDword.'"
        '    }'
        "    Write-ADTLogEntry -Message 'Verified reviewed Windows runtime registry evidence.' -Severity 'Success' -Source 'Install-ADTDeployment'"
        ''
    )
} elseif ($useRegistryUninstall) {
    $lines += @(
        '    # Capture the registry uninstall entry created or version-updated by this installer.'
        '    # Manifest identity is a preference; the observed ARP delta is authoritative when metadata is stale.'
        '    $selectedApplications = @()'
        '    $changedApplications = @()'
        '    $configuredUninstallComparableName = (($configuredUninstallDisplayName -replace ''(?i)(?<![A-Za-z0-9])(x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)(?![A-Za-z0-9])'', '''' -replace ''\(\s*\)'', '''' -replace ''\(\s+'', ''('' -replace ''\s+\)'', '')'' -replace ''\s{2,}'', '' '')).Trim()'
        "    `$configuredUninstallPublisherName = '$publisherSingleQuoteEscaped'"
        '    $configuredUninstallPublisherAgnosticName = if ($configuredUninstallPublisherName) {'
        '        ($configuredUninstallComparableName -replace (''(?i)^'' + [regex]::Escape($configuredUninstallPublisherName) + ''(?:\s+|[._-]+)''), '''').Trim()'
        '    } else { $configuredUninstallComparableName }'
        '    $configuredUninstallVersion = [string]$adtSession.AppVersion'
        '    $configuredUninstallVersionedName = if (-not [string]::IsNullOrWhiteSpace($configuredUninstallVersion)) {'
        '        "$configuredUninstallComparableName $configuredUninstallVersion"'
        '    } else { $null }'
        '    # Some language-specific WinGet manifests carry a default-locale ARP name even though'
        '    # the selected installer registers its requested locale (for example en-US versus de).'
        '    # Only enable locale-agnostic comparison when the package ID has a locale suffix and the'
        '    # configured name has a strict locale qualifier. The observed install delta and one-match'
        '    # requirement remain authoritative, so helper products and parallel editions stay excluded.'
        '    $configuredLocaleSuffixPattern = ''\(\s*(?:(?:x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)\s+)?[a-z]{2,3}(?:-[A-Z]{2})?\s*\)$'''
        '    $configuredUninstallLocaleAgnosticName = if ($configuredUninstallLocaleHint -and $configuredUninstallDisplayName -cmatch $configuredLocaleSuffixPattern) {'
        '        ($configuredUninstallDisplayName -creplace $configuredLocaleSuffixPattern, '''').Trim()'
        '    } else { $null }'
        '    $candidateLocaleSuffixPattern = if ($configuredUninstallLocaleAgnosticName) {'
        '        ''\(\s*(?:(?:x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)\s+)?'' + [regex]::Escape($configuredUninstallLocaleHint) + ''\s*\)$'''
        '    } else { $null }'
        '    foreach ($verificationAttempt in 1..30) {'
        '        $postInstallApplications = @(Get-ADTApplication -ErrorAction SilentlyContinue)'
        '        $changedApplications = @($postInstallApplications | Where-Object {'
        '            $candidateApplication = $_'
        '            $previousApplication = $preInstallApplications | Where-Object { $_.PSPath -eq $candidateApplication.PSPath } | Select-Object -First 1'
        '            (-not $previousApplication) -or ($previousApplication.DisplayVersion -ne $candidateApplication.DisplayVersion)'
        '        })'
        '        $selectedApplications = @()'
        '        if ($configuredUninstallProductCode) {'
        '            $selectedApplications = @($changedApplications | Where-Object { [string]$_.PSChildName -eq $configuredUninstallProductCode })'
        '        }'
        '        if ($selectedApplications.Count -eq 0) {'
        '            $selectedApplications = @($changedApplications | Where-Object { [string]$_.DisplayName -eq $configuredUninstallDisplayName })'
        '        }'
        '        if ($selectedApplications.Count -eq 0 -and $configuredUninstallComparableName) {'
        '            $architectureAgnosticMatches = @($changedApplications | Where-Object {'
        '                $candidateDisplayName = [string]$_.DisplayName'
        '                $candidateComparableName = (($candidateDisplayName -replace ''(?i)(?<![A-Za-z0-9])(x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)(?![A-Za-z0-9])'', '''' -replace ''\(\s*\)'', '''' -replace ''\(\s+'', ''('' -replace ''\s+\)'', '')'' -replace ''\s{2,}'', '' '')).Trim()'
        '                $candidateComparableName -eq $configuredUninstallComparableName'
        '            })'
        '            if ($architectureAgnosticMatches.Count -eq 1) { $selectedApplications = $architectureAgnosticMatches }'
        '        }'
        '        if ($selectedApplications.Count -eq 0 -and $configuredUninstallPublisherAgnosticName) {'
        '            $publisherAgnosticMatches = @($changedApplications | Where-Object {'
        '                $candidateComparableName = (([string]$_.DisplayName -replace ''(?i)(?<![A-Za-z0-9])(x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)(?![A-Za-z0-9])'', '''' -replace ''\(\s*\)'', '''' -replace ''\(\s+'', ''('' -replace ''\s+\)'', '')'' -replace ''\s{2,}'', '' '')).Trim()'
        '                $candidatePublisherAgnosticName = if ($configuredUninstallPublisherName) {'
        '                    ($candidateComparableName -replace (''(?i)^'' + [regex]::Escape($configuredUninstallPublisherName) + ''(?:\s+|[._-]+)''), '''').Trim()'
        '                } else { $candidateComparableName }'
        '                $candidatePublisherAgnosticName -eq $configuredUninstallPublisherAgnosticName'
        '            })'
        '            if ($publisherAgnosticMatches.Count -eq 1) { $selectedApplications = $publisherAgnosticMatches }'
        '        }'
        '        if ($selectedApplications.Count -eq 0 -and $configuredUninstallVersionedName) {'
        '            # Some MSI packages append their exact package version to the ARP display name.'
        '            # Accept only one observed delta whose normalized name and DisplayVersion both'
        '            # equal the requested package identity; a different version remains rejected.'
        '            $versionSuffixedMatches = @($changedApplications | Where-Object {'
        '                $candidateDisplayName = [string]$_.DisplayName'
        '                $candidateComparableName = (($candidateDisplayName -replace ''(?i)(?<![A-Za-z0-9])(x86_64|aarch64|amd64|arm64|x64|x86|win64|win32|64-bit|32-bit)(?![A-Za-z0-9])'', '''' -replace ''\(\s*\)'', '''' -replace ''\(\s+'', ''('' -replace ''\s+\)'', '')'' -replace ''\s{2,}'', '' '')).Trim()'
        '                $candidateComparableName -eq $configuredUninstallVersionedName -and'
        '                    [string]$_.DisplayVersion -eq $configuredUninstallVersion'
        '            })'
        '            if ($versionSuffixedMatches.Count -eq 1) { $selectedApplications = $versionSuffixedMatches }'
        '        }'
        '        if ($selectedApplications.Count -eq 0 -and $candidateLocaleSuffixPattern) {'
        '            $localeAgnosticMatches = @($changedApplications | Where-Object {'
        '                $candidateDisplayName = [string]$_.DisplayName'
        '                if ($candidateDisplayName -cnotmatch $candidateLocaleSuffixPattern) { return $false }'
        '                $candidateLocaleAgnosticName = ($candidateDisplayName -creplace $candidateLocaleSuffixPattern, '''').Trim()'
        '                $candidateLocaleAgnosticName -eq $configuredUninstallLocaleAgnosticName'
        '            })'
        '            if ($localeAgnosticMatches.Count -eq 1) { $selectedApplications = $localeAgnosticMatches }'
        '        }'
        '        if ($selectedApplications.Count -eq 0) {'
        '            $bundleCandidates = @($changedApplications | Where-Object {'
        '                $systemComponentProperty = $_.PSObject.Properties[''SystemComponent'']'
        '                $isVisibleApplication = -not $systemComponentProperty -or -not [bool]$systemComponentProperty.Value'
        '                $isVisibleApplication -and -not $_.WindowsInstaller -and [string]$_.DisplayName -like "$configuredUninstallDisplayName*"'
        '            })'
        '            if ($bundleCandidates.Count -eq 1) { $selectedApplications = $bundleCandidates }'
        '        }'
    )

    # This is a packager-time decision. Do not emit $originalInstallerType into the
    # generated deployment script: that variable exists only in this generator and
    # StrictMode would turn the fallback check into a post-install 60001 failure.
    if ($originalInstallerType -eq 'burn') {
        $lines += @(
            '        if ($selectedApplications.Count -gt 1) {'
            '            # A Burn bundle and its chained MSI can intentionally share the same ARP display name.'
            '            # Prefer the single non-MSI entry from the already identity-matched set; never widen'
            '            # an ambiguous match to an unrelated uninstall entry.'
            '            $bundleCandidates = @($selectedApplications | Where-Object {'
            '                $systemComponentProperty = $_.PSObject.Properties[''SystemComponent'']'
            '                $isVisibleApplication = -not $systemComponentProperty -or -not [bool]$systemComponentProperty.Value'
            '                $isVisibleApplication -and -not $_.WindowsInstaller'
            '            })'
            '            if ($bundleCandidates.Count -eq 1) { $selectedApplications = $bundleCandidates }'
            '        }'
            '        if ($selectedApplications.Count -eq 0) {'
            '            $bundleCandidates = @($changedApplications | Where-Object { -not $_.WindowsInstaller })'
            '            if ($bundleCandidates.Count -eq 1) { $selectedApplications = $bundleCandidates }'
            '        }'
        )
    }

    $lines += @(
        '        if ($selectedApplications.Count -eq 0 -and $configuredUninstallProductCode) {'
        '            $configuredMatches = @($postInstallApplications | Where-Object { [string]$_.PSChildName -eq $configuredUninstallProductCode })'
        '            if ($configuredMatches.Count -eq 1) { $selectedApplications = $configuredMatches }'
        '        }'
    )

    if ($reviewedMultiProductInstallDisplayNamePrefixes.Count -gt 0) {
        $lines += @(
            "        `$reviewedMultiProductPrefixes = @($reviewedMultiProductInstallDisplayNamePrefixesLiteral)"
            '        $reviewedMultiProductMatches = @($postInstallApplications | Where-Object {'
            '            $candidateDisplayName = [string]$_.DisplayName'
            '            @($reviewedMultiProductPrefixes | Where-Object { $candidateDisplayName.StartsWith($_, [System.StringComparison]::OrdinalIgnoreCase) }).Count -gt 0'
            '        })'
            "        if (`$reviewedMultiProductMatches.Count -ge $reviewedMultiProductInstallMinimumCount) {"
            '            $multiProductInstallationVerified = $true'
            '        }'
        )
    }

    # Shared Windows runtimes can already be installed at the requested (or a
    # newer) version. Their vendor installer then succeeds without changing ARP.
    # Accept that no-op only for a reviewed retention adapter, and only when one
    # unchanged pre-install identity exactly matches and satisfies the requested
    # version. Ordinary applications must still prove an observed install delta.
    if ($preserveVendorInstallationOnUninstall) {
        $lines += @(
            '        if ($selectedApplications.Count -eq 0) {'
            '            $sharedRuntimeMatches = @($postInstallApplications | Where-Object {'
            '                $candidateApplication = $_'
            '                $previousApplication = $preInstallApplications | Where-Object { $_.PSPath -eq $candidateApplication.PSPath } | Select-Object -First 1'
            '                if (-not $previousApplication -or $previousApplication.DisplayVersion -ne $candidateApplication.DisplayVersion) { return $false }'
            '                $identityMatches = if ($configuredUninstallProductCode) {'
            '                    [string]$candidateApplication.PSChildName -eq $configuredUninstallProductCode'
            '                } else {'
            '                    [string]$candidateApplication.DisplayName -eq $configuredUninstallDisplayName'
            '                }'
            '                if (-not $identityMatches) { return $false }'
            '                $installedVersionText = [string]$candidateApplication.DisplayVersion'
            '                $requestedVersionText = [string]$adtSession.AppVersion'
            '                if ($installedVersionText -eq $requestedVersionText) { return $true }'
            '                $installedVersion = $null'
            '                $requestedVersion = $null'
            '                [version]::TryParse($installedVersionText, [ref]$installedVersion) -and'
            '                    [version]::TryParse($requestedVersionText, [ref]$requestedVersion) -and'
            '                    $installedVersion -ge $requestedVersion'
            '            })'
            '            if ($sharedRuntimeMatches.Count -eq 1) {'
            '                $selectedApplications = $sharedRuntimeMatches'
            '                Write-ADTLogEntry -Message "Reusing already-installed shared runtime identity [$($selectedApplications[0].DisplayName)] version [$($selectedApplications[0].DisplayVersion)]." -Source ''Install-ADTDeployment'''
            '            }'
            '        }'
        )
    }

    $lines += @(
        '        if ($selectedApplications.Count -eq 1) { break }'
        '        if ($multiProductInstallationVerified) { break }'
        '        if ($verificationAttempt -lt 30) { Start-Sleep -Seconds 2 }'
        '    }'
        '    if ($selectedApplications.Count -eq 1) {'
        '        $capturedUninstallKey = [string]$selectedApplications[0].PSChildName'
        '        $capturedUninstallName = [string]$selectedApplications[0].DisplayName'
        '        Write-ADTLogEntry -Message "Captured vendor uninstall entry [$capturedUninstallName] ($capturedUninstallKey)." -Source ''Install-ADTDeployment'''
        '    } elseif ($multiProductInstallationVerified) {'
        '        Write-ADTLogEntry -Message "Verified reviewed multi-product installation from $($reviewedMultiProductMatches.Count) matching vendor registrations." -Source ''Install-ADTDeployment'''
        '    } else {'
        '        throw "Could not select one vendor uninstall entry. The installer changed $($changedApplications.Count) entries and $($selectedApplications.Count) matched the configured identity."'
        '    }'
        ''
    )
}

if ($verifyInstall) {
    Write-Host "Post-install verification enabled"
    if ($useRegistryUninstall) {
        if ($reviewedRegistryInstallEvidenceConfigured) {
            $lines += @(
                ''
                '    ## Recheck the exact adapter-reviewed Windows runtime evidence.'
                '    if (-not (Test-IntuneGetReviewedRegistryInstallEvidence)) {'
                '        throw "Post-install verification failed: the reviewed Windows runtime registry evidence was not found."'
                '    }'
                "    Write-ADTLogEntry -Message 'Post-install verification passed for reviewed Windows runtime registry evidence' -Source 'Install-ADTDeployment'"
            )
        } elseif ($reviewedMultiProductInstallDisplayNamePrefixes.Count -gt 0) {
            $lines += @(
                ''
                '    ## Verify the reviewed multi-product bundle evidence established above.'
                '    if (-not $multiProductInstallationVerified) {'
                '        throw "Post-install verification failed: the reviewed multi-product registrations were not found."'
                '    }'
                "    Write-ADTLogEntry -Message `"Post-install verification passed for reviewed multi-product bundle`" -Source 'Install-ADTDeployment'"
            )
        } else {
            $lines += @(
            ''
            '    ## Verify the exact uninstall identity captured from this installation.'
            '    $verifyApps = if ($capturedUninstallKey) {'
            '        @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $capturedUninstallKey } -ErrorAction SilentlyContinue)'
            '    } else { @() }'
            '    if ($verifyApps.Count -ne 1) {'
            '        throw "Post-install verification failed: the captured vendor uninstall entry was not found."'
            '    }'
            "    Write-ADTLogEntry -Message `"Post-install verification passed for captured vendor identity`" -Source 'Install-ADTDeployment'"
            )
        }
    } else {
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
$userUninstallMarkerLines = @()
$machineUninstallMarkerLines = @()
if ($useRegistryUninstall) {
    $userUninstallMarkerLines = @(
        '            if ($capturedUninstallKey) { Set-ADTRegistryKey -LiteralPath ''HKCU\' + $registryMarkerPathEscaped + '\' + $sanitizedWingetId + ''' -Name ''UninstallRegistryKey'' -Value $capturedUninstallKey -Type String -SID $_.SID }',
        '            if ($capturedUninstallName) { Set-ADTRegistryKey -LiteralPath ''HKCU\' + $registryMarkerPathEscaped + '\' + $sanitizedWingetId + ''' -Name ''UninstallDisplayName'' -Value $capturedUninstallName -Type String -SID $_.SID }'
    )
    $machineUninstallMarkerLines = @(
        '        if ($capturedUninstallKey) { Set-ADTRegistryKey -LiteralPath $regPath -Name ''UninstallRegistryKey'' -Value $capturedUninstallKey -Type String }',
        '        if ($capturedUninstallName) { Set-ADTRegistryKey -LiteralPath $regPath -Name ''UninstallDisplayName'' -Value $capturedUninstallName -Type String }'
    )
}
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
        $userUninstallMarkerLines
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
        $machineUninstallMarkerLines
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

if ($uninstallWelcomeCall) {
    $lines += $uninstallWelcomeCall
}

# Add pre-uninstall prompts
if ($preUninstallPromptCalls) {
    $lines += $preUninstallPromptCalls
}

# Generate uninstall command. A reviewed shared-runtime adapter takes
# precedence because executing the vendor command could remove a prerequisite
# used by Windows or unrelated applications. The ordinary marker cleanup below
# still makes Intune's exact package detection transition to not installed.
$reviewedExactUninstallOverrideLines = @(
    '    $useReviewedExactUninstall = $false'
)
if ($reviewedExactUninstallConfigured) {
    $reviewedExactUninstallOverrideLines += @(
        '    $useReviewedExactUninstall = $true'
        $(if ($reviewedExactUninstallExecutable -eq '%PackageInstaller%') {
            "    `$registeredUninstallFile = Join-Path `$adtSession.DirFiles '$installerFileNameSingleQuoteEscaped'"
        } else {
            "    `$registeredUninstallFile = [Environment]::ExpandEnvironmentVariables('$reviewedExactUninstallExecutableEscaped')"
        })
        "    [string[]]`$registeredUninstallArguments = @($reviewedExactUninstallArgumentsLiteral) | ForEach-Object { [Environment]::ExpandEnvironmentVariables(`$_) }"
        '    $hasQuietUninstall = $true'
        '    $isVivaldiUninstall = $false'
        '    $isAdobeCreativeCloudUninstall = $false'
        '    Write-ADTLogEntry -Message "Using the reviewed exact vendor uninstall command [$registeredUninstallFile]." -Source ''Uninstall-ADTDeployment'''
    )
}
if ($useManagedDirectoryLifecycle) {
    Write-Host 'Using reviewed managed-directory removal'
    $lines += @('', "    `$managedInstallDirectory = [Environment]::ExpandEnvironmentVariables('$reviewedManagedInstallDirectoryEscaped')")
    if ($reviewedManagedUninstallConfigured) {
        $lines += @(
            "    `$managedUninstallExecutable = [Environment]::ExpandEnvironmentVariables('$reviewedManagedUninstallExecutableEscaped')"
            "    `$managedUninstallArguments = @($reviewedManagedUninstallArgumentsLiteral) | ForEach-Object { [Environment]::ExpandEnvironmentVariables(`$_) }"
            '    if (-not (Test-Path -LiteralPath $managedUninstallExecutable -PathType Leaf)) {'
            '        throw "The reviewed managed uninstaller was not found: $managedUninstallExecutable"'
            '    }'
            '    if (Test-Path -LiteralPath $managedInstallDirectory) {'
            '        Write-ADTLogEntry -Message "Starting reviewed managed uninstaller [$managedUninstallExecutable]." -Source ''Uninstall-ADTDeployment'''
            '        $null = Start-ADTProcess -FilePath $managedUninstallExecutable -ArgumentList $managedUninstallArguments -WindowStyle Hidden -NoWait -PassThru'
            "        `$managedUninstallDeadline = [DateTime]::UtcNow.AddMinutes($reviewedManagedUninstallTimeoutMinutes)"
            '        while ((Test-Path -LiteralPath $managedInstallDirectory) -and [DateTime]::UtcNow -lt $managedUninstallDeadline) {'
            '            Start-Sleep -Seconds 5'
            '        }'
            '        if (Test-Path -LiteralPath $managedInstallDirectory) {'
            '            throw "The reviewed managed uninstaller did not remove [$managedInstallDirectory] before the completion deadline."'
            '        }'
            '        Write-ADTLogEntry -Message "Reviewed managed uninstall completed for [$managedInstallDirectory]." -Severity ''Success'' -Source ''Uninstall-ADTDeployment'''
            '    } else {'
            '        Write-ADTLogEntry -Message "Managed installation was already absent: $managedInstallDirectory" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '    }'
        )
    } else {
        $lines += @(
            '    if (Test-Path -LiteralPath $managedInstallDirectory) {'
            '        Remove-Item -LiteralPath $managedInstallDirectory -Recurse -Force -ErrorAction Stop'
            '        Write-ADTLogEntry -Message "Removed managed extracted payload from [$managedInstallDirectory]." -Severity ''Success'' -Source ''Uninstall-ADTDeployment'''
            '    } else {'
            '        Write-ADTLogEntry -Message "Managed extracted payload was already absent: $managedInstallDirectory" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '    }'
        )
    }
} elseif ($preserveVendorInstallationOnUninstall) {
    Write-Host 'Preserving the shared vendor installation during package removal'
    $lines += @(
        ''
        '    # This reviewed package represents ownership of a shared Windows runtime.'
        '    # Relinquish IntuneGet management without removing the shared vendor payload.'
        '    Write-ADTLogEntry -Message "Retaining the shared vendor installation and removing only the IntuneGet management marker." -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
    )
} elseif (-not [string]::IsNullOrWhiteSpace($customUninstallCommand)) {
    Write-Host "Using custom uninstall command override from PSADT config"
    $lines += @(
        ''
        '    # Custom uninstall command override (user-specified)'
        "    Write-ADTLogEntry -Message 'Executing custom uninstall command' -Severity 'Info' -Source 'Uninstall-ADTDeployment'"
        "    Start-ADTProcess -FilePath `"`$env:SystemRoot\System32\cmd.exe`" -ArgumentList '/c $customUninstallCommandEscaped' -WorkingDirectory `$adtSession.DirFiles -WindowStyle Hidden"
    )
} elseif ($useRegistryUninstall) {
    $markerProviderPath = if ($IsUserScope) {
        "Registry::HKEY_CURRENT_USER\$registryMarkerPathEscaped\$sanitizedWingetId"
    } else {
        "Registry::HKEY_LOCAL_MACHINE\$registryMarkerPathEscaped\$sanitizedWingetId"
    }
    $lines += @(
        ''
        '    # Use PSADT v4 Uninstall-ADTApplication to find and uninstall'
        '    # This handles the registry lookup, MSI vs EXE detection, and silent'
        '    # switches automatically using the app''s registered QuietUninstallString'
        "    `$appName = '$registryUninstallDisplayNameEscaped'"
        "    `$configuredProductCode = '$registryUninstallProductCode'"
        "    `$markerProviderPath = '$markerProviderPath'"
        '    $configuredVersion = [string]$adtSession.AppVersion'
        '    $configuredVersionedAppName = if (-not [string]::IsNullOrWhiteSpace($configuredVersion)) { "$appName $configuredVersion" } else { $null }'
        ''
        '    $capturedUninstallKey = (Get-ItemProperty -LiteralPath $markerProviderPath -ErrorAction SilentlyContinue).UninstallRegistryKey'
        '    $installedApps = if ($capturedUninstallKey) {'
        '        Write-ADTLogEntry -Message "Searching for captured vendor uninstall entry: $capturedUninstallKey" -Source ''Uninstall-ADTDeployment'''
        '        @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $capturedUninstallKey })'
        '    } elseif ($configuredProductCode) {'
        '        Write-ADTLogEntry -Message "No captured entry; searching for manifest registry key: $configuredProductCode" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
        '        @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $configuredProductCode })'
        '    } else {'
        '        Write-ADTLogEntry -Message "No captured uninstall entry; searching by exact configured application name: $appName" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
        '        @(Get-ADTApplication -Name $appName -NameMatch ''Exact'')'
        '    }'
        ''
        '    if ($installedApps.Count -eq 0 -and -not $capturedUninstallKey -and -not $configuredProductCode -and $configuredVersionedAppName) {'
        '        $versionedMatches = @(Get-ADTApplication -Name $configuredVersionedAppName -NameMatch ''Exact'' | Where-Object {'
        '            [string]$_.DisplayVersion -eq $configuredVersion'
        '        })'
        '        if ($versionedMatches.Count -eq 1) { $installedApps = $versionedMatches }'
        '    }'
        ''
        "    `$allowContainsFallback = '$registeredInstallerTypeLower' -notin @('msi', 'wix')"
        '    if ($installedApps.Count -eq 0 -and -not $capturedUninstallKey -and -not $configuredProductCode -and $allowContainsFallback) {'
        '        $containsMatches = @(Get-ADTApplication -Name $appName -NameMatch ''Contains'')'
        '        $bundleMatches = @($containsMatches | Where-Object {'
        '            $systemComponentProperty = $_.PSObject.Properties[''SystemComponent'']'
        '            $isVisibleApplication = -not $systemComponentProperty -or -not [bool]$systemComponentProperty.Value'
        '            $isVisibleApplication -and -not $_.WindowsInstaller'
        '        })'
        '        if ($bundleMatches.Count -eq 1) {'
        '            $installedApps = $bundleMatches'
        '        } elseif ($containsMatches.Count -eq 1) {'
        '            $installedApps = $containsMatches'
        '        }'
        '    }'
        '    if ($installedApps.Count -ne 1) {'
        '        throw "Could not find one unambiguous vendor uninstall registry entry for [$appName]. Found $($installedApps.Count); refusing broad removal."'
        '    }'
        '    Write-ADTLogEntry -Message "Found exact vendor registry entry [$($installedApps[0].DisplayName)], uninstalling..." -Source ''Uninstall-ADTDeployment'''
    )
    if ($originalInstallerType -eq 'burn') {
        $lines += @(
            '    # Prefer an exact registered vendor removal helper while it exists. Retain the hash-verified'
            '    # packaged bundle as a durable fallback for disposable per-account Package Cache entries.'
            '    $registeredApplication = $installedApps[0]'
            '    $registeredUninstallProperty = if (-not [string]::IsNullOrWhiteSpace($registeredApplication.QuietUninstallStringFilePath)) {'
            '        ''QuietUninstallString'''
            '    } elseif (-not [string]::IsNullOrWhiteSpace($registeredApplication.UninstallStringFilePath)) {'
            '        ''UninstallString'''
            '    } else {'
            '        throw "The captured Burn bundle does not provide an uninstall command."'
            '    }'
            '    [string[]]$registeredUninstallArguments = @($registeredApplication."$($registeredUninstallProperty)ArgumentList" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })'
            '    # Registered Burn commands are not consistently complete. Always normalize the standard'
            '    # unattended removal contract so a vendor helper cannot prompt or restart an Intune device.'
            '    foreach ($requiredBurnArgument in @(''/uninstall'', ''/quiet'', ''/norestart'')) {'
            '        $normalizedRequiredBurnArgument = $requiredBurnArgument -replace ''^[/-]+'', '''''
            '        if (@($registeredUninstallArguments | Where-Object {'
            '            (([string]$_) -replace ''^[/-]+'', '''') -ieq $normalizedRequiredBurnArgument'
            '        }).Count -eq 0) {'
            '            $registeredUninstallArguments += $requiredBurnArgument'
            '        }'
            '    }'
            "    `$reviewedUninstallArguments = @($reviewedUninstallArgumentsLiteral)"
            '    foreach ($reviewedArgument in $reviewedUninstallArguments) {'
            '        if (@($registeredUninstallArguments | Where-Object { [string]$_ -ieq $reviewedArgument }).Count -eq 0) {'
            '            $registeredUninstallArguments += $reviewedArgument'
            '        }'
            '    }'
            "    `$bundledUninstaller = Join-Path `$adtSession.DirFiles '$installerFileNameSingleQuoteEscaped'"
            '    if (-not (Test-Path -LiteralPath $bundledUninstaller -PathType Leaf)) {'
            '        throw "The packaged Burn uninstaller was not found: $bundledUninstaller"'
            '    }'
            '    $registeredUninstallFile = [string]$registeredApplication."$($registeredUninstallProperty)FilePath"'
            '    if (-not [string]::IsNullOrWhiteSpace($registeredUninstallFile) -and (Test-Path -LiteralPath $registeredUninstallFile -PathType Leaf)) {'
            '        $burnUninstaller = $registeredUninstallFile'
            '        $burnUninstallWorkingDirectory = Split-Path -Parent $registeredUninstallFile'
            '        if ([string]::IsNullOrWhiteSpace($burnUninstallWorkingDirectory) -or -not (Test-Path -LiteralPath $burnUninstallWorkingDirectory -PathType Container)) {'
            '            $burnUninstallWorkingDirectory = $adtSession.DirFiles'
            '        }'
            '        Write-ADTLogEntry -Message "Using the exact registered Burn uninstaller [$registeredUninstallFile]." -Source ''Uninstall-ADTDeployment'''
            '    } else {'
            '        $burnUninstaller = $bundledUninstaller'
            '        $burnUninstallWorkingDirectory = $adtSession.DirFiles'
            '        Write-ADTLogEntry -Message "The registered Burn uninstaller is unavailable; using the hash-verified packaged bundle." -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '    }'
            '    $registeredUninstallRegistryKey = [string]$registeredApplication.PSChildName'
            "    `$uninstallDeadline = [DateTime]::UtcNow.AddMinutes($uninstallCompletionTimeoutMinutes)"
            '    $uninstallHandle = Start-ADTProcess -FilePath $burnUninstaller -ArgumentList $registeredUninstallArguments -WorkingDirectory $burnUninstallWorkingDirectory -WindowStyle Hidden -WaitForMsiExec -NoWait -PassThru'
            '    $uninstallProcessExitLogged = $false'
            '    $nextUninstallProgressLog = [DateTime]::UtcNow'
            '    do {'
            '        $remainingApplications = @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $registeredUninstallRegistryKey })'
            '        if ($remainingApplications.Count -eq 0) { break }'
            '        $uninstallProcessExited = $false'
            '        try { $uninstallProcessExited = $uninstallHandle.Task.IsCompleted } catch { }'
            '        if ($uninstallProcessExited -and -not $uninstallProcessExitLogged) {'
            '            $uninstallProcessExitLogged = $true'
            '            Write-ADTLogEntry -Message "The Burn uninstall parent process exited; continuing to wait for exact registration [$registeredUninstallRegistryKey] because a child process may still be working." -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '        }'
            '        if ([DateTime]::UtcNow -ge $uninstallDeadline) { break }'
            '        if ([DateTime]::UtcNow -ge $nextUninstallProgressLog) {'
            '            Write-ADTLogEntry -Message "Waiting for Burn uninstall registration [$registeredUninstallRegistryKey] to be removed." -Source ''Uninstall-ADTDeployment'''
            '            $nextUninstallProgressLog = [DateTime]::UtcNow.AddSeconds(15)'
            '        }'
            '        Start-Sleep -Seconds 5'
            '    } while ($true)'
            '    $uninstallProcessExitCode = $null'
            '    try {'
            '        if ($uninstallHandle.Task.IsCompleted) {'
            '            $uninstallProcessExitCode = $uninstallHandle.Task.GetAwaiter().GetResult().ExitCode'
            '        }'
            '    } catch {'
            '        Write-ADTLogEntry -Message "The Burn uninstall task completed without a readable exit code: $_" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '    }'
            '    if ($uninstallProcessExitCode -in @(1641, 3010)) {'
            '        $script:UninstallRebootExitCode = 3010'
            '        Write-ADTLogEntry -Message "The Burn uninstaller requested a reboot with exit code [$uninstallProcessExitCode]." -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '    } elseif ($null -ne $uninstallProcessExitCode -and $uninstallProcessExitCode -notin @(0, 1605, 1614)) {'
            '        Write-ADTLogEntry -Message "The Burn uninstall parent process exited with code [$uninstallProcessExitCode]; exact removal verification remains authoritative." -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '    }'
            '    $remainingApplications = @()'
            '    foreach ($verificationAttempt in 1..5) {'
            '        $remainingApplications = @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $registeredUninstallRegistryKey })'
            '        if ($remainingApplications.Count -eq 0) { break }'
            '        if ($verificationAttempt -lt 5) { Start-Sleep -Seconds 2 }'
            '    }'
            '    if ($remainingApplications.Count -gt 0) {'
            '        throw "The Burn uninstall command did not remove registration [$registeredUninstallRegistryKey] before the completion deadline."'
            '    }'
        )
    } else {
        $lines += @(
            '    $registeredApplication = $installedApps[0]'
            "    `$registeredInstallerType = '$registeredInstallerTypeLower'"
            '    $registeredUninstallRegistryKey = [string]$registeredApplication.PSChildName'
            '    $capturedMsiProductCode = if ($registeredApplication.WindowsInstaller -and $registeredApplication.ProductCode) {'
            '        $registeredApplication.ProductCode'
            '    } elseif ($registeredApplication.WindowsInstaller -and [string]$registeredApplication.PSChildName -match ''^\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}$'') {'
            '        [string]$registeredApplication.PSChildName'
            '    } else {'
            '        $null'
            '    }'
            '    if ($capturedMsiProductCode) {'
            '        # An exact MSI identity is sufficient for Start-ADTMsiProcess. Do not inspect the'
            '        # registered EXE command: Windows Installer entries can legitimately expose an empty'
            '        # parsed UninstallStringFilePath even though their ProductCode is authoritative.'
            '        Write-ADTLogEntry -Message "Executing MSI uninstall with captured product code [$capturedMsiProductCode]." -Source ''Uninstall-ADTDeployment'''
            $reviewedUninstallProcessGuardMsiLines
            '    } else {'
            '    [string[]]$additionalUninstallArguments = @()'
            '    $isVivaldiUninstall = $false'
            '    $isInstall4jUninstall = $false'
            '    $hasQuietUninstall = -not [string]::IsNullOrWhiteSpace($registeredApplication.QuietUninstallStringFilePath)'
            '    $registeredUninstallProperty = if ($hasQuietUninstall) { ''QuietUninstallString'' } else { ''UninstallString'' }'
            '    $registeredUninstallFile = [string]$registeredApplication."$($registeredUninstallProperty)FilePath"'
            '    $isAdobeCreativeCloudUninstall = (Split-Path -Leaf $registeredUninstallFile) -ieq ''Creative Cloud Uninstaller.exe'''
            '    [string[]]$registeredUninstallArguments = @($registeredApplication."$($registeredUninstallProperty)ArgumentList" | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })'
            $reviewedExactUninstallOverrideLines
            '    $registeredArgumentText = ($registeredUninstallArguments -join '' '').Trim()'
            '    if (-not $hasQuietUninstall) {'
            ''
            '        # PSADT correctly prefers QuietUninstallString. Some vendors only publish an interactive'
            '        # UninstallString, so add narrowly verified unattended arguments for known signatures.'
            '        $registeredUninstallLeaf = Split-Path -Leaf $registeredUninstallFile'
            '        $registeredUninstallParentLeaf = Split-Path -Leaf (Split-Path -Parent $registeredUninstallFile)'
            "        `$installerUsesInstall4j = '$silentSwitchesEscaped' -match '(?i)(^|\s)-Dinstall4j\.'"
            '        $isInstall4jUninstall = ('
            '            $registeredUninstallLeaf -in @(''uninstaller.exe'', ''uninstall.exe'') -and'
            '            ($registeredUninstallParentLeaf -ieq ''.install4j'' -or $installerUsesInstall4j)'
            '        )'
            '        if ($isInstall4jUninstall) {'
            '            # install4j uses -q for unattended installers and uninstallers. Require a canonical'
            '            # uninstall executable plus either its .install4j parent or a manifest install4j'
            '            # property, so this does not broaden silent arguments to arbitrary vendor executables.'
            '            foreach ($argument in @(''-q'', ''-Dinstall4j.suppressUnattendedReboot=true'')) {'
            '                if ($registeredArgumentText -notmatch "(?i)(^|\s)$([regex]::Escape($argument))(\s|$)") {'
            '                    $additionalUninstallArguments += $argument'
            '                }'
            '            }'
            '        } elseif ($registeredUninstallLeaf -ieq ''setup.exe'' -and'
            '            $registeredArgumentText -match ''(?i)(^|\s)--vivaldi(\s|$)'') {'
            '            $isVivaldiUninstall = $true'
            '        } elseif ((Split-Path -Leaf $registeredUninstallFile) -ine ''msiexec.exe'' -and'
            '                  $registeredInstallerType -eq ''nullsoft'' -and'
            '                  $registeredArgumentText -notmatch ''(?i)(^|\s)/S(\s|$)'') {'
            '            $additionalUninstallArguments += ''/S'''
            '        }'
            ''
            '        # For an explicit vendor uninstall command, only reuse manifest switches that are'
            '        # independently safe for removal. Never forward install-only values such as Adobe''s'
            '        # --mode=stub to an uninstaller.'
            '        if ((Split-Path -Leaf $registeredUninstallFile) -ine ''msiexec.exe'' -and'
            '            $registeredArgumentText -match ''(?i)(^|\s)(/uninstall|-uninstall|--uninstall|/x)(\s|$|\{)'') {'
            "            `$safeManifestUninstallArguments = @('$silentSwitchesEscaped' -split '\s+' | Where-Object { `$_ -match '^(?i:/q[nbrfu]?|/quiet|/silent|/verysilent|/norestart|/s|--quiet|--silent)$' })"
            '            foreach ($argument in $safeManifestUninstallArguments) {'
            '                if ($registeredArgumentText -notmatch "(?i)(^|\s)$([regex]::Escape($argument))(\s|$)") {'
            '                    $additionalUninstallArguments += $argument'
            '                }'
            '            }'
            '        }'
            '    }'
            '    if (-not $useReviewedExactUninstall -and -not $isVivaldiUninstall -and (Split-Path -Leaf $registeredUninstallFile) -ine ''msiexec.exe'' -and $registeredInstallerType -eq ''inno'') {'
            '        # Inno''s registered QuietUninstallString is not consistently fully unattended.'
            '        # Normalize weak /SILENT registrations to the vendor-documented, message-box-free'
            '        # switches so SYSTEM deployments cannot wait behind an invisible prompt.'
            '        $registeredUninstallArguments = @($registeredUninstallArguments | Where-Object { [string]$_ -notmatch ''^(?i:/SILENT)$'' })'
            '        $registeredArgumentText = ($registeredUninstallArguments -join '' '').Trim()'
            '        foreach ($argument in @(''/VERYSILENT'', ''/SUPPRESSMSGBOXES'', ''/NORESTART'', ''/SP-'')) {'
            '            if ($registeredArgumentText -notmatch "(?i)(^|\s)$([regex]::Escape($argument))(\s|$)") {'
            '                $additionalUninstallArguments += $argument'
            '            }'
            '        }'
            '    }'
            ''
            '        # Vendor uninstallers can keep their bootstrapper open after removal or return before a'
            '        # child finishes. Launch the exact quiet/fallback command asynchronously and use the'
            '        # captured registry identity as the authoritative completion signal for every EXE path.'
            '        if ($isVivaldiUninstall) {'
            '            # Preserve the vendor-documented Vivaldi command while using the same registry-aware'
            '            # completion logic as every other executable uninstaller.'
            '            $registeredUninstallFile = [string]$registeredApplication.UninstallStringFilePath'
            '            $registeredUninstallArguments = @(''--uninstall'', ''--vivaldi'', ''--force-uninstall'')'
            '            Write-ADTLogEntry -Message "Executing the vendor-documented Vivaldi silent uninstall command." -Source ''Uninstall-ADTDeployment'''
            '        } elseif ($isAdobeCreativeCloudUninstall) {'
            '            # Adobe''s desktop client registers an interactive uninstaller. Use its unattended'
            '            # desktop-client command and never forward the install-only --mode=stub value.'
            '            $registeredUninstallArguments = @(''-u'', ''--silent'')'
            '            Write-ADTLogEntry -Message "Executing the Adobe Creative Cloud desktop client silent uninstall command." -Source ''Uninstall-ADTDeployment'''
            '        }'
            "        `$reviewedUninstallArguments = @($reviewedUninstallArgumentsLiteral)"
            '        if (-not $useReviewedExactUninstall) {'
            '            foreach ($reviewedArgument in $reviewedUninstallArguments) {'
            '                if (@($registeredUninstallArguments | Where-Object { [string]$_ -ieq $reviewedArgument }).Count -eq 0) {'
            '                    $registeredUninstallArguments += $reviewedArgument'
            '                }'
            '            }'
            '        }'
            '        $registeredUninstallLeaf = Split-Path -Leaf $registeredUninstallFile'
            '        $isRegisteredMsiExec = $registeredUninstallLeaf -in @(''msiexec'', ''msiexec.exe'')'
            '        if ($isRegisteredMsiExec) {'
            '            $registeredMsiProductCode = if ($registeredUninstallRegistryKey -match ''(?i)^\{[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\}$'') {'
            '                $registeredUninstallRegistryKey'
            '            } elseif (($registeredUninstallArguments -join '' '') -match ''(?i)(?:^|\s)[/-](?:x|i)\s*(\{[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}\})(?=\s|$)'') {'
            '                $Matches[1]'
            '            } else {'
            '                throw "The registered msiexec uninstall command does not expose an exact product code; refusing to reuse install or repair arguments."'
            '            }'
            '            $registeredUninstallFile = Join-Path $env:SystemRoot ''System32\msiexec.exe'''
            '            $registeredUninstallArguments = @(''/x'', $registeredMsiProductCode, ''/qn'', ''/norestart'')'
            '        } else {'
            '            if (-not (Test-Path -LiteralPath $registeredUninstallFile -PathType Leaf)) {'
            '                throw "The registered vendor uninstaller was not found: $registeredUninstallFile"'
            '            }'
            '            if (-not $isVivaldiUninstall -and -not $isAdobeCreativeCloudUninstall) {'
            '                $registeredUninstallArguments += $additionalUninstallArguments'
            '            }'
            '        }'
            '        if (-not $hasQuietUninstall -and -not $isVivaldiUninstall -and -not $isAdobeCreativeCloudUninstall -and $additionalUninstallArguments.Count -gt 0) {'
            '            Write-ADTLogEntry -Message "The vendor registered no quiet uninstall; applying verified unattended arguments [$($additionalUninstallArguments -join '' '')]." -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '        }'
            '        $registeredUninstallWorkingDirectory = Split-Path -Parent $registeredUninstallFile'
            '        $uninstallProcessParameters = @{'
            '            FilePath = $registeredUninstallFile'
            '            WorkingDirectory = $registeredUninstallWorkingDirectory'
            '            WindowStyle = ''Hidden'''
            '            NoWait = $true'
            '            PassThru = $true'
            '        }'
            '        if ($registeredUninstallArguments.Count -gt 0) {'
            '            $uninstallProcessParameters.ArgumentList = $registeredUninstallArguments'
            '        }'
            "        `$effectiveUninstallCompletionTimeoutMinutes = if (`$useReviewedExactUninstall) { $reviewedExactUninstallTimeoutMinutes } else { $uninstallCompletionTimeoutMinutes }"
            '        $uninstallDeadline = [DateTime]::UtcNow.AddMinutes($effectiveUninstallCompletionTimeoutMinutes)'
            '        $uninstallHandle = Start-ADTProcess @uninstallProcessParameters'
            '        $uninstallProcessExitLogged = $false'
            '        $nextUninstallProgressLog = [DateTime]::UtcNow'
            '        do {'
            '            $remainingApplications = @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $registeredUninstallRegistryKey })'
            '            if ($remainingApplications.Count -eq 0) { break }'
            '            $uninstallProcessExited = $false'
            '            try { $uninstallProcessExited = $uninstallHandle.Task.IsCompleted } catch { }'
            '            if ($uninstallProcessExited -and -not $uninstallProcessExitLogged) {'
            '                $uninstallProcessExitLogged = $true'
            '                Write-ADTLogEntry -Message "The vendor uninstall parent process exited; continuing to wait for exact registration [$registeredUninstallRegistryKey] because a child process may still be working." -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '            }'
            '            if ([DateTime]::UtcNow -ge $uninstallDeadline) { break }'
            '            if ([DateTime]::UtcNow -ge $nextUninstallProgressLog) {'
            '                Write-ADTLogEntry -Message "Waiting for vendor uninstall registration [$registeredUninstallRegistryKey] to be removed." -Source ''Uninstall-ADTDeployment'''
            '                $nextUninstallProgressLog = [DateTime]::UtcNow.AddSeconds(15)'
            '            }'
            '            Start-Sleep -Seconds 5'
            '        } while ($true)'
            '        $uninstallProcessExitCode = $null'
            '        try {'
            '            if ($uninstallHandle.Task.IsCompleted) {'
            '                $uninstallProcessExitCode = $uninstallHandle.Task.GetAwaiter().GetResult().ExitCode'
            '            }'
            '        } catch {'
            '            Write-ADTLogEntry -Message "The vendor uninstall task completed without a readable exit code: $_" -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '        }'
            '        if ($uninstallProcessExitCode -in @(1641, 3010)) {'
            '            $script:UninstallRebootExitCode = 3010'
            '            Write-ADTLogEntry -Message "The vendor uninstaller requested a reboot with exit code [$uninstallProcessExitCode]." -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '        } elseif ($null -ne $uninstallProcessExitCode -and $uninstallProcessExitCode -notin @(0, 1605, 1614)) {'
            '            Write-ADTLogEntry -Message "The vendor uninstall parent process exited with code [$uninstallProcessExitCode]; exact removal verification remains authoritative." -Severity ''Warning'' -Source ''Uninstall-ADTDeployment'''
            '        }'
            '    }'
            '    $remainingApplications = @()'
            '    foreach ($verificationAttempt in 1..5) {'
            '        $remainingApplications = @(Get-ADTApplication -FilterScript { $_.PSChildName -eq $registeredUninstallRegistryKey })'
            '        if ($remainingApplications.Count -eq 0) { break }'
            '        if ($verificationAttempt -lt 5) { Start-Sleep -Seconds 2 }'
            '    }'
            '    if ($remainingApplications.Count -gt 0) {'
            '        throw "The vendor uninstall command did not remove registration [$registeredUninstallRegistryKey] before the completion deadline."'
            '    }'
        )
    }
} elseif ($useMsixUninstall) {
    if ($IsUserScope) {
        $lines += @(
            ''
            '    # Remove the MSIX/APPX registration for the current user only.'
            "    `$packageName = '$msixPackageName'"
            '    Write-ADTLogEntry -Message "Removing user-scoped MSIX package: $packageName" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
            '    try {'
            '        $packages = Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue'
            '        foreach ($pkg in @($packages)) {'
            '            Write-ADTLogEntry -Message "Removing current-user package: $($pkg.PackageFullName)" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
            '            Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop'
            '        }'
            '        Write-ADTLogEntry -Message "User-scoped MSIX package removal completed" -Severity ''Success'' -Source ''Uninstall-ADTDeployment'''
            '    } catch {'
            '        Write-ADTLogEntry -Message "Failed to remove user-scoped MSIX package: $_" -Severity ''Error'' -Source ''Uninstall-ADTDeployment'''
            '        throw'
            '    }'
        )
    } else {
        $lines += @(
            ''
            '    # Remove the machine provision and all registered package instances.'
            "    `$packageName = '$msixPackageName'"
            '    Write-ADTLogEntry -Message "Removing machine-scoped MSIX package: $packageName" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
            '    try {'
            '        $provPackages = Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -eq $packageName }'
            '        foreach ($provPackage in @($provPackages)) {'
            '            Write-ADTLogEntry -Message "Removing provisioned package: $($provPackage.DisplayName)" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
            '            Remove-AppxProvisionedPackage -Online -PackageName $provPackage.PackageName -ErrorAction Stop | Out-Null'
            '        }'
            '        $packages = Get-AppxPackage -Name $packageName -AllUsers -ErrorAction SilentlyContinue'
            '        foreach ($pkg in @($packages)) {'
            '            Write-ADTLogEntry -Message "Removing installed package: $($pkg.PackageFullName)" -Severity ''Info'' -Source ''Uninstall-ADTDeployment'''
            '            Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers -ErrorAction Stop'
            '        }'
            '        Write-ADTLogEntry -Message "Machine-scoped MSIX package removal completed" -Severity ''Success'' -Source ''Uninstall-ADTDeployment'''
            '    } catch {'
            '        Write-ADTLogEntry -Message "Failed to remove machine-scoped MSIX package: $_" -Severity ''Error'' -Source ''Uninstall-ADTDeployment'''
            '        throw'
            '    }'
        )
    }
} elseif ($usePortableUninstall) {
    $lines += @(
        ''
        '    # Remove portable app folder'
        $portableInstallPathLine
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
        "    `$uninstallCmd = '$uninstallCmdSingleQuoteEscaped'"
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
    '$script:UninstallRebootExitCode = $null'
    '$script:DependencyRebootExitCode = $null'
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
    '    $initializationError = Out-String -InputObject $_ -Width ([System.Int32]::MaxValue)'
    "    `$bootstrapLogRoot = `"$(if ($IsUserScope) { '$env:LOCALAPPDATA\IntuneGet\Logs' } else { '$env:WINDIR\Logs\Software' })`""
    '    try'
    '    {'
    '        $null = New-Item -Path $bootstrapLogRoot -ItemType Directory -Force -ErrorAction Stop'
    '        Set-Content -LiteralPath (Join-Path $bootstrapLogRoot ''IntuneGet-PSADT-Bootstrap.log'') -Value $initializationError -Encoding UTF8 -Force -ErrorAction Stop'
    '    }'
    '    catch { }'
    '    $Host.UI.WriteErrorLine($initializationError)'
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
    '    if ($script:UninstallRebootExitCode -or $script:DependencyRebootExitCode) {'
    '        Close-ADTSession -ExitCode 3010'
    '    } else {'
    '        Close-ADTSession'
    '    }'
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
