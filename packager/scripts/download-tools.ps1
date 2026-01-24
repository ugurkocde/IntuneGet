<#
.SYNOPSIS
    Downloads required tools for IntuneGet Packager

.DESCRIPTION
    This script downloads IntuneWinAppUtil.exe and PSAppDeployToolkit
    to the specified tools directory.

.PARAMETER ToolsDir
    The directory where tools should be downloaded

.EXAMPLE
    .\download-tools.ps1 -ToolsDir "C:\IntuneGet\tools"
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$ToolsDir
)

$ErrorActionPreference = "Stop"

# Create tools directory if it doesn't exist
if (-not (Test-Path $ToolsDir)) {
    New-Item -ItemType Directory -Path $ToolsDir -Force | Out-Null
    Write-Host "Created tools directory: $ToolsDir"
}

# Download IntuneWinAppUtil.exe
$intuneWinUtilPath = Join-Path $ToolsDir "IntuneWinAppUtil.exe"
if (-not (Test-Path $intuneWinUtilPath)) {
    Write-Host "Downloading IntuneWinAppUtil.exe..."
    $intuneWinUtilUrl = "https://github.com/microsoft/Microsoft-Win32-Content-Prep-Tool/raw/master/IntuneWinAppUtil.exe"

    try {
        Invoke-WebRequest -Uri $intuneWinUtilUrl -OutFile $intuneWinUtilPath -UseBasicParsing
        Write-Host "Downloaded IntuneWinAppUtil.exe successfully"
    }
    catch {
        Write-Error "Failed to download IntuneWinAppUtil.exe: $_"
        exit 1
    }
}
else {
    Write-Host "IntuneWinAppUtil.exe already exists"
}

# Download PSAppDeployToolkit
$psadtDir = Join-Path $ToolsDir "PSAppDeployToolkit"
if (-not (Test-Path $psadtDir)) {
    Write-Host "Downloading PSAppDeployToolkit..."
    $psadtZipPath = Join-Path $ToolsDir "psadt.zip"
    $psadtUrl = "https://github.com/PSAppDeployToolkit/PSAppDeployToolkit/releases/download/4.1.8/PSAppDeployToolkit_Template_v4.zip"

    try {
        Invoke-WebRequest -Uri $psadtUrl -OutFile $psadtZipPath -UseBasicParsing
        Write-Host "Downloaded PSAppDeployToolkit archive"

        # Extract the archive
        Write-Host "Extracting PSAppDeployToolkit..."
        Expand-Archive -Path $psadtZipPath -DestinationPath $psadtDir -Force
        Write-Host "Extracted PSAppDeployToolkit successfully"

        # Cleanup zip file
        Remove-Item -Path $psadtZipPath -Force
    }
    catch {
        Write-Error "Failed to download/extract PSAppDeployToolkit: $_"
        exit 1
    }
}
else {
    Write-Host "PSAppDeployToolkit already exists"
}

Write-Host ""
Write-Host "All tools downloaded successfully!"
Write-Host "Tools directory: $ToolsDir"
