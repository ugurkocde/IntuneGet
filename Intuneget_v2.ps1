<#
.SYNOPSIS
    This script uploads Windows applications from Winget to Microsoft Intune by generating PowerShell scripts.
.DESCRIPTION
    This script automates the process of deploying Windows applications from Winget to Microsoft Intune.
    It generates install, uninstall, and detection PowerShell scripts for a given Winget Package ID,
    packages them as a Win32 app using IntuneWinAppUtil.exe, and then uploads the package to Intune.
    It reuses authentication and core upload logic from IntuneBrew/Intuneget.
.NOTES
    Version:        0.2
    Author:         Ugur Koc
    Creation Date:  2025-05-22
.REQUIREMENTS
    - PowerShell 7.0 or later
    - Microsoft.Graph.Authentication module
    - Winget CLI installed and configured
    - IntuneWinAppUtil.exe available in same directory
    - Required Graph API Permissions:
        * DeviceManagementApps.ReadWrite.All
        * Group.Read.All
#>

# Main script logic for Winget app upload
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageId,

    [Parameter(Mandatory = $false)]
    [string]$Version, # Optional: For future use if specific version installation is desired

    [Parameter(Mandatory = $false)]
    [switch]$CopyAssignments # Placeholder for future assignment copying
)

# Disable verbose output to avoid cluttering the Azure Automation Runbook logs
$VerbosePreference = "SilentlyContinue"

# Function to write logs that will be visible in Azure Automation
function Write-Log {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [Parameter(Mandatory = $false)]
        [string]$Type = "Info"  # Info, Warning, Error, Verbose, Success
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $prefix = ""
    $color = "White"

    switch ($Type) {
        "Info" { $prefix = "[INFO]"; $color = "Cyan" }
        "Warning" { $prefix = "[WARN]"; $color = "Yellow" }
        "Error" { $prefix = "[ERROR]"; $color = "Red" }
        "Verbose" { $prefix = "[DEBUG]"; $color = "DarkGray" }
        "Success" { $prefix = "[SUCCESS]"; $color = "Green" }
        default { $prefix = "[LOG]"; $color = "White" }
    }

    $logMessage = "$prefix [$timestamp] $Message"
    
    if ($Type -eq "Verbose") {
        Write-Verbose $logMessage
    }
    else {
        Write-Host $logMessage -ForegroundColor $color
    }
}

Write-Log "Starting Intuneget_v2 - Version 0.2"

# Authentication START (Copied from Intuneget.ps1)
# Required Graph API permissions for app functionality
$requiredPermissions = @(
    "DeviceManagementApps.ReadWrite.All", # Read and write access to apps in Intune
    "Group.Read.All" # Read group names for assignment
)

# Function to validate JSON configuration file
function Test-AuthConfig {
    param (
        [string]$Path
    )
    
    if (-not (Test-Path $Path)) {
        Write-Log "Error: Configuration file not found at path: $Path" -Type "Error"
        return $false
    }
    
    try {
        # Just test if the file can be parsed as JSON without storing the result
        Get-Content $Path | ConvertFrom-Json | Out-Null
        return $true
    }
    catch {
        Write-Log "Error: Invalid JSON format in configuration file" -Type "Error"
        return $false
    }
}

# Function to authenticate using certificate
function Connect-WithCertificate {
    param (
        [string]$ConfigPath
    )
    
    $config = Get-Content $ConfigPath | ConvertFrom-Json
    
    if (-not $config.appId -or -not $config.tenantId -or -not $config.certificateThumbprint) {
        Write-Log "Error: Configuration file must contain appId, tenantId, and certificateThumbprint" -Type "Error"
        return $false
    }
    
    try {
        Connect-MgGraph -ClientId $config.appId -TenantId $config.tenantId -CertificateThumbprint $config.certificateThumbprint -NoWelcome -ErrorAction Stop
        Write-Log "Successfully connected to Microsoft Graph using certificate-based authentication." -Type "Success"
        return $true
    }
    catch {
        Write-Log "Failed to connect to Microsoft Graph using certificate. Error: $($_.Exception.Message)" -Type "Error"
        return $false
    }
}

# Function to authenticate using client secret
function Connect-WithClientSecret {
    param (
        [string]$ConfigPath
    )
    
    # Attempt to disconnect any existing session first to clear cache/context
    Disconnect-MgGraph -ErrorAction SilentlyContinue
    
    $config = Get-Content $ConfigPath | ConvertFrom-Json
    
    if (-not $config.appId -or -not $config.tenantId -or -not $config.clientSecret) {
        Write-Log "Error: Configuration file must contain appId, tenantId, and clientSecret" -Type "Error"
        return $false
    }
    
    try {
        $SecureClientSecret = ConvertTo-SecureString -String $config.clientSecret -AsPlainText -Force
        $ClientSecretCredential = New-Object -TypeName System.Management.Automation.PSCredential -ArgumentList $config.appId, $SecureClientSecret
        Connect-MgGraph -TenantId $config.tenantId -ClientSecretCredential $ClientSecretCredential -NoWelcome -ErrorAction Stop
        Write-Log "Successfully connected to Microsoft Graph using client secret authentication." -Type "Success"
        return $true
    }
    catch {
        Write-Log "Failed to connect to Microsoft Graph using client secret. Error: $($_.Exception.Message)" -Type "Error"
        return $false
    }
}

# Function to authenticate interactively
function Connect-Interactive {
    try {
        $permissionsList = $requiredPermissions -join ','
        Connect-MgGraph -Scopes $permissionsList -NoWelcome -ErrorAction Stop
        Write-Log "Successfully connected to Microsoft Graph using interactive sign-in." -Type "Success"
        return $true
    }
    catch {
        Write-Log "Failed to connect to Microsoft Graph via interactive sign-in. Error: $($_.Exception.Message)" -Type "Error"
        return $false
    }
}

# Function to show file picker dialog
function Show-FilePickerDialog {
    param (
        [string]$Title = "Select JSON Configuration File",
        [string]$Filter = "JSON files (*.json)|*.json|All files (*.*)|*.*"
    )
    
    Add-Type -AssemblyName System.Windows.Forms
    
    # Create a temporary form to own the dialog
    $form = New-Object System.Windows.Forms.Form
    $form.TopMost = $true
    $form.Opacity = 0
    
    # Show the form without activating it
    $form.Show()
    $form.Location = New-Object System.Drawing.Point(-32000, -32000)
    
    # Create and configure the dialog
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = $Title
    $dialog.Filter = $Filter
    $dialog.CheckFileExists = $true
    $dialog.Multiselect = $false
    
    # Show dialog with the form as owner
    try {
        if ($dialog.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {
            return $dialog.FileName
        }
    }
    finally {
        # Clean up the temporary form
        $form.Close()
        $form.Dispose()
    }
    return $null
}

# Display authentication options
Write-Host "`nChoose authentication method:" -ForegroundColor Cyan
Write-Host "1. App Registration with Certificate" -ForegroundColor Cyan
Write-Host "2. App Registration with Secret" -ForegroundColor Cyan
Write-Host "3. Interactive Session with Admin Account" -ForegroundColor Cyan
$authChoice = Read-Host "`nEnter your choice (1-3)"

$authenticated = $false

switch ($authChoice) {
    "1" {
        Write-Log "Please select the certificate configuration JSON file..." -Type "Info"
        $configPath = Show-FilePickerDialog -Title "Select Certificate Configuration JSON File"
        if ($configPath -and (Test-AuthConfig $configPath)) {
            $authenticated = Connect-WithCertificate $configPath
        }
    }
    "2" {
        Write-Log "Please select the client secret configuration JSON file..." -Type "Info"
        $configPath = Show-FilePickerDialog -Title "Select Client Secret Configuration JSON File"
        if ($configPath -and (Test-AuthConfig $configPath)) {
            $authenticated = Connect-WithClientSecret $configPath
        }
    }
    "3" {
        $authenticated = Connect-Interactive
    }
    default {
        Write-Log "Invalid choice. Please select 1, 2, or 3." -Type "Error"
        exit
    }
}

if (-not $authenticated) {
    Write-Log "Authentication failed. Exiting script." -Type "Error"
    exit
}

# Check and display the current permissions
$context = Get-MgContext
$currentPermissions = $context.Scopes

# Validate required permissions
$missingPermissions = $requiredPermissions | Where-Object { $_ -notin $currentPermissions }
if ($missingPermissions.Count -gt 0) {
    # Different handling based on authentication method
    if ($authChoice -eq "3") {
        # For interactive sign-in, we need to check if the user has consented to the required permissions
        Write-Log "WARNING: The following permissions are missing:" -Type "Warning"
        $missingPermissions | ForEach-Object { Write-Log "  - $_" -Type "Warning" }
        
        $continueWithoutPermissions = Read-Host "Do you want to continue anyway? Some functionality may be limited (y/n)"
        if ($continueWithoutPermissions -ne "y") {
            Write-Log "Exiting script. Please sign in with an account that has the required permissions." -Type "Warning"
            exit
        }
        Write-Log "Continuing with limited permissions. Some features may not work correctly." -Type "Warning"
    }
    else {
        # For app registrations
        Write-Log "WARNING: The following permissions are missing:" -Type "Warning"
        $missingPermissions | ForEach-Object { Write-Log "  - $_" -Type "Warning" }
        Write-Log "Please ensure these permissions are granted to the app registration for full functionality." -Type "Warning"
        exit
    }
}
else {
    Write-Log "All required permissions are present." -Type "Success"
}

# Authentication END

# Import required modules
Import-Module Microsoft.Graph.Authentication

# Encrypts app file using AES encryption for Intune upload
function EncryptFile($sourceFile) {
    function GenerateKey() {
        $aesSp = [System.Security.Cryptography.AesCryptoServiceProvider]::new()
        $aesSp.GenerateKey()
        return $aesSp.Key
    }

    $targetFile = "$sourceFile.bin"
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $aes = [System.Security.Cryptography.Aes]::Create()
    $aes.Key = GenerateKey
    $hmac = [System.Security.Cryptography.HMACSHA256]::new()
    $hmac.Key = GenerateKey
    $hashLength = $hmac.HashSize / 8

    $sourceStream = [System.IO.File]::OpenRead($sourceFile)
    $sourceSha256 = $sha256.ComputeHash($sourceStream)
    $sourceStream.Seek(0, "Begin") | Out-Null
    $targetStream = [System.IO.File]::Open($targetFile, "Create")

    $targetStream.Write((New-Object byte[] $hashLength), 0, $hashLength)
    $targetStream.Write($aes.IV, 0, $aes.IV.Length)
    $transform = $aes.CreateEncryptor()
    $cryptoStream = [System.Security.Cryptography.CryptoStream]::new($targetStream, $transform, "Write")
    $sourceStream.CopyTo($cryptoStream)
    $cryptoStream.FlushFinalBlock()

    $targetStream.Seek($hashLength, "Begin") | Out-Null
    $mac = $hmac.ComputeHash($targetStream)
    $targetStream.Seek(0, "Begin") | Out-Null
    $targetStream.Write($mac, 0, $mac.Length)

    $targetStream.Close()
    $cryptoStream.Close()
    $sourceStream.Close()

    return [PSCustomObject][ordered]@{
        encryptionKey        = [System.Convert]::ToBase64String($aes.Key)
        fileDigest           = [System.Convert]::ToBase64String($sourceSha256)
        fileDigestAlgorithm  = "SHA256"
        initializationVector = [System.Convert]::ToBase64String($aes.IV)
        mac                  = [System.Convert]::ToBase64String($mac)
        macKey               = [System.Convert]::ToBase64String($hmac.Key)
        profileIdentifier    = "ProfileVersion1"
    }
}

# Handles chunked upload of large files to Azure Storage
function UploadFileToAzureStorage($sasUri, $filepath) {
    try {
        Write-Log "Starting file upload to Azure Storage" -Type "Info"
        $fileSize = [Math]::Round((Get-Item $filepath).Length / 1MB, 2)
        Write-Log "File size: $fileSize MB" -Type "Info"
        
        $blockSize = 8 * 1024 * 1024  # 8 MB block size
        $fileSize = (Get-Item $filepath).Length
        $totalBlocks = [Math]::Ceiling($fileSize / $blockSize)
        
        $maxRetries = 3
        $retryCount = 0
        $uploadSuccess = $false
        $lastProgressReport = 0

        while (-not $uploadSuccess -and $retryCount -lt $maxRetries) {
            try {
                if ($retryCount -gt 0) {
                    Write-Log "Retry attempt $($retryCount + 1) of $maxRetries" -Type "Warning"
                }
                
                $fileStream = [System.IO.File]::OpenRead($filepath)
                $blockId = 0
                $blockList = [System.Xml.Linq.XDocument]::Parse(@"
<?xml version="1.0" encoding="utf-8"?>
<BlockList></BlockList>
"@)
                
                $blockList.Declaration.Encoding = "utf-8"
                $blockBuffer = [byte[]]::new($blockSize)
                
                while ($bytesRead = $fileStream.Read($blockBuffer, 0, $blockSize)) {
                    $blockIdBytes = [System.Text.Encoding]::UTF8.GetBytes($blockId.ToString("D6"))
                    $id = [System.Convert]::ToBase64String($blockIdBytes)
                    $blockList.Root.Add([System.Xml.Linq.XElement]::new("Latest", $id))

                    $uploadBlockSuccess = $false
                    $blockRetries = 3
                    while (-not $uploadBlockSuccess -and $blockRetries -gt 0) {
                        try {
                            $blockUri = "$sasUri&comp=block&blockid=$id"
                            Invoke-WebRequest -Method Put $blockUri `
                                -Headers @{"x-ms-blob-type" = "BlockBlob" } `
                                -Body ([byte[]]($blockBuffer[0..$($bytesRead - 1)])) `
                                -ErrorAction Stop | Out-Null

                            $uploadBlockSuccess = $true
                        }
                        catch {
                            $blockRetries--
                            if ($blockRetries -gt 0) {
                                Start-Sleep -Seconds 2
                            }
                            else {
                                Write-Log "Failed to upload block. Error: $($_.Exception.Message)" -Type "Error"
                            }
                        }
                    }

                    if (-not $uploadBlockSuccess) {
                        throw "Failed to upload block after multiple retries"
                    }

                    $percentComplete = [Math]::Round(($blockId + 1) / $totalBlocks * 100, 1)
                    # Only log progress at 10% intervals
                    if ($percentComplete - $lastProgressReport -ge 10) {
                        Write-Log "Upload progress: $percentComplete%" -Type "Info"
                        $lastProgressReport = [Math]::Floor($percentComplete / 10) * 10
                    }
                    
                    $blockId++
                }
                
                $fileStream.Close()

                Write-Log "Finalizing upload..." -Type "Info"
                Invoke-RestMethod -Method Put "$sasUri&comp=blocklist" -Body $blockList | Out-Null
                Write-Log "Upload completed successfully" -Type "Success"
                
                $uploadSuccess = $true
            }
            catch {
                $retryCount++
                Write-Log "Upload attempt failed: $($_.Exception.Message)" -Type "Error"
                if ($retryCount -lt $maxRetries) {
                    Write-Log "Retrying upload..." -Type "Warning"
                    Start-Sleep -Seconds 5
                }
                else {
                    Write-Log "Failed all upload attempts" -Type "Error"
                    throw
                }
            }
            finally {
                if ($fileStream) {
                    $fileStream.Close()
                }
            }
        }
    }
    catch {
        Write-Log "Critical error during upload: $($_.Exception.Message)" -Type "Error"
        throw
    }
}

# Function to add app logo
function Add-IntuneAppLogo {
    param (
        [string]$appId,
        [string]$packageId,
        [string]$appType,
        [string]$localLogoPath = $null
    )

    Write-Log "Adding app logo..." -Type "Info"
    
    try {
        $tempLogoPath = $null

        if ($localLogoPath -and (Test-Path $localLogoPath)) {
            # Use the provided local logo file
            $tempLogoPath = $localLogoPath
            Write-Log "Using local logo file: $localLogoPath" -Type "Info"
        }
        else {
            # Construct logo file name using PackageId
            $logoFileName = "$packageId.png"
            $logoUrl = "https://raw.githubusercontent.com/ugurkocde/IntuneGet/main/Logos/$logoFileName"
            Write-Log "Attempting to download logo from: $logoUrl" -Type "Info"
            
            # Download the logo
            $tempLogoPath = Join-Path $PWD "temp_logo.png"
            try {
                Invoke-WebRequest -Uri $logoUrl -OutFile $tempLogoPath -ErrorAction Stop
            }
            catch {
                Write-Log "Could not download logo from repository. Error: $($_.Exception.Message)" -Type "Warning"
                return
            }
        }

        if (-not $tempLogoPath -or -not (Test-Path $tempLogoPath)) {
            Write-Log "No valid logo file available" -Type "Warning"
            return
        }

        # Convert the logo to base64
        $logoContent = [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($tempLogoPath))

        # Prepare the request body
        $logoBody = @{
            "@odata.type" = "#microsoft.graph.mimeContent"
            "type"        = "image/png"
            "value"       = $logoContent
        }

        # Update the app with the logo
        $logoUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$appId"
        $updateBody = @{
            "@odata.type" = "#microsoft.graph.$appType"
            "largeIcon"   = $logoBody
        }

        Invoke-MgGraphRequest -Method PATCH -Uri $logoUri -Body ($updateBody | ConvertTo-Json -Depth 10) -ErrorAction Stop
        Write-Log "Logo added successfully" -Type "Success"

        # Cleanup
        if (Test-Path $tempLogoPath) {
            Remove-Item $tempLogoPath -Force
        }
    }
    catch {
        Write-Log "Warning: Could not add app logo. Error: $($_.Exception.Message)" -Type "Warning"
    }
}

# Function to get app metadata from WinGet
function Get-WinGetAppMetadata {
    param (
        [Parameter(Mandatory = $true)]
        [string]$PackageId
    )
    
    Write-Log "Getting metadata for package '$PackageId' from WinGet..." -Type "Info"
    
    try {
        $wingetOutput = winget show $PackageId --exact --disable-interactivity 2>&1
        $appMetadata = @{
            PackageId     = $PackageId
            Name          = $null
            Publisher     = $null
            Version       = $null
            Description   = $null
            Homepage      = $null
            License       = $null
            LicenseUrl    = $null
            InstallerType = $null
        }
        
        # Parse the output to extract metadata
        foreach ($line in $wingetOutput) {
            $line = $line.ToString().Trim()
            
            # Extract app name
            if ($line -match "^Found\s+(.*?)\s+\[$PackageId\]") {
                $appMetadata.Name = $matches[1].Trim()
                continue
            }
            
            # Extract other metadata
            if ($line -match "^Name:\s*(.*)") {
                $appMetadata.Name = $matches[1].Trim()
            }
            elseif ($line -match "^Publisher:\s*(.*)") {
                $appMetadata.Publisher = $matches[1].Trim()
            }
            elseif ($line -match "^Version:\s*(.*)") {
                $appMetadata.Version = $matches[1].Trim()
            }
            elseif ($line -match "^Description:\s*(.*)") {
                $appMetadata.Description = $matches[1].Trim()
            }
            elseif ($line -match "^Homepage:\s*(.*)") {
                $appMetadata.Homepage = $matches[1].Trim()
            }
            elseif ($line -match "^License:\s*(.*)") {
                $appMetadata.License = $matches[1].Trim()
            }
            elseif ($line -match "^License Url:\s*(.*)") {
                $appMetadata.LicenseUrl = $matches[1].Trim()
            }
            elseif ($line -match "^Installer Type:\s*(.*)") {
                $appMetadata.InstallerType = $matches[1].Trim()
            }
        }
        
        # If we couldn't find a name, use the package ID as a fallback
        if (-not $appMetadata.Name) {
            $appMetadata.Name = $PackageId.Split('.')[-1]  # Use the last part of the package ID
        }
        
        # If we couldn't find a publisher, use a generic one
        if (-not $appMetadata.Publisher) {
            $appMetadata.Publisher = "WinGet Publisher"
        }
        
        Write-Log "Successfully retrieved metadata for $($appMetadata.Name) (Version: $($appMetadata.Version))" -Type "Success"
        return $appMetadata
    }
    catch {
        Write-Log "Error getting WinGet app metadata: $($_.Exception.Message)" -Type "Error"
        
        # Return basic metadata using the package ID
        return @{
            PackageId     = $PackageId
            Name          = $PackageId.Split('.')[-1]
            Publisher     = "WinGet Publisher"
            Version       = "Latest"
            Description   = "Application installed via WinGet"
            Homepage      = $null
            License       = $null
            LicenseUrl    = $null
            InstallerType = "exe"
        }
    }
}

# Function to generate install.ps1, uninstall.ps1, and detection.ps1 scripts
function Generate-WinGetScripts {
    param (
        [Parameter(Mandatory = $true)]
        [string]$PackageId,
        
        [Parameter(Mandatory = $false)]
        [string]$OutputPath = (Join-Path $PSScriptRoot "temp_winget_scripts")
    )
    
    Write-Log "Generating WinGet scripts for package '$PackageId' in '$OutputPath'..." -Type "Info"

    # Create output directory if it doesn't exist
    if (-not (Test-Path $OutputPath)) {
        New-Item -ItemType Directory -Path $OutputPath | Out-Null
    }
    
    # Generate install.ps1
    $installScriptPath = Join-Path $OutputPath "install.ps1"
    $installScriptContent = @"
`$ErrorActionPreference = 'Stop'
`$PackageName = "$PackageId"
`$LogFilePath = "C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\`$(`$PackageName)_Install.log"

#Start Logging
Start-Transcript -Path `$LogFilePath -Append

Write-Host "Starting installation process for `$PackageName"

# Function to install Microsoft.WinGet.Client module
function Ensure-WinGetClientModule {
    Write-Host "Checking for Microsoft.WinGet.Client module..."
    `$module = Get-Module -Name Microsoft.WinGet.Client -ListAvailable
    if (-not `$module) {
        Write-Host "Microsoft.WinGet.Client module not found. Attempting to install..."
        try {
            # Set PSGallery as trusted
            Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope AllUsers
            Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -Scope AllUsers
            Install-Module Microsoft.WinGet.Client -Force -Scope AllUsers
            Write-Host "Microsoft.WinGet.Client module installed successfully." -ForegroundColor Green
        }
        catch {
            Write-Host "Failed to install Microsoft.WinGet.Client module: `$(`$_.Exception.Message)" -ForegroundColor Red
            throw "Failed to install Microsoft.WinGet.Client module."
        }
    }
    else {
        Write-Host "Microsoft.WinGet.Client module is already installed (Version: `$(`$module.Version))." -ForegroundColor Green
    }
    Import-Module Microsoft.WinGet.Client -Force
}

try {
    Ensure-WinGetClientModule

    Write-Host "Attempting to install `$PackageName using Install-WinGetPackage..." -ForegroundColor Green
    
    # Check if package is already installed
    `$installedPackage = Get-WinGetPackage -Id `$PackageName -ErrorAction SilentlyContinue
    if (`$installedPackage) {
        Write-Host "Package `$PackageName (Version: `$(`$installedPackage.Version)) is already installed." -ForegroundColor Green
        Stop-Transcript
        Exit 0
    }

    # Install the package
    `$installResult = Install-WinGetPackage -Id `$PackageName -AcceptPackageAgreements -AcceptSourceAgreements -Silent -Force -ErrorAction SilentlyContinue # Added -Silent and -Force
    
    # Verify installation
    `$installedPackage = Get-WinGetPackage -Id `$PackageName -ErrorAction SilentlyContinue
    if (`$installedPackage) {
        Write-Host "Package `$PackageName (Version: `$(`$installedPackage.Version)) installed successfully." -ForegroundColor Green
        Stop-Transcript
        Exit 0
    }
    else {
        Write-Host "Failed to verify installation of `$PackageName. Install-WinGetPackage output: `$installResult" -ForegroundColor Red
        # Attempt to get more detailed error if available from winget logs
        `$wingetLogs = Get-WinGetLog -Id `$PackageName -ErrorAction SilentlyContinue
        if (`$wingetLogs) {
            Write-Host "WinGet Logs for `$PackageName:"
            `$wingetLogs | ForEach-Object { Write-Host `$_.Message }
        }
        Stop-Transcript
        Exit 1
    }
}
catch {
    Write-Host "An error occurred during the installation process for `$PackageName: `$(`$_.Exception.Message)" -ForegroundColor Red
    `$callStack = `$_.ScriptStackTrace
    if (`$callStack) {
        Write-Host "Script Call Stack:"
        Write-Host `$callStack
    }
    Stop-Transcript
    Exit 1
}
finally {
    if (Get-Transcript) {
        Stop-Transcript
    }
}
"@
    
    # Generate uninstall.ps1
    $uninstallScriptPath = Join-Path $OutputPath "uninstall.ps1"
    $uninstallScriptContent = @"
`$ErrorActionPreference = 'Stop'
`$PackageName = "$PackageId"
`$LogFilePath = "C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\`$(`$PackageName)_Uninstall.log"

#Start Logging
Start-Transcript -Path `$LogFilePath -Append

Write-Host "Starting uninstallation process for `$PackageName"

# Function to ensure Microsoft.WinGet.Client module is available
function Ensure-WinGetClientModule {
    Write-Host "Checking for Microsoft.WinGet.Client module..."
    `$module = Get-Module -Name Microsoft.WinGet.Client -ListAvailable
    if (-not `$module) {
        Write-Host "Microsoft.WinGet.Client module not found. Attempting to install..."
        try {
            # Set PSGallery as trusted
            Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope AllUsers
            Set-PSRepository -Name PSGallery -InstallationPolicy Trusted -Scope AllUsers
            Install-Module Microsoft.WinGet.Client -Force -Scope AllUsers
            Write-Host "Microsoft.WinGet.Client module installed successfully." -ForegroundColor Green
        }
        catch {
            Write-Host "Failed to install Microsoft.WinGet.Client module: `$(`$_.Exception.Message)" -ForegroundColor Red
            throw "Failed to install Microsoft.WinGet.Client module."
        }
    }
    else {
        Write-Host "Microsoft.WinGet.Client module is already installed (Version: `$(`$module.Version))." -ForegroundColor Green
    }
    Import-Module Microsoft.WinGet.Client -Force
}

try {
    Ensure-WinGetClientModule

    Write-Host "Attempting to uninstall `$PackageName using Uninstall-WinGetPackage..." -ForegroundColor Yellow
    
    # Check if package is installed
    `$installedPackage = Get-WinGetPackage -Id `$PackageName -ErrorAction SilentlyContinue
    if (-not `$installedPackage) {
        Write-Host "Package `$PackageName is not installed (already uninstalled)." -ForegroundColor Green
        Stop-Transcript
        Exit 0
    }

    Write-Host "Found installed package: `$PackageName (Version: `$(`$installedPackage.Version))" -ForegroundColor Green

    # Uninstall the package
    `$uninstallResult = Uninstall-WinGetPackage -Id `$PackageName -Silent -Force -ErrorAction SilentlyContinue
    
    # Verify uninstallation
    `$installedPackage = Get-WinGetPackage -Id `$PackageName -ErrorAction SilentlyContinue
    if (-not `$installedPackage) {
        Write-Host "Package `$PackageName uninstalled successfully." -ForegroundColor Green
        Stop-Transcript
        Exit 0
    }
    else {
        Write-Host "Failed to verify uninstallation of `$PackageName. Package may still be installed." -ForegroundColor Red
        Write-Host "Uninstall-WinGetPackage output: `$uninstallResult" -ForegroundColor Red
        Stop-Transcript
        Exit 1
    }
}
catch {
    Write-Host "An error occurred during the uninstallation process for `$PackageName: `$(`$_.Exception.Message)" -ForegroundColor Red
    `$callStack = `$_.ScriptStackTrace
    if (`$callStack) {
        Write-Host "Script Call Stack:"
        Write-Host `$callStack
    }
    Stop-Transcript
    Exit 1
}
finally {
    if (Get-Transcript) {
        Stop-Transcript
    }
}
"@
    
    # Generate detection.ps1
    $detectionScriptPath = Join-Path $OutputPath "detection.ps1"
    $detectionScriptContent = @"
`$PackageName = "$PackageId"

#Start Logging
Start-Transcript -Path "C:\ProgramData\Microsoft\IntuneManagementExtension\Logs\`$(`$PackageName)_Detection.log" -Append

try {
    Write-Host "Starting detection for package: `$PackageName" -ForegroundColor Green
    
    # Check if Microsoft.WinGet.Client module is available
    `$wingetModule = Get-Module -ListAvailable -Name Microsoft.WinGet.Client
    
    if (-not `$wingetModule) {
        Write-Host "Microsoft.WinGet.Client module not found. Attempting to install..." -ForegroundColor Yellow
        
        try {
            # Install the module for the current session
            Install-Module -Name Microsoft.WinGet.Client -Force -Scope CurrentUser -AllowClobber -ErrorAction Stop
            Write-Host "Microsoft.WinGet.Client module installed successfully" -ForegroundColor Green
        }
        catch {
            Write-Host "Failed to install Microsoft.WinGet.Client module: `$(`$_.Exception.Message)" -ForegroundColor Red
            
            # Fallback to traditional winget approach
            Write-Host "Falling back to traditional winget detection method..." -ForegroundColor Yellow
            
            # Check if winget is available
            `$AppInstaller = Get-AppxProvisionedPackage -Online | Where-Object DisplayName -eq Microsoft.DesktopAppInstaller
            
            if (`$AppInstaller.Version -lt "2022.506.16.0") {
                Write-Host "Winget is not properly installed for SYSTEM context" -ForegroundColor Red
                Stop-Transcript
                Exit 1
            }
            
            # Try traditional winget approach
            `$ResolveWingetPath = Resolve-Path "C:\Program Files\WindowsApps\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe" -ErrorAction SilentlyContinue
            if (`$ResolveWingetPath) {
                `$WingetPath = `$ResolveWingetPath[-1].Path
                Set-Location `$WingetPath
                
                `$checkOutput = .\winget.exe list --id `$PackageName --accept-source-agreements --disable-interactivity 2>&1
                Write-Host "Traditional winget detection output: `$checkOutput"
                
                `$found = `$false
                if (`$checkOutput) {
                    foreach (`$line in `$checkOutput) {
                        if (`$line -match [regex]::Escape(`$PackageName)) {
                            `$found = `$true
                            break
                        }
                    }
                }
                
                if (`$found) {
                    Write-Host "Package `$PackageName is installed (detected via traditional winget)." -ForegroundColor Green
                    Write-Output "Detected"
                    Stop-Transcript
                    Exit 0
                } else {
                    Write-Host "Package `$PackageName is not installed (traditional winget detection)." -ForegroundColor Yellow
                    Stop-Transcript
                    Exit 1
                }
            }
            else {
                Write-Host "Could not locate winget executable" -ForegroundColor Red
                Stop-Transcript
                Exit 1
            }
        }
    }
    
    # Import the Microsoft.WinGet.Client module
    try {
        Import-Module Microsoft.WinGet.Client -Force -ErrorAction Stop
        Write-Host "Microsoft.WinGet.Client module imported successfully" -ForegroundColor Green
    }
    catch {
        Write-Host "Failed to import Microsoft.WinGet.Client module: `$(`$_.Exception.Message)" -ForegroundColor Red
        Stop-Transcript
        Exit 1
    }
    
    # Use the PowerShell module to detect the package
    Write-Host "Attempting to detect `$PackageName using Microsoft.WinGet.Client module" -ForegroundColor Green
    
    try {
        # Get installed packages using the WinGet PowerShell module
        `$installedPackages = Get-WinGetPackage -Id `$PackageName -ErrorAction SilentlyContinue
        
        if (`$installedPackages) {
            Write-Host "Package `$PackageName is installed (detected via Microsoft.WinGet.Client module)." -ForegroundColor Green
            Write-Host "Installed version: `$(`$installedPackages.InstalledVersion)" -ForegroundColor Green
            Write-Output "Detected"
            Stop-Transcript
            Exit 0
        }
        else {
            Write-Host "Package `$PackageName is not installed (Microsoft.WinGet.Client module detection)." -ForegroundColor Yellow
            Stop-Transcript
            Exit 1
        }
    }
    catch {
        Write-Host "Error during package detection with Microsoft.WinGet.Client: `$(`$_.Exception.Message)" -ForegroundColor Red
        Write-Host "Exception details: `$(`$_.Exception.GetType().FullName)" -ForegroundColor Red
        
        # Additional fallback - try to search for the package to verify WinGet is working
        try {
            Write-Host "Testing WinGet functionality by searching for the package..." -ForegroundColor Yellow
            `$searchResult = Find-WinGetPackage -Id `$PackageName -ErrorAction SilentlyContinue
            if (`$searchResult) {
                Write-Host "WinGet search successful, but package is not installed" -ForegroundColor Yellow
            }
            else {
                Write-Host "WinGet search failed - package not found in repositories" -ForegroundColor Red
            }
        }
        catch {
            Write-Host "WinGet search also failed: `$(`$_.Exception.Message)" -ForegroundColor Red
        }
        
        Stop-Transcript
        Exit 1
    }
}
catch {
    Write-Host "Unexpected error during detection: `$(`$_.Exception.Message)" -ForegroundColor Red
    Write-Host "Exception type: `$(`$_.Exception.GetType().FullName)" -ForegroundColor Red
    Stop-Transcript
    Exit 1
}
"@
    
    # Write the scripts to files
    Set-Content -Path $installScriptPath -Value $installScriptContent
    Set-Content -Path $uninstallScriptPath -Value $uninstallScriptContent
    Set-Content -Path $detectionScriptPath -Value $detectionScriptContent
    
    Write-Log "Successfully generated WinGet scripts." -Type "Success"
    return $OutputPath
}

# Function to package the generated scripts using IntuneWinAppUtil.exe
function Package-WinGetScripts {
    param (
        [Parameter(Mandatory = $true)]
        [string]$ScriptsPath,
        
        [Parameter(Mandatory = $true)]
        [string]$PackageId, # Used for naming the output .intunewin file
        
        [Parameter(Mandatory = $false)]
        [string]$OutputPath = (Join-Path $PSScriptRoot "temp_intunewin_package")
    )
    
    Write-Log "Packaging scripts for '$PackageId' using IntuneWinAppUtil.exe..." -Type "Info"

    # Create output directory if it doesn't exist
    if (-not (Test-Path $OutputPath)) {
        New-Item -ItemType Directory -Path $OutputPath | Out-Null
    }
    
    # Look for IntuneWinAppUtil.exe in the script directory first
    $intunewinAppUtilPath = Join-Path $PSScriptRoot "IntuneWinAppUtil.exe"
    if (-not (Test-Path $intunewinAppUtilPath)) {
        # If not found in script directory, try to use from PATH
        $intunewinAppUtilPath = "IntuneWinAppUtil.exe"
        Write-Log "IntuneWinAppUtil.exe not found in script directory, will try to use from PATH" -Type "Verbose"
    }
    
    # Define the output .intunewin file name
    $outputIntunewinFileName = "$($PackageId.Replace('.', '_')).intunewin"
    $outputIntunewinPath = Join-Path $OutputPath $outputIntunewinFileName

    # Package the scripts
    try {
        # IntuneWinAppUtil.exe -c <source_folder> -s <setup_file> -o <output_folder> -q
        # For scripts, the source folder is $ScriptsPath, setup file is install.ps1
        $command = "& `"$intunewinAppUtilPath`" -c `"$ScriptsPath`" -s `"install.ps1`" -o `"$OutputPath`" -q"
        Write-Log "Executing command: $command" -Type "Verbose"
        Invoke-Expression $command | Out-Null
        
        # Verify the file exists after running IntuneWinAppUtil
        if (Test-Path $outputIntunewinPath) {
            Write-Log "IntuneWin package created: $outputIntunewinPath" -Type "Success"
            return $outputIntunewinPath
        }
        else {
            # If the expected file doesn't exist, try to find what was actually created
            $createdFiles = Get-ChildItem -Path $OutputPath -Filter "*.intunewin"
            if ($createdFiles.Count -gt 0) {
                # Use the first .intunewin file found
                $outputIntunewinPath = $createdFiles[0].FullName
                Write-Log "IntuneWin package created with different name: $outputIntunewinPath" -Type "Success"
                return $outputIntunewinPath
            }
            else {
                throw "IntuneWinAppUtil did not create any .intunewin files in $OutputPath"
            }
        }
    }
    catch {
        Write-Log "Error creating IntuneWin package. Make sure IntuneWinAppUtil.exe is available and in PATH. Error: $($_.Exception.Message)" -Type "Error"
        throw
    }
}

# Main execution logic
try {
    # Ensure Winget is installed
    try {
        winget --version | Out-Null
        Write-Log "Winget CLI is installed." -Type "Success"
    }
    catch {
        Write-Log "Winget CLI is not found. Please install Winget to use this script." -Type "Error"
        exit 1
    }

    # Get app metadata
    $appMetadata = Get-WinGetAppMetadata -PackageId $PackageId
    $appDisplayName = $appMetadata.Name
    $appPublisher = $appMetadata.Publisher
    $appVersion = $appMetadata.Version
    $appDescription = $appMetadata.Description
    $appHomepage = $appMetadata.Homepage
    $appLicense = $appMetadata.License
    $appLicenseUrl = $appMetadata.LicenseUrl

    # Generate scripts
    $scriptsTempDir = Generate-WinGetScripts -PackageId $PackageId
    
    # Package scripts
    $intunewinFilePath = Package-WinGetScripts -ScriptsPath $scriptsTempDir -PackageId $PackageId

    # Define detection rules (script detection)
    $detectionRules = @(
        @{
            "@odata.type"         = "#microsoft.graph.win32LobAppPowerShellScriptDetection"
            scriptContent         = [System.Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes((Get-Content (Join-Path $scriptsTempDir "detection.ps1") -Raw)))
            enforceSignatureCheck = $false
            runAs32Bit            = $false
            runAsAccount          = "system"
        }
    )

    # Define requirements (example: OS version)
    $requirements = @{
        minimumCpuSpeedInMHz            = 500
        minimumMemoryInMB               = 256
        minimumDiskSpaceInMB            = 100
        minimumNumberOfProcessors       = 1
        minimumSupportedOperatingSystem = @{
            "@odata.type" = "#microsoft.graph.windowsMinimumOperatingSystem"
            v10_0         = $true # Windows 10 or later
            v10_1607      = $true # Windows 10 1607 or later
        }
    }

    # Define install/uninstall commands
    $installCommandLine = "%SystemRoot%\sysnative\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File install.ps1"
    $uninstallCommandLine = "%SystemRoot%\sysnative\WindowsPowerShell\v1.0\powershell.exe -ExecutionPolicy Bypass -File uninstall.ps1"

    $newAppPayload = @{
        "@odata.type"                   = "#microsoft.graph.win32LobApp"
        displayName                     = $appDisplayName
        description                     = $appDescription
        publisher                       = $appPublisher
        informationUrl                  = $appHomepage # Using Homepage as Information URL
        privacyUrl                      = $null # Can be added if available
        developer                       = $appPublisher # Using Publisher as Developer
        fileName                        = [System.IO.Path]::GetFileName($intunewinFilePath)
        installCommandLine              = $installCommandLine
        uninstallCommandLine            = $uninstallCommandLine
        applicableArchitectures         = "x64" # Assuming x64 for most Winget apps, can be dynamic
        minimumSupportedOperatingSystem = $requirements.minimumSupportedOperatingSystem
        detectionRules                  = $detectionRules
        setupFilePath                   = "install.ps1" # The setup file path within the .intunewin package
        installExperience               = @{
            "@odata.type"         = "#microsoft.graph.win32LobAppInstallExperience"
            runAsAccount          = "system" # Run as system by default
            deviceRestartBehavior = "suppress" # Suppress restarts by default
        }
        returnCodes                     = @(
            @{
                "@odata.type" = "#microsoft.graph.win32LobAppReturnCode"
                returnCode    = 0
                type          = "success"
            },
            @{
                "@odata.type" = "#microsoft.graph.win32LobAppReturnCode"
                returnCode    = 3010
                type          = "softReboot"
            },
            @{
                "@odata.type" = "#microsoft.graph.win32LobAppReturnCode"
                returnCode    = 1641
                type          = "hardReboot"
            },
            @{
                "@odata.type" = "#microsoft.graph.win32LobAppReturnCode"
                returnCode    = 1618
                type          = "retry"
            },
            @{
                "@odata.type" = "#microsoft.graph.win32LobAppReturnCode"
                returnCode    = 1603
                type          = "failed"
            }
        )
    }

    Write-Log "Uploading Win32 app to Intune..." -Type "Info"
    Write-Log "Payload for new app: $($newAppPayload | ConvertTo-Json -Depth 10)" -Type "Info" # Log the payload
    $createAppUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps"
    $newApp = Invoke-MgGraphRequest -Method POST -Uri $createAppUri -Body ($newAppPayload | ConvertTo-Json -Depth 10)
    Write-Log "Win32 App created successfully (ID: $($newApp.id))" -Type "Success"

    Write-Log "Processing content version..." -Type "Info"
    $contentVersionUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($newApp.id)/microsoft.graph.win32LobApp/contentVersions"
    $contentVersion = Invoke-MgGraphRequest -Method POST -Uri $contentVersionUri -Body "{}"
    Write-Log "Content version created (ID: $($contentVersion.id))" -Type "Success"

    Write-Log "Encrypting application file..." -Type "Info"
    $encryptedFilePath = "$intunewinFilePath.bin"
    if (Test-Path $encryptedFilePath) {
        Remove-Item $encryptedFilePath -Force
    }
    $fileEncryptionInfo = EncryptFile $intunewinFilePath
    Write-Log "File encryption complete" -Type "Success"

    try {
        Write-Log "Uploading to Azure Storage..." -Type "Info"
        $fileContent = @{
            "@odata.type" = "#microsoft.graph.mobileAppContentFile"
            name          = [System.IO.Path]::GetFileName($intunewinFilePath)
            size          = (Get-Item $intunewinFilePath).Length
            sizeEncrypted = (Get-Item "$intunewinFilePath.bin").Length
            isDependency  = $false
        }

        Write-Log "Creating content file entry in Intune..." -Type "Info"
        $contentFileUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($newApp.id)/microsoft.graph.win32LobApp/contentVersions/$($contentVersion.id)/files"  
        $contentFile = Invoke-MgGraphRequest -Method POST -Uri $contentFileUri -Body ($fileContent | ConvertTo-Json)
        Write-Log "Content file entry created successfully" -Type "Success"

        Write-Log "Waiting for Azure Storage URI..." -Type "Info"
        $maxWaitAttempts = 12  # 1 minute total (5 seconds * 12)
        $waitAttempt = 0
        do {
            Start-Sleep -Seconds 5
            $waitAttempt++
            Write-Log "Checking upload state (attempt $waitAttempt of $maxWaitAttempts)..." -Type "Info"
            
            $fileStatusUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($newApp.id)/microsoft.graph.win32LobApp/contentVersions/$($contentVersion.id)/files/$($contentFile.id)"
            $fileStatus = Invoke-MgGraphRequest -Method GET -Uri $fileStatusUri
            
            if ($waitAttempt -eq $maxWaitAttempts -and $fileStatus.uploadState -ne "azureStorageUriRequestSuccess") {
                throw "Timed out waiting for Azure Storage URI"
            }
        } while ($fileStatus.uploadState -ne "azureStorageUriRequestSuccess")

        Write-Log "Received Azure Storage URI, starting upload..." -Type "Info"
        UploadFileToAzureStorage $fileStatus.azureStorageUri "$intunewinFilePath.bin"
        Write-Log "Upload to Azure Storage complete" -Type "Success"
    }
    catch {
        Write-Log "Failed during upload process: $($_.Exception.Message)" -Type "Error"
        throw
    }

    Write-Log "Committing file to Intune..." -Type "Info"
    $commitData = @{
        fileEncryptionInfo = $fileEncryptionInfo
    }
    $commitUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($newApp.id)/microsoft.graph.win32LobApp/contentVersions/$($contentVersion.id)/files/$($contentFile.id)/commit"
    Invoke-MgGraphRequest -Method POST -Uri $commitUri -Body ($commitData | ConvertTo-Json)

    $retryCount = 0
    $maxRetries = 10
    do {
        Start-Sleep -Seconds 10
        $fileStatusUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($newApp.id)/microsoft.graph.win32LobApp/contentVersions/$($contentVersion.id)/files/$($contentFile.id)"
        $fileStatus = Invoke-MgGraphRequest -Method GET -Uri $fileStatusUri
        if ($fileStatus.uploadState -eq "commitFileFailed") {
            $commitResponse = Invoke-MgGraphRequest -Method POST -Uri $commitUri -Body ($commitData | ConvertTo-Json)
            $retryCount++
        }
    } while ($fileStatus.uploadState -ne "commitFileSuccess" -and $retryCount -lt $maxRetries)

    if ($fileStatus.uploadState -eq "commitFileSuccess") {
        Write-Log "File committed successfully" -Type "Success"
    }
    else {
        Write-Log "Failed to commit file after $maxRetries attempts." -Type "Error"
        exit 1
    }

    $updateAppUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($newApp.id)"
    $updateData = @{
        "@odata.type"           = "#microsoft.graph.win32LobApp"
        committedContentVersion = $contentVersion.id
    }
    Invoke-MgGraphRequest -Method PATCH -Uri $updateAppUri -Body ($updateData | ConvertTo-Json)

    # Add logo
    Add-IntuneAppLogo -appId $newApp.id -packageId $PackageId -appType "win32LobApp" -localLogoPath $null

    Write-Log "Cleaning up temporary files..." -Type "Info"
    try {
        Remove-Item $scriptsTempDir -Recurse -Force -ErrorAction Stop
        Remove-Item (Split-Path $intunewinFilePath -Parent) -Recurse -Force -ErrorAction Stop # Remove the temp_intunewin_package folder
        Remove-Item "$intunewinFilePath.bin" -Force -ErrorAction SilentlyContinue # Remove the encrypted bin file
        Write-Log "Cleaned up temporary directories." -Type "Success"
    }
    catch {
        Write-Log "Warning: Could not remove temporary directories. Error: $($_.Exception.Message)" -Type "Warning"
    }

    Write-Log "Successfully processed $appDisplayName" -Type "Success"
    Write-Log "App is now available in Intune Portal: https://intune.microsoft.com/#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/$($newApp.id)" -Type "Info"
    Write-Log " " -Type "Info"

    Write-Log "All operations completed successfully!" -Type "Success"
}
catch {
    Write-Log "An unexpected error occurred: $($_.Exception.Message)" -Type "Error"
    exit 1
}
finally {
    Write-Log "Disconnecting from Microsoft Graph" -Type "Info"
    Disconnect-MgGraph > $null 2>&1
}