<#
.SYNOPSIS
    Exports SCCM/ConfigMgr applications to JSON format for IntuneGet import.

.DESCRIPTION
    This script connects to your Configuration Manager site and exports all applications
    with their deployment types, detection methods, and settings. The output can be
    imported into IntuneGet to facilitate migration from SCCM to Microsoft Intune.

.PARAMETER SiteCode
    The SCCM site code. If not specified, the script will attempt to auto-detect it.

.PARAMETER OutputPath
    The path where the export file will be saved. Defaults to SCCMApps-Export.json
    in the current directory.

.PARAMETER IncludeSuperseded
    Include applications that have been superseded. By default, superseded apps are excluded.

.PARAMETER IncludeRetired
    Include applications that have been retired. By default, retired apps are excluded.

.EXAMPLE
    .\Export-SCCMApps.ps1
    Exports all applications using auto-detected site code.

.EXAMPLE
    .\Export-SCCMApps.ps1 -SiteCode "PS1" -OutputPath "C:\Exports\apps.json"
    Exports applications from site PS1 to the specified path.

.EXAMPLE
    .\Export-SCCMApps.ps1 -IncludeSuperseded -IncludeRetired
    Exports all applications including superseded and retired ones.

.NOTES
    Version: 1.0.0
    Requires: ConfigurationManager PowerShell module
    Run this script on a machine with the Configuration Manager console installed.

.LINK
    https://intuneget.com/docs/sccm-migration
#>

#Requires -Modules ConfigurationManager

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$SiteCode,

    [Parameter(Mandatory = $false)]
    [string]$OutputPath = ".\SCCMApps-Export.json",

    [Parameter(Mandatory = $false)]
    [switch]$IncludeSuperseded,

    [Parameter(Mandatory = $false)]
    [switch]$IncludeRetired
)

$ErrorActionPreference = "Stop"

function Write-ProgressMessage {
    param([string]$Message, [string]$Status = "Info")

    $color = switch ($Status) {
        "Info"    { "Cyan" }
        "Success" { "Green" }
        "Warning" { "Yellow" }
        "Error"   { "Red" }
        default   { "White" }
    }

    Write-Host "[$Status] " -ForegroundColor $color -NoNewline
    Write-Host $Message
}

function Get-DetectionClauses {
    param([object]$DeploymentType)

    $clauses = @()

    try {
        $sdmContent = $DeploymentType.SDMPackageXML
        if (-not $sdmContent) {
            return $clauses
        }

        [xml]$sdmXml = $sdmContent

        # Get the detection methods from the XML
        $enhancedDetection = $sdmXml.AppMgmtDigest.DeploymentType.Installer.DetectAction.Provider

        if ($enhancedDetection) {
            foreach ($setting in $sdmXml.AppMgmtDigest.DeploymentType.Installer.DetectAction.Args.Arg) {
                $settingRef = $setting.SettingLogicalName

                # Find the corresponding setting definition
                $settingDef = $sdmXml.SelectNodes("//*[local-name()='Setting']") |
                    Where-Object { $_.LogicalName -eq $settingRef }

                if ($settingDef) {
                    $sourceType = $settingDef.SettingSourceType

                    switch ($sourceType) {
                        "MSI" {
                            $clause = @{
                                type = "MSI"
                                productCode = $settingDef.ProductCode
                            }
                            $clauses += $clause
                        }
                        "File" {
                            $clause = @{
                                type = "File"
                                path = $settingDef.Path
                                fileName = $settingDef.FileName
                                is64Bit = [bool]$settingDef.Is64Bit
                            }

                            # Check for version detection
                            $expression = $setting.Expression
                            if ($expression -and $expression.Contains("Version")) {
                                $clause.propertyType = "Version"
                                $clause.expressionOperator = "GreaterEquals"
                                # Extract version from expression if possible
                                if ($expression -match 'Version.*"([^"]+)"') {
                                    $clause.expectedValue = $matches[1]
                                }
                            } else {
                                $clause.expressionOperator = "Exists"
                            }

                            $clauses += $clause
                        }
                        "Registry" {
                            $clause = @{
                                type = "Registry"
                                hive = $settingDef.Hive
                                keyPath = $settingDef.Key
                                valueName = $settingDef.ValueName
                                is64Bit = [bool]$settingDef.Is64Bit
                            }

                            # Check detection type
                            $expression = $setting.Expression
                            if ($expression -and $expression.Contains("Value")) {
                                $clause.propertyType = "Value"
                                if ($expression -match '"([^"]+)"') {
                                    $clause.expectedValue = $matches[1]
                                }
                            } else {
                                $clause.propertyType = "Exists"
                            }

                            $clauses += $clause
                        }
                    }
                }
            }
        }

        # Check for script-based detection
        $scriptDetection = $sdmXml.SelectNodes("//*[local-name()='ScriptBody']")
        if ($scriptDetection -and $scriptDetection.Count -gt 0) {
            foreach ($script in $scriptDetection) {
                $scriptType = $script.ParentNode.ScriptType
                $clause = @{
                    type = "Script"
                    scriptLanguage = if ($scriptType) { $scriptType } else { "PowerShell" }
                    scriptContent = $script.InnerText
                }
                $clauses += $clause
            }
        }
    }
    catch {
        Write-ProgressMessage "Warning: Could not parse detection methods for deployment type. $_" -Status "Warning"
    }

    return $clauses
}

function Get-DeploymentTypeDetails {
    param([object]$DeploymentType)

    $details = @{
        name = $DeploymentType.LocalizedDisplayName
        technology = $DeploymentType.Technology
        installCommand = $null
        uninstallCommand = $null
        installBehavior = $null
        logonRequirement = $null
        requireUserInteraction = $false
        maxExecuteTime = $null
        estimatedExecuteTime = $null
        rebootBehavior = $null
        detectionClauses = @()
        requirementsRules = @()
    }

    try {
        $sdmContent = $DeploymentType.SDMPackageXML
        if ($sdmContent) {
            [xml]$sdmXml = $sdmContent

            $installer = $sdmXml.AppMgmtDigest.DeploymentType.Installer
            if ($installer) {
                # Install command
                $installAction = $installer.InstallAction.Args.Arg |
                    Where-Object { $_.Name -eq "InstallCommandLine" }
                if ($installAction) {
                    $details.installCommand = $installAction.'#text'
                }

                # Uninstall command
                $uninstallAction = $installer.UninstallAction.Args.Arg |
                    Where-Object { $_.Name -eq "UninstallCommandLine" }
                if ($uninstallAction) {
                    $details.uninstallCommand = $uninstallAction.'#text'
                }

                # Execution context. Do not name this $executionContext: that
                # collides with PowerShell's read-only automatic $ExecutionContext
                # variable and throws "Cannot overwrite variable ExecutionContext
                # because it is read-only or constant", which aborts deployment
                # type parsing and leaves installBehavior and friends null.
                $execContextArg = $installer.InstallAction.Args.Arg |
                    Where-Object { $_.Name -eq "ExecutionContext" }
                if ($execContextArg) {
                    $details.installBehavior = switch ($execContextArg.'#text') {
                        "System" { "InstallForSystem" }
                        "User" { "InstallForUser" }
                        "Any" { "InstallForSystemIfResourceIsDeviceOtherwiseInstallForUser" }
                        default { $execContextArg.'#text' }
                    }
                }

                # User interaction
                $requiresUI = $installer.InstallAction.Args.Arg |
                    Where-Object { $_.Name -eq "RequiresUserInteraction" }
                if ($requiresUI) {
                    $details.requireUserInteraction = $requiresUI.'#text' -eq "true"
                }

                # Execution time
                $maxExecTime = $installer.InstallAction.Args.Arg |
                    Where-Object { $_.Name -eq "MaxExecuteTime" }
                if ($maxExecTime) {
                    $details.maxExecuteTime = [int]$maxExecTime.'#text'
                }

                # Estimated install time
                $estimatedTime = $installer.InstallAction.Args.Arg |
                    Where-Object { $_.Name -eq "EstimatedInstallTime" }
                if ($estimatedTime) {
                    $details.estimatedExecuteTime = [int]$estimatedTime.'#text'
                }

                # Reboot behavior
                $reboot = $installer.InstallAction.Args.Arg |
                    Where-Object { $_.Name -eq "PostInstallBehavior" }
                if ($reboot) {
                    $details.rebootBehavior = $reboot.'#text'
                }

                # Logon requirement
                $logon = $installer.InstallAction.Args.Arg |
                    Where-Object { $_.Name -eq "LogonReqType" }
                if ($logon) {
                    $details.logonRequirement = $logon.'#text'
                }
            }

            # Get requirements (OS, memory, disk, etc.)
            $requirements = $sdmXml.SelectNodes("//*[local-name()='Rule'][@NonCompliantMessage]")
            foreach ($req in $requirements) {
                $reqDetails = @{
                    type = $req.Severity
                    description = $req.NonCompliantMessage
                }
                $details.requirementsRules += $reqDetails
            }
        }
    }
    catch {
        Write-ProgressMessage "Warning: Could not parse deployment type details. $_" -Status "Warning"
    }

    # Get detection clauses
    $details.detectionClauses = Get-DetectionClauses -DeploymentType $DeploymentType

    return $details
}

# Main script execution
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  SCCM Application Export for IntuneGet" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Connect to SCCM
Write-ProgressMessage "Connecting to Configuration Manager..."

if (-not $SiteCode) {
    try {
        $SiteCode = (Get-PSDrive -PSProvider CMSite -ErrorAction Stop).Name | Select-Object -First 1
        Write-ProgressMessage "Auto-detected site code: $SiteCode" -Status "Success"
    }
    catch {
        Write-ProgressMessage "Could not auto-detect site code. Please specify using -SiteCode parameter." -Status "Error"
        exit 1
    }
}

# Save current location and switch to CM drive
$originalLocation = Get-Location
try {
    Set-Location "$($SiteCode):\" -ErrorAction Stop
}
catch {
    Write-ProgressMessage "Failed to connect to site $SiteCode. Ensure the ConfigurationManager module is loaded." -Status "Error"
    exit 1
}

Write-ProgressMessage "Connected to site $SiteCode" -Status "Success"

# Get applications
Write-ProgressMessage "Retrieving applications..."

try {
    $allApps = Get-CMApplication -Fast
    Write-ProgressMessage "Found $($allApps.Count) total applications" -Status "Info"
}
catch {
    Write-ProgressMessage "Failed to retrieve applications: $_" -Status "Error"
    Set-Location $originalLocation
    exit 1
}

# Filter applications based on parameters
$apps = $allApps | Where-Object {
    $include = $true

    if (-not $IncludeSuperseded -and $_.IsSuperseded) {
        $include = $false
    }

    if (-not $IncludeRetired -and $_.IsExpired) {
        $include = $false
    }

    $include
}

$filteredCount = $allApps.Count - $apps.Count
if ($filteredCount -gt 0) {
    Write-ProgressMessage "Filtered out $filteredCount applications (superseded/retired)" -Status "Info"
}

Write-ProgressMessage "Processing $($apps.Count) applications..." -Status "Info"

# Process applications
$exportedApps = @()
$processed = 0
$errors = 0

foreach ($app in $apps) {
    $processed++
    $percentComplete = [math]::Round(($processed / $apps.Count) * 100)

    Write-Progress -Activity "Exporting Applications" -Status "$processed of $($apps.Count): $($app.LocalizedDisplayName)" -PercentComplete $percentComplete

    try {
        # Get full application object for deployment types
        $fullApp = Get-CMApplication -Id $app.CI_ID

        # Get admin categories
        $categories = @()
        if ($fullApp.LocalizedCategoryInstanceNames) {
            $categories = @($fullApp.LocalizedCategoryInstanceNames)
        }

        # Get deployment types.
        # Get-CMDeploymentType has no -ApplicationId parameter; pass the
        # application object via -InputObject (alias Application) instead.
        $deploymentTypes = @()
        $dtList = Get-CMDeploymentType -InputObject $fullApp

        foreach ($dt in $dtList) {
            $dtDetails = Get-DeploymentTypeDetails -DeploymentType $dt
            $deploymentTypes += $dtDetails
        }

        # Get deployment count
        $deploymentCount = 0
        try {
            # Get-CMApplicationDeployment has no -ApplicationId parameter; pass
            # the application object via -InputObject (alias Application).
            $deployments = Get-CMApplicationDeployment -InputObject $fullApp -ErrorAction SilentlyContinue
            if ($deployments) {
                $deploymentCount = @($deployments).Count
            }
        }
        catch {
            # Ignore deployment count errors
        }

        # Build application export object (using camelCase to match TypeScript interface)
        $appExport = @{
            ci_id = $app.CI_ID.ToString()
            localizedDisplayName = $app.LocalizedDisplayName
            manufacturer = $app.Manufacturer
            softwareVersion = $app.SoftwareVersion
            isDeployed = $app.IsDeployed
            isSuperseded = $app.IsSuperseded
            isExpired = $app.IsExpired
            dateCreated = if ($app.DateCreated) { $app.DateCreated.ToString("yyyy-MM-ddTHH:mm:ssZ") } else { $null }
            dateLastModified = if ($app.DateLastModified) { $app.DateLastModified.ToString("yyyy-MM-ddTHH:mm:ssZ") } else { $null }
            deploymentCount = $deploymentCount
            adminCategories = $categories
            localizedDescription = $app.LocalizedDescription
            deploymentTypes = $deploymentTypes
        }

        $exportedApps += $appExport
    }
    catch {
        $errors++
        Write-ProgressMessage "Error processing '$($app.LocalizedDisplayName)': $_" -Status "Warning"
    }
}

Write-Progress -Activity "Exporting Applications" -Completed

# Return to original location
Set-Location $originalLocation

# Create export object (using camelCase to match TypeScript interface)
$export = @{
    version = "1.0"
    exportDate = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    source = "powershell"
    siteCode = $SiteCode
    exportOptions = @{
        includeSuperseded = $IncludeSuperseded.IsPresent
        includeRetired = $IncludeRetired.IsPresent
    }
    statistics = @{
        totalApplications = $apps.Count
        exportedApplications = $exportedApps.Count
        errors = $errors
    }
    applications = $exportedApps
}

# Export to JSON
try {
    $jsonOutput = $export | ConvertTo-Json -Depth 15 -Compress:$false
    $jsonOutput | Out-File -FilePath $OutputPath -Encoding UTF8 -Force

    $fileInfo = Get-Item $OutputPath
    $fileSizeMB = [math]::Round($fileInfo.Length / 1MB, 2)

    Write-Host ""
    Write-ProgressMessage "Export completed successfully!" -Status "Success"
    Write-Host ""
    Write-Host "  File: $($fileInfo.FullName)" -ForegroundColor White
    Write-Host "  Size: $fileSizeMB MB" -ForegroundColor White
    Write-Host "  Applications: $($exportedApps.Count)" -ForegroundColor White
    if ($errors -gt 0) {
        Write-Host "  Errors: $errors" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Upload this file to IntuneGet at /dashboard/sccm/new" -ForegroundColor White
    Write-Host "  2. Review matched applications and configure settings" -ForegroundColor White
    Write-Host "  3. Migrate to Intune" -ForegroundColor White
    Write-Host ""
}
catch {
    Write-ProgressMessage "Failed to write export file: $_" -Status "Error"
    exit 1
}
