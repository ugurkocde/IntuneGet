<#
.SYNOPSIS
    This script uploads Windows applications from Winget to Microsoft Intune.
.DESCRIPTION
    This script automates the process of deploying Windows applications from Winget to Microsoft Intune.
    It leverages Winget to find and download application installers, then packages them as Win32 apps
    for Intune deployment. It reuses authentication and core upload logic from IntuneBrew.
.NOTES
    Version:        0.1
    Author:         Ugur Koc
    Creation Date:  2025-05-22
.REQUIREMENTS
    - PowerShell 7.0 or later
    - Microsoft.Graph.Authentication module
    - Winget CLI installed and configured
    - IntuneWinAppUtil.exe available in same directory
    - Required Graph API Permissions:
        * DeviceManagementApps.ReadWrite.All
#>

# Main script logic for Winget app upload
param(
    [Parameter(Mandatory = $true)]
    [string]$PackageId,

    [Parameter(Mandatory = $false)]
    [string]$Version,

    [Parameter(Mandatory = $false)]
    [switch]$CopyAssignments
)

# Disable verbose output to avoid cluttering the Azure Automation Runbook logs
$VerbosePreference = "SilentlyContinue"

# Function to write logs that will be visible in Azure Automation
function Write-Log {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [Parameter(Mandatory = $false)]
        [string]$Type = "Info"  # Info, Warning, Error, Verbose
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Type] $Message"
    if ($Type -eq "Verbose") {
        # Enable verbose output only when we really need it
        $VerbosePreference = "Continue"
        Write-Verbose $logMessage
        $VerbosePreference = "SilentlyContinue"
    }
    else {
        Write-Output $logMessage
    }
}



# Function to write logs that will be visible in Azure Automation
function Write-Log {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [Parameter(Mandatory = $false)]
        [string]$Type = "Info"  # Info, Warning, Error, Verbose
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Type] $Message"
    if ($Type -eq "Verbose") {
        # Enable verbose output only when we really need it
        $VerbosePreference = "Continue"
        Write-Verbose $logMessage
        $VerbosePreference = "SilentlyContinue"
    }
    else {
        Write-Output $logMessage
    }
}

Write-Log "Starting Intuneget - Version 0.1"

# Authentication START (Copied from IntuneBrew.ps1, adapted for Intuneget)

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
        Write-Log "Successfully connected to Microsoft Graph using certificate-based authentication." -Type "Info"
        return $true
    }
    catch {
        Write-Log "Failed to connect to Microsoft Graph using certificate. Error: $_" -Type "Error"
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
        Write-Log "Successfully connected to Microsoft Graph using client secret authentication." -Type "Info"
        return $true
    }
    catch {
        Write-Log "Failed to connect to Microsoft Graph using client secret. Error: $_" -Type "Error"
        return $false
    }
}

# Function to authenticate interactively
function Connect-Interactive {
    try {
        $permissionsList = $requiredPermissions -join ','
        Connect-MgGraph -Scopes $permissionsList -NoWelcome -ErrorAction Stop
        Write-Log "Successfully connected to Microsoft Graph using interactive sign-in." -Type "Info"
        return $true
    }
    catch {
        Write-Log "Failed to connect to Microsoft Graph via interactive sign-in. Error: $_" -Type "Error"
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
Write-Log "`nChoose authentication method:" -Type "Info"
Write-Log "1. App Registration with Certificate" -Type "Info"
Write-Log "2. App Registration with Secret" -Type "Info"
Write-Log "3. Interactive Session with Admin Account" -Type "Info"
$authChoice = Read-Host "`nEnter your choice (1-3)"

$authenticated = $false

switch ($authChoice) {
    "1" {
        Write-Log "`nPlease select the certificate configuration JSON file..." -Type "Info"
        $configPath = Show-FilePickerDialog -Title "Select Certificate Configuration JSON File"
        if ($configPath -and (Test-AuthConfig $configPath)) {
            $authenticated = Connect-WithCertificate $configPath
        }
    }
    "2" {
        Write-Log "`nPlease select the client secret configuration JSON file..." -Type "Info"
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
    Write-Log "All required permissions are present." -Type "Info"
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
        Write-Log "Starting file upload to Azure Storage"
        $fileSize = [Math]::Round((Get-Item $filepath).Length / 1MB, 2)
        Write-Log "File size: $fileSize MB"
        
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
                                Write-Log "Failed to upload block. Error: $_" -Type "Error"
                            }
                        }
                    }

                    if (-not $uploadBlockSuccess) {
                        throw "Failed to upload block after multiple retries"
                    }

                    $percentComplete = [Math]::Round(($blockId + 1) / $totalBlocks * 100, 1)
                    # Only log progress at 10% intervals
                    if ($percentComplete - $lastProgressReport -ge 10) {
                        Write-Log "Upload progress: $percentComplete%"
                        $lastProgressReport = [Math]::Floor($percentComplete / 10) * 10
                    }
                    
                    $blockId++
                }
                
                $fileStream.Close()

                Write-Log "Finalizing upload..."
                Invoke-RestMethod -Method Put "$sasUri&comp=blocklist" -Body $blockList | Out-Null
                Write-Log "Upload completed successfully"
                
                $uploadSuccess = $true
            }
            catch {
                $retryCount++
                Write-Log "Upload attempt failed: $_" -Type "Error"
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
        Write-Log "Critical error during upload: $_" -Type "Error"
        throw
    }
}

# Function to get assignments for a specific Intune app
function Get-IntuneAppAssignments {
    param (
        [string]$AppId
    )

    if ([string]::IsNullOrEmpty($AppId)) {
        Write-Log "Error: App ID is required to fetch assignments." -Type "Verbose"
        return $null
    }

    Write-Log "`n🔍 Fetching assignments for existing app (ID: $AppId)..." -Type "Verbose"
    $assignmentsUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$AppId/assignments"
    
    try {
        # Use Invoke-MgGraphRequest for consistency and authentication handling
        $response = Invoke-MgGraphRequest -Method GET -Uri $assignmentsUri
        
        # The response directly contains the assignments array in the 'value' property
        if ($response.value -ne $null -and $response.value.Count -gt 0) {
            Write-Log "✅ Found $($response.value.Count) assignment(s)." -Type "Verbose"
            return $response.value
        }
        else {
            Write-Log "ℹ️ No assignments found for the existing app." -Type "Verbose"
            return @() # Return an empty array if no assignments
        }
    }
    catch {
        Write-Log "❌ Error fetching assignments for App ID ${AppId}: $($_.Exception.Message)" -Type "Verbose"
        # Consider returning specific error info or re-throwing if needed
        return $null # Indicate error
    }
}

# Function to apply assignments to a specific Intune app
function Set-IntuneAppAssignments {
    param (
        [string]$NewAppId,
        [array]$Assignments
    )

    if ([string]::IsNullOrEmpty($NewAppId)) {
        Write-Log "Error: New App ID is required to set assignments." -Type "Error"
        return
    }

    # Check if $Assignments is null or empty before proceeding
    if ($Assignments -eq $null -or $Assignments.Count -eq 0) {
        Write-Log "ℹ️ No assignments to apply." -Type "Info"
        return
    }

    Write-Log "Applying assignments to new app (ID: $NewAppId)..." -Type "Info"
    $assignmentsUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$NewAppId/assignments"
    $appliedCount = 0
    $failedCount = 0

    foreach ($assignment in $Assignments) {
        # Construct the body for the new assignment
        $targetObject = $null
        $originalTargetType = $assignment.target.'@odata.type'

        # Determine the target type and construct the target object accordingly
        if ($assignment.target.groupId) {
            $targetObject = @{
                "@odata.type" = "#microsoft.graph.groupAssignmentTarget"
                groupId       = $assignment.target.groupId
            }
        }
        elseif ($originalTargetType -match 'allLicensedUsersAssignmentTarget') {
            $targetObject = @{
                "@odata.type" = "#microsoft.graph.allLicensedUsersAssignmentTarget"
            }
        }
        elseif ($originalTargetType -match 'allDevicesAssignmentTarget') {
            $targetObject = @{
                "@odata.type" = "#microsoft.graph.allDevicesAssignmentTarget"
            }
        }
        else {
            Write-Log "⚠️ Warning: Unsupported assignment target type '$originalTargetType' found. Skipping this assignment." -Type "Warning"
            continue # Skip to the next assignment
        }

        # Build the main assignment body
        $assignmentBody = @{
            "@odata.type" = "#microsoft.graph.mobileAppAssignment" # Explicitly set the assignment type
            target        = $targetObject # Use the constructed target object
        }

        # Add intent (mandatory)
        $assignmentBody.intent = $assignment.intent

        # Conditionally add optional settings if they exist in the source assignment
        if ($assignment.PSObject.Properties.Name -contains 'settings' -and $assignment.settings -ne $null) {
            $assignmentBody.settings = $assignment.settings
        }
        # 'source' is usually determined by Intune and not needed for POST
        # 'sourceId' is read-only and should not be included

        $assignmentJson = $assignmentBody | ConvertTo-Json -Depth 5 -Compress

        try {
            $targetDescription = if ($assignment.target.groupId) { "group ID: $($assignment.target.groupId)" } elseif ($assignment.target.'@odata.type') { $assignment.target.'@odata.type' } else { "unknown target" }
            Write-Log "   • Applying assignment for target $targetDescription" -Type "Info"
            # Use Invoke-MgGraphRequest for consistency
            Invoke-MgGraphRequest -Method POST -Uri $assignmentsUri -Body $assignmentJson -ErrorAction Stop | Out-Null
            $appliedCount++
        }
        catch {
            $failedCount++
            Write-Log "❌ Error applying assignment for target $targetDescription : $_" -Type "Error"
            # Log the failed assignment body for debugging if needed
            # Write-Host "Failed assignment body: $assignmentJson" -ForegroundColor DarkGray
        }
    }
    
    Write-Log "---------------------------------------------------" -Type "Info"
    if ($appliedCount -gt 0) {
        Write-Log "✅ Successfully applied $appliedCount assignment(s)." -Type "Info"
    }
    if ($failedCount -gt 0) {
        Write-Log "❌ Failed to apply $failedCount assignment(s)." -Type "Error"
    }
    if ($appliedCount -eq 0 -and $failedCount -eq 0) {
        Write-Log "ℹ️ No assignments were processed." -Type "Info" # Should not happen if $Assignments was not empty initially
    }
    Write-Log "---------------------------------------------------" -Type "Info"
}

# Function to remove assignments from a specific Intune app
function Remove-IntuneAppAssignments {
    param (
        [string]$OldAppId,
        [array]$AssignmentsToRemove
    )

    if ([string]::IsNullOrEmpty($OldAppId)) {
        Write-Log "Error: Old App ID is required to remove assignments." -Type "Error"
        return
    }

    if ($AssignmentsToRemove -eq $null -or $AssignmentsToRemove.Count -eq 0) {
        Write-Log "ℹ️ No assignments specified for removal." -Type "Info"
        return
    }

    Write-Log "Removing assignments from old app (ID: $OldAppId)..." -Type "Info"
    $removedCount = 0
    $failedCount = 0

    foreach ($assignment in $AssignmentsToRemove) {
        # Each assignment fetched earlier has its own ID
        $assignmentId = $assignment.id
        if ([string]::IsNullOrEmpty($assignmentId)) {
            Write-Log "⚠️ Warning: Assignment found without an ID. Cannot remove." -Type "Warning"
            continue
        }

        $removeUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$OldAppId/assignments/$assignmentId"
    
        # Determine target description for logging
        $targetDescription = "assignment ID: $assignmentId"
        if ($assignment.target.groupId) { $targetDescription = "group ID: $($assignment.target.groupId)" }
        elseif ($assignment.target.'@odata.type' -match 'allLicensedUsersAssignmentTarget') { $targetDescription = "All Users" }
        elseif ($assignment.target.'@odata.type' -match 'allDevicesAssignmentTarget') { $targetDescription = "All Devices" }

        try {
            Write-Log "   • Removing assignment for target $targetDescription" -Type "Info"
            Invoke-MgGraphRequest -Method DELETE -Uri $removeUri -ErrorAction Stop | Out-Null
            $removedCount++
        }
        catch {
            $failedCount++
            Write-Log "❌ Error removing assignment for target $targetDescription : $_" -Type "Error"
        }
    }

    Write-Log "---------------------------------------------------" -Type "Info"
    if ($removedCount -gt 0) {
        Write-Log "✅ Successfully removed $removedCount assignment(s) from old app." -Type "Info"
    }
    if ($failedCount -gt 0) {
        Write-Log "❌ Failed to remove $failedCount assignment(s) from old app." -Type "Error"
    }
    if ($removedCount -eq 0 -and $failedCount -eq 0) {
        Write-Log "ℹ️ No assignments were processed for removal." -Type "Info"
    }
    Write-Log "---------------------------------------------------" -Type "Info"
}

function Add-IntuneAppLogo {
    param (
        [string]$appId,
        [string]$appName,
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
            # Try to download from repository (placeholder for Winget logos)
            # For Winget, we might need a different strategy to get logos,
            # or rely on a local collection. For now, this will likely fail.
            $logoFileName = $appName.ToLower().Replace(" ", "_") + ".png"
            $logoUrl = "https://raw.githubusercontent.com/ugurkocde/IntuneBrew/main/Logos/$logoFileName" # This is for macOS apps
            Write-Log "Attempting to download logo from: $logoUrl (This might not work for Winget apps)" -Type "Info"
            
            # Download the logo
            $tempLogoPath = Join-Path $PWD "temp_logo.png"
            try {
                Invoke-WebRequest -Uri $logoUrl -OutFile $tempLogoPath
            }
            catch {
                Write-Log "⚠️ Could not download logo from repository. Error: $_" -Type "Warning"
                return
            }
        }

        if (-not $tempLogoPath -or -not (Test-Path $tempLogoPath)) {
            Write-Log "⚠️ No valid logo file available" -Type "Warning"
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

        Invoke-MgGraphRequest -Method PATCH -Uri $logoUri -Body ($updateBody | ConvertTo-Json -Depth 10)
        Write-Log "✅ Logo added successfully" -Type "Info"

        # Cleanup
        if (Test-Path $tempLogoPath) {
            Remove-Item $tempLogoPath -Force
        }
    }
    catch {
        Write-Log "⚠️ Warning: Could not add app logo. Error: $_" -Type "Warning"
    }
}

# Ensure Winget is installed
try {
    winget --version | Out-Null
    Write-Log "Winget CLI is installed." -Type "Info"
}
catch {
    Write-Log "Winget CLI is not found. Please install Winget to use this script." -Type "Error"
    exit 1
}

# Function to parse the text output of winget show
function Parse-WingetShowOutput {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WingetOutput
    )

    $appDetails = [PSCustomObject]@{
        Name             = $null
        Publisher        = $null
        Version          = $null
        Description      = $null
        Homepage         = $null
        InstallerUrl     = $null
        InstallerSha256  = $null
        InstallerType    = $null
        InstallCommand   = $null
        UninstallCommand = $null
    }

    $lines = $WingetOutput -split "`n"
    $inInstallersSection = $false
    $currentInstaller = @{}
    $installers = @()

    # First, try to extract the app name from the "Found [PackageId]" line
    foreach ($line in $lines) {
        $line = $line.Trim()
        if ($line -match "Found\s+(.*?)\s+\[(.*?)\]") {
            $appDetails.Name = $matches[1].Trim()
            break
        }
    }

    foreach ($line in $lines) {
        $line = $line.Trim()

        # Handle both formats: "Name: Value" and "Name Value"
        if ($line -match "^Name:\s*(.*)") {
            $appDetails.Name = $matches[1].Trim()
        }
        elseif ($line -match "^Publisher:\s*(.*)") {
            $appDetails.Publisher = $matches[1].Trim()
        }
        elseif ($line -match "^Version:\s*(.*)") {
            $appDetails.Version = $matches[1].Trim()
        }
        elseif ($line -match "^Description:\s*(.*)") {
            # For multi-line descriptions, capture the first line
            $appDetails.Description = $matches[1].Trim()
        }
        elseif ($line -match "^Homepage:\s*(.*)") {
            $appDetails.Homepage = $matches[1].Trim()
        }
        elseif ($line -match "^Installer:") {
            # Start of an installer block
            if ($currentInstaller.Count -gt 0) {
                $installers += [PSCustomObject]$currentInstaller
            }
            $currentInstaller = @{}
            $inInstallersSection = $true
        }
        elseif ($inInstallersSection) {
            # Handle both formats with and without leading spaces
            if ($line -match "Installer Url:\s*(.*)") {
                $currentInstaller.InstallerUrl = $matches[1].Trim()
            }
            elseif ($line -match "^  InstallerUrl:\s*(.*)") {
                $currentInstaller.InstallerUrl = $matches[1].Trim()
            }
            elseif ($line -match "Installer SHA256:\s*(.*)") {
                $currentInstaller.InstallerSha256 = $matches[1].Trim()
            }
            elseif ($line -match "^  InstallerSha256:\s*(.*)") {
                $currentInstaller.InstallerSha256 = $matches[1].Trim()
            }
            elseif ($line -match "Installer Type:\s*(.*)") {
                $currentInstaller.InstallerType = $matches[1].Trim()
            }
            elseif ($line -match "^  InstallerType:\s*(.*)") {
                $currentInstaller.InstallerType = $matches[1].Trim()
            }
            elseif ($line -match "Install Command:\s*(.*)") {
                $currentInstaller.InstallCommand = $matches[1].Trim()
            }
            elseif ($line -match "^  InstallCommand:\s*(.*)") {
                $currentInstaller.InstallCommand = $matches[1].Trim()
            }
            elseif ($line -match "Uninstall Command:\s*(.*)") {
                $currentInstaller.UninstallCommand = $matches[1].Trim()
            }
            elseif ($line -match "^  UninstallCommand:\s*(.*)") {
                $currentInstaller.UninstallCommand = $matches[1].Trim()
            }
            # If we encounter a new top-level field, it means the installer block ended
            elseif ($line -match "^[A-Za-z]+:") {
                if ($currentInstaller.Count -gt 0) {
                    $installers += [PSCustomObject]$currentInstaller
                }
                $currentInstaller = @{}
                $inInstallersSection = $false
            }
        }
    }

    # Add the last installer if any
    if ($currentInstaller.Count -gt 0) {
        $installers += [PSCustomObject]$currentInstaller
    }

    # Find the best installer based on priority
    $bestInstaller = $null
    foreach ($installer in $installers) {
        if ($installer.InstallerType -eq "msix") {
            $bestInstaller = $installer
            break
        }
        elseif ($installer.InstallerType -eq "msi") {
            if (-not $bestInstaller -or $bestInstaller.InstallerType -ne "msix") {
                $bestInstaller = $installer
            }
        }
        elseif ($installer.InstallerType -eq "exe") {
            if (-not $bestInstaller -or ($bestInstaller.InstallerType -ne "msix" -and $bestInstaller.InstallerType -ne "msi")) {
                $bestInstaller = $installer
            }
        }
    }

    if ($bestInstaller) {
        $appDetails.InstallerUrl = $bestInstaller.InstallerUrl
        $appDetails.InstallerSha256 = $bestInstaller.InstallerSha256
        $appDetails.InstallerType = $bestInstaller.InstallerType
        $appDetails.InstallCommand = $bestInstaller.InstallCommand
        $appDetails.UninstallCommand = $bestInstaller.UninstallCommand
    }

    # If we still don't have installer details, try to extract them directly from the output
    if (-not $appDetails.InstallerUrl) {
        foreach ($line in $lines) {
            $line = $line.Trim()
            if ($line -match "Installer Url:\s*(.*)") {
                $appDetails.InstallerUrl = $matches[1].Trim()
            }
            elseif ($line -match "Installer SHA256:\s*(.*)") {
                $appDetails.InstallerSha256 = $matches[1].Trim()
            }
            elseif ($line -match "Installer Type:\s*(.*)") {
                $appDetails.InstallerType = $matches[1].Trim()
            }
        }
    }

    return $appDetails
}

# Get Winget app details
Write-Log "Searching for package '$PackageId' in Winget..." -Type "Info"
try {
    $wingetSearch = winget show $PackageId --exact --disable-interactivity 2>&1
    Write-Log "Raw Winget output: $($wingetSearch | Out-String)" -Type "Verbose"
    $wingetAppInfo = Parse-WingetShowOutput -WingetOutput ($wingetSearch | Out-String)

    if (-not $wingetAppInfo.Name) {
        # Try an alternative approach if the first parsing attempt failed
        Write-Log "Initial parsing failed, trying alternative approach..." -Type "Verbose"
        
        # Extract name from the first line that contains the package ID
        foreach ($line in $wingetSearch) {
            if ($line -match "\[$PackageId\]") {
                if ($line -match "Found\s+(.*?)\s+\[$PackageId\]") {
                    $wingetAppInfo.Name = $matches[1].Trim()
                    break
                }
            }
        }
        
        # If we still don't have a name, try to extract other details directly
        if (-not $wingetAppInfo.Name) {
            foreach ($line in $wingetSearch) {
                if ($line -match "^Version:\s*(.*)") {
                    $wingetAppInfo.Version = $matches[1].Trim()
                }
                elseif ($line -match "^Publisher:\s*(.*)") {
                    $wingetAppInfo.Publisher = $matches[1].Trim()
                    # If we found a publisher but no name, use the package ID as the name
                    if (-not $wingetAppInfo.Name) {
                        $wingetAppInfo.Name = $PackageId.Split('.')[-1]  # Use the last part of the package ID
                    }
                }
            }
        }
    }
    
    if (-not $wingetAppInfo.Name) {
        Write-Log "Package '$PackageId' not found in Winget or could not be parsed." -Type "Error"
        exit 1
    }

    $appDisplayName = $wingetAppInfo.Name
    $appPublisher = $wingetAppInfo.Publisher
    $appVersion = $wingetAppInfo.Version
    $appDescription = $wingetAppInfo.Description
    $appHomepage = $wingetAppInfo.Homepage
    $installerUrl = $wingetAppInfo.InstallerUrl
    $installerHash = $wingetAppInfo.InstallerSha256
    $installerType = $wingetAppInfo.InstallerType
    $installCommand = $wingetAppInfo.InstallCommand
    $uninstallCommand = $wingetAppInfo.UninstallCommand

    # If we still don't have an installer URL, try to extract it directly from the raw output
    if (-not $installerUrl) {
        Write-Log "Attempting to extract installer URL directly from Winget output..." -Type "Info"
        foreach ($line in $wingetSearch) {
            $line = $line.ToString().Trim()
            if ($line -match "Installer Url:\s*(.*)") {
                $installerUrl = $matches[1].Trim()
                Write-Log "Found installer URL: $installerUrl" -Type "Verbose"
            }
            elseif ($line -match "Installer SHA256:\s*(.*)") {
                $installerHash = $matches[1].Trim()
            }
            elseif ($line -match "Installer Type:\s*(.*)") {
                $installerType = $matches[1].Trim()
                if ([string]::IsNullOrEmpty($installerType)) {
                    $installerType = "exe"  # Default to exe if not specified
                }
            }
        }
    }

    if (-not $installerUrl) {
        Write-Log "No suitable installer URL found for package '$PackageId'." -Type "Error"
        exit 1
    }

    Write-Log "Found Winget app: $appDisplayName (Version: $appVersion)" -Type "Info"
    Write-Log "Installer URL: $installerUrl" -Type "Info"
    Write-Log "Installer Type: $installerType" -Type "Info"
}
catch {
    Write-Log "Error getting Winget app details: $_" -Type "Error"
    exit 1
}

# Download the installer
$tempDir = Join-Path $PSScriptRoot "temp_winget_app"
if (-not (Test-Path $tempDir)) {
    New-Item -ItemType Directory -Path $tempDir | Out-Null
}

$installerFileName = [System.IO.Path]::GetFileName($installerUrl)
if ([string]::IsNullOrEmpty($installerFileName) -or $installerFileName -notmatch '\.(exe|msi|msix)$') {
    # Fallback if filename is not clear from URL
    $installerFileName = "$($appDisplayName.Replace(' ', ''))_$appVersion.$installerType"
}
$appFilePath = Join-Path $tempDir $installerFileName

Write-Log "Downloading installer to $appFilePath..." -Type "Info"
try {
    Invoke-WebRequest -Uri $installerUrl -OutFile $appFilePath -ErrorAction Stop
    Write-Log "Installer downloaded successfully." -Type "Info"

    # Validate hash (optional, but good practice)
    $downloadedHash = (Get-FileHash -Path $appFilePath -Algorithm SHA256).Hash
    if ($downloadedHash.ToLower() -ne $installerHash.ToLower()) {
        Write-Log "WARNING: Downloaded file hash does not match Winget manifest hash. Proceeding anyway." -Type "Warning"
    }
}
catch {
    Write-Log "Error downloading installer: $_" -Type "Error"
    exit 1
}

# Create Intune Win32 app package (requires IntuneWinAppUtil.exe)
# Look for IntuneWinAppUtil.exe in the script directory first
$intunewinAppUtilPath = Join-Path $PSScriptRoot "IntuneWinAppUtil.exe"
if (-not (Test-Path $intunewinAppUtilPath)) {
    # If not found in script directory, try to use from PATH
    $intunewinAppUtilPath = "IntuneWinAppUtil.exe"
    Write-Log "IntuneWinAppUtil.exe not found in script directory, will try to use from PATH" -Type "Verbose"
}
$outputIntunewinPath = Join-Path $tempDir "DiscordSetup.intunewin"

Write-Log "Creating IntuneWin package using $intunewinAppUtilPath..." -Type "Info"
try {
    # IntuneWinAppUtil.exe -c <source_folder> -s <setup_file> -o <output_folder> -q
    # For Winget, the source folder is the tempDir, setup file is the downloaded installer
    if (Test-Path $intunewinAppUtilPath) {
        # Use relative path with .\ prefix to ensure PowerShell can find it in the current directory
        if ($intunewinAppUtilPath -eq "IntuneWinAppUtil.exe") {
            $command = "& `".\$intunewinAppUtilPath`" -c `"$tempDir`" -s `"$installerFileName`" -o `"$tempDir`" -q"
        }
        else {
            $command = "& `"$intunewinAppUtilPath`" -c `"$tempDir`" -s `"$installerFileName`" -o `"$tempDir`" -q"
        }
        Write-Log "Executing command: $command" -Type "Verbose"
        Invoke-Expression $command | Out-Null
        Write-Log "IntuneWin package created: $outputIntunewinPath" -Type "Info"
    }
    else {
        throw "IntuneWinAppUtil.exe not found. Please ensure it's in the script directory or in your PATH."
    }
}
catch {
    Write-Log "Error creating IntuneWin package. Make sure IntuneWinAppUtil.exe is available and in PATH. Error: $_" -Type "Error"
    exit 1
}

# Upload to Intune
Write-Log "Uploading Win32 app to Intune..." -Type "Info"

# Define detection rules (example: file detection for exe/msi, bundle ID for msix)
$detectionRules = @()
if ($installerType -eq "msix") {
    # For MSIX, use bundle ID and version
    $detectionRules += @{
        "@odata.type"  = "#microsoft.graph.win32LobAppMsiProductCodeDetection"
        productCode    = $wingetAppInfo.ProductCode # Assuming ProductCode is available for MSIX
        productVersion = $appVersion
        detectionType  = "productCode"
    }
}
elseif ($installerType -eq "msi") {
    # For MSI, use MSI product code
    $detectionRules += @{
        "@odata.type"  = "#microsoft.graph.win32LobAppMsiProductCodeDetection"
        productCode    = $wingetAppInfo.ProductCode # Assuming ProductCode is available for MSI
        productVersion = $appVersion
        detectionType  = "productCode"
    }
}
else {
    # exe or other
    # For EXE, use a file detection rule (example: check for main executable)
    # This is a generic example, might need to be more specific per app
    $detectionRules += @{
        "@odata.type"    = "#microsoft.graph.win32LobAppFileSystemDetection"
        path             = "$($env:ProgramFiles)\$appDisplayName" # Example path
        fileOrFolderName = "$($appDisplayName.Replace(' ', '')).exe" # Example filename
        detectionType    = "exists"
    }
}

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
$installCommandLine = "msiexec /i `"$installerFileName`" /qn" # Default for MSI
$uninstallCommandLine = "msiexec /x `"$wingetAppInfo.ProductCode`" /qn" # Default for MSI

if ($installerType -eq "exe") {
    # For EXE, use the commands from Winget manifest if available, otherwise generic
    $installCommandLine = if ([string]::IsNullOrEmpty($installCommand)) { "`"$installerFileName`" /install /quiet /norestart" } else { $installCommand }
    $uninstallCommandLine = if ([string]::IsNullOrEmpty($uninstallCommand)) { "`"$installerFileName`" /uninstall /quiet /norestart" } else { $uninstallCommand }
}
elseif ($installerType -eq "msix") {
    # For MSIX, use Add-AppxPackage and Remove-AppxPackage
    $installCommandLine = "powershell.exe -ExecutionPolicy Bypass -Command Add-AppxPackage -Path `"$installerFileName`""
    $uninstallCommandLine = "powershell.exe -ExecutionPolicy Bypass -Command Remove-AppxPackage -Package `"$wingetAppInfo.PackageFamilyName`"" # Assuming PackageFamilyName is available
}

$newAppPayload = @{
    "@odata.type"                   = "#microsoft.graph.win32LobApp"
    displayName                     = $appDisplayName
    description                     = $appDescription
    publisher                       = $appPublisher
    fileName                        = [System.IO.Path]::GetFileName($outputIntunewinPath)
    installCommandLine              = $installCommandLine
    uninstallCommandLine            = $uninstallCommandLine
    applicableArchitectures         = "x64" # Assuming x64 for most Winget apps
    minimumSupportedOperatingSystem = $requirements.minimumSupportedOperatingSystem
    detectionRules                  = $detectionRules
    setupFilePath                   = $installerFileName # The setup file path within the .intunewin package
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
    # Add other relevant Win32 app properties as needed
    # For example, dependencies, supersedence
}

$createAppUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps"
$newApp = Invoke-MgGraphRequest -Method POST -Uri $createAppUri -Body ($newAppPayload | ConvertTo-Json -Depth 10)
Write-Log "Win32 App created successfully (ID: $($newApp.id))" -Type "Info"

Write-Log "🔒 Processing content version..." -Type "Info"
$contentVersionUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($newApp.id)/microsoft.graph.win32LobApp/contentVersions"
$contentVersion = Invoke-MgGraphRequest -Method POST -Uri $contentVersionUri -Body "{}"
Write-Log "Content version created (ID: $($contentVersion.id))" -Type "Info"

Write-Log "🔐 Encrypting application file..." -Type "Info"
$encryptedFilePath = "$outputIntunewinPath.bin"
if (Test-Path $encryptedFilePath) {
    Remove-Item $encryptedFilePath -Force
}
$fileEncryptionInfo = EncryptFile $outputIntunewinPath
Write-Log "File encryption complete" -Type "Info"

try {
    Write-Log "⬆️ Uploading to Azure Storage..." -Type "Info"
    $fileContent = @{
        "@odata.type" = "#microsoft.graph.mobileAppContentFile"
        name          = [System.IO.Path]::GetFileName($outputIntunewinPath)
        size          = (Get-Item $outputIntunewinPath).Length
        sizeEncrypted = (Get-Item "$outputIntunewinPath.bin").Length
        isDependency  = $false
    }

    Write-Log "Creating content file entry in Intune..." -Type "Info"
    $contentFileUri = "https://graph.microsoft.com/beta/deviceAppManagement/mobileApps/$($newApp.id)/microsoft.graph.win32LobApp/contentVersions/$($contentVersion.id)/files"  
    $contentFile = Invoke-MgGraphRequest -Method POST -Uri $contentFileUri -Body ($fileContent | ConvertTo-Json)
    Write-Log "Content file entry created successfully" -Type "Info"

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
    UploadFileToAzureStorage $fileStatus.azureStorageUri "$outputIntunewinPath.bin"
    Write-Log "Upload to Azure Storage complete" -Type "Info"
}
catch {
    Write-Log "Failed during upload process: $_" -Type "Error"
    throw
}

Write-Log "🔄 Committing file to Intune..." -Type "Info"
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
    Write-Log "✅ File committed successfully" -Type "Info"
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

# Handle assignments (if CopyAssignments switch is used)
if ($CopyAssignments) {
    Write-Log "Assignments are not yet implemented for Win32 apps in Intuneget. Skipping assignment copy." -Type "Warning"
    # This would require fetching existing Win32 app assignments and applying them,
    # which is different from macOS app assignments.
    # For now, it's a placeholder.
}

# Add logo (placeholder, Winget doesn't directly provide logos in this format)
Add-IntuneAppLogo -appId $newApp.id -appName $appDisplayName -appType "win32LobApp" -localLogoPath $null

Write-Log "🧹 Cleaning up temporary files..." -Type "Info"
try {
    Remove-Item $tempDir -Recurse -Force -ErrorAction Stop
    Write-Log "Cleaned up temporary directory: $tempDir" -Type "Info"
}
catch {
    Write-Log "Warning: Could not remove temporary directory $tempDir. Error: $_" -Type "Warning"
}

Write-Log "Successfully processed $appDisplayName" -Type "Info"
Write-Log "App is now available in Intune Portal: https://intune.microsoft.com/#view/Microsoft_Intune_Apps/SettingsMenu/~/0/appId/$($newApp.id)" -Type "Info"
Write-Log " " -Type "Info"

Write-Log "All operations completed successfully!" -Type "Info"
Write-Log "Disconnecting from Microsoft Graph" -Type "Info"
Disconnect-MgGraph > $null 2>&1