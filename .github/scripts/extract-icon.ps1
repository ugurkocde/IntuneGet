<#
.SYNOPSIS
    Extracts icons from Windows installers (EXE, MSI, MSIX)

.DESCRIPTION
    This script extracts application icons from installer files and converts
    them to PNG format at multiple sizes (16, 32, 64, 128, 256 pixels).

.PARAMETER InstallerPath
    Path to the installer file (EXE, MSI, or MSIX)

.PARAMETER OutputDir
    Directory where extracted icons will be saved

.PARAMETER AppId
    Application identifier (used for logging)

.EXAMPLE
    .\extract-icon.ps1 -InstallerPath "C:\temp\installer.exe" -OutputDir "C:\icons\MyApp" -AppId "Publisher.App"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [string]$InstallerPath,

    [Parameter(Mandatory=$true)]
    [string]$OutputDir,

    [Parameter(Mandatory=$false)]
    [string]$AppId = "Unknown"
)

$ErrorActionPreference = 'Stop'

# Icon sizes to generate
$IconSizes = @(16, 32, 64, 128, 256)

# Ensure output directory exists
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

function Extract-IconFromExe {
    param(
        [string]$ExePath,
        [string]$OutputDir
    )

    Write-Host "Extracting icon from EXE: $ExePath"

    Add-Type -AssemblyName System.Drawing

    # Add Win32 API for high-resolution icon extraction
    $signature = @"
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int PrivateExtractIcons(
        string lpszFile,
        int nIconIndex,
        int cxIcon,
        int cyIcon,
        IntPtr[] phicon,
        int[] piconid,
        int nIcons,
        int flags
    );

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr hIcon);
"@

    try {
        Add-Type -MemberDefinition $signature -Name "IconExtractor" -Namespace "Win32" -ErrorAction SilentlyContinue
    } catch {
        # Type might already be added
    }

    # Try to extract high-resolution icon (256x256, then 128, 64, 48, 32)
    $sizes = @(256, 128, 64, 48, 32)

    foreach ($size in $sizes) {
        try {
            $iconHandles = New-Object IntPtr[] 1
            $iconIds = New-Object int[] 1

            $count = [Win32.IconExtractor]::PrivateExtractIcons(
                $ExePath,
                0,          # First icon
                $size,      # Width
                $size,      # Height
                $iconHandles,
                $iconIds,
                1,          # Number of icons
                0           # Flags
            )

            if ($count -gt 0 -and $iconHandles[0] -ne [IntPtr]::Zero) {
                $icon = [System.Drawing.Icon]::FromHandle($iconHandles[0])
                $bitmap = $icon.ToBitmap()

                # Check if we got a decent size
                if ($bitmap.Width -ge $size -or $bitmap.Width -ge 48) {
                    $tempIconPath = Join-Path $OutputDir "icon-original.png"
                    $bitmap.Save($tempIconPath, [System.Drawing.Imaging.ImageFormat]::Png)

                    Write-Host "Extracted ${size}x${size} icon (actual: $($bitmap.Width)x$($bitmap.Height))"

                    $bitmap.Dispose()
                    $icon.Dispose()
                    [Win32.IconExtractor]::DestroyIcon($iconHandles[0]) | Out-Null

                    return $tempIconPath
                }

                $bitmap.Dispose()
                $icon.Dispose()
                [Win32.IconExtractor]::DestroyIcon($iconHandles[0]) | Out-Null
            }
        } catch {
            Write-Host "Failed to extract ${size}x${size} icon: $_"
        }
    }

    # Fallback: Use basic .NET extraction (small icon)
    Write-Host "Falling back to basic icon extraction..."
    try {
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($ExePath)

        if ($icon) {
            $bitmap = $icon.ToBitmap()
            $tempIconPath = Join-Path $OutputDir "icon-original.png"
            $w = $bitmap.Width
            $h = $bitmap.Height
            $bitmap.Save($tempIconPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $bitmap.Dispose()
            $icon.Dispose()

            Write-Host "Extracted fallback icon to $tempIconPath (size: ${w}x${h})"
            return $tempIconPath
        }
    } catch {
        Write-Warning "Failed to extract icon using .NET: $_"
    }

    return $null
}

function Extract-IconFromMsi {
    param(
        [string]$MsiPath,
        [string]$OutputDir
    )

    Write-Host "Extracting icon from MSI: $MsiPath"

    # Extract MSI to temp folder and find executables/icons
    $tempExtract = Join-Path $env:TEMP "msi_extract_$([System.IO.Path]::GetRandomFileName())"
    New-Item -ItemType Directory -Path $tempExtract -Force | Out-Null

    try {
        $extracted = $false

        # Method 1: Try 7-Zip first (handles enterprise MSIs better)
        $sevenZipPaths = @(
            "C:\Program Files\7-Zip\7z.exe",
            "C:\Program Files (x86)\7-Zip\7z.exe",
            (Get-Command 7z -ErrorAction SilentlyContinue).Source
        ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1

        if ($sevenZipPaths) {
            Write-Host "Using 7-Zip for extraction: $sevenZipPaths"
            $process = Start-Process -FilePath $sevenZipPaths `
                -ArgumentList "x `"$MsiPath`" -o`"$tempExtract`" -y" `
                -Wait -PassThru -NoNewWindow -RedirectStandardOutput "$env:TEMP\7z_out.txt" -RedirectStandardError "$env:TEMP\7z_err.txt"

            if ($process.ExitCode -eq 0) {
                Write-Host "7-Zip extraction successful"
                $extracted = $true

                # 7-Zip extracts CAB files separately, so extract any CABs found
                $cabFiles = @(Get-ChildItem -Path $tempExtract -Filter "*.cab" -Recurse -ErrorAction SilentlyContinue)
                foreach ($cab in $cabFiles) {
                    $cabExtractDir = Join-Path $tempExtract "cab_$([System.IO.Path]::GetFileNameWithoutExtension($cab.Name))"
                    New-Item -ItemType Directory -Path $cabExtractDir -Force | Out-Null
                    Start-Process -FilePath $sevenZipPaths `
                        -ArgumentList "x `"$($cab.FullName)`" -o`"$cabExtractDir`" -y" `
                        -Wait -NoNewWindow -RedirectStandardOutput "$env:TEMP\7z_cab_out.txt" -RedirectStandardError "$env:TEMP\7z_cab_err.txt"
                }
            } else {
                Write-Host "7-Zip extraction failed with exit code: $($process.ExitCode)"
            }
        }

        # Method 2: Fall back to msiexec if 7-Zip failed or not available
        if (-not $extracted) {
            Write-Host "Trying msiexec extraction..."
            $process = Start-Process -FilePath "msiexec.exe" `
                -ArgumentList "/a `"$MsiPath`" /qn TARGETDIR=`"$tempExtract`"" `
                -Wait -PassThru -NoNewWindow

            if ($process.ExitCode -eq 0) {
                Write-Host "msiexec extraction successful"
                $extracted = $true
            } else {
                Write-Host "msiexec extraction failed with exit code: $($process.ExitCode)"
            }
        }

        if ($extracted) {
            Write-Host "MSI extracted to $tempExtract"

            # Search for icons in extracted content
            $iconPath = Search-ExtractedContentForIcon -ExtractDir $tempExtract -OutputDir $OutputDir
            if ($iconPath) {
                return $iconPath
            }
        }

        # Method 3: Try to extract icon directly from MSI as a resource
        Write-Host "Trying direct resource extraction from MSI..."
        $iconPath = Extract-IconFromMsiResource -MsiPath $MsiPath -OutputDir $OutputDir
        if ($iconPath) {
            return $iconPath
        }

    } catch {
        Write-Warning "MSI extraction failed: $_"
    } finally {
        if (Test-Path $tempExtract) {
            Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    return $null
}

function Search-ExtractedContentForIcon {
    param(
        [string]$ExtractDir,
        [string]$OutputDir
    )

    # Verify extraction directory exists and has content
    if (-not (Test-Path $ExtractDir)) {
        Write-Host "Extraction directory does not exist"
        return $null
    }

    # First, look for ICO files
    $icoFiles = @(Get-ChildItem -Path $ExtractDir -Filter "*.ico" -Recurse -ErrorAction SilentlyContinue)
    Write-Host "Found $($icoFiles.Count) ICO files"
    if ($icoFiles.Count -gt 0) {
        $largestIco = $icoFiles | Sort-Object Length -Descending | Select-Object -First 1
        if ($largestIco -and $largestIco.FullName) {
            $destPath = Join-Path $OutputDir "icon-original.ico"
            Copy-Item $largestIco.FullName -Destination $destPath -Force
            Write-Host "Found ICO file: $($largestIco.Name)"
            return $destPath
        }
    }

    # Look for PNG files (some MSIs include PNG icons)
    $pngFiles = @(Get-ChildItem -Path $ExtractDir -Filter "*.png" -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -match 'icon|logo|app' -or $_.Length -gt 1000 })
    Write-Host "Found $($pngFiles.Count) PNG files"
    if ($pngFiles.Count -gt 0) {
        # Prefer files with icon/logo in the name, then largest
        $bestPng = $pngFiles | Where-Object { $_.Name -match 'icon|logo' } | Sort-Object Length -Descending | Select-Object -First 1
        if (-not $bestPng) {
            $bestPng = $pngFiles | Sort-Object Length -Descending | Select-Object -First 1
        }
        if ($bestPng -and $bestPng.FullName) {
            $destPath = Join-Path $OutputDir "icon-original.png"
            Copy-Item $bestPng.FullName -Destination $destPath -Force
            Write-Host "Found PNG file: $($bestPng.Name)"
            return $destPath
        }
    }

    # Find executables in extracted content
    $exeFiles = @(Get-ChildItem -Path $ExtractDir -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.Length -gt 10000 } |
                Sort-Object Length -Descending)

    Write-Host "Found $($exeFiles.Count) EXE files"

    foreach ($exe in $exeFiles) {
        if ($exe -and $exe.FullName) {
            Write-Host "Trying to extract icon from: $($exe.Name)"
            $iconPath = Extract-IconFromExe -ExePath $exe.FullName -OutputDir $OutputDir
            if ($iconPath) {
                return $iconPath
            }
        }
    }

    return $null
}

function Extract-IconFromMsiResource {
    param(
        [string]$MsiPath,
        [string]$OutputDir
    )

    # Use native msi.dll P/Invoke to read binary streams from MSI Icon table.
    # COM interop's Record.ReadStream does not work from PowerShell.
    $msiSignature = @"
    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiOpenDatabase(string szDatabasePath, IntPtr szPersist, out IntPtr phDatabase);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiDatabaseOpenView(IntPtr hDatabase, string szQuery, out IntPtr phView);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiViewExecute(IntPtr hView, IntPtr hRecord);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiViewFetch(IntPtr hView, out IntPtr phRecord);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiRecordGetString(IntPtr hRecord, uint iField, System.Text.StringBuilder szValueBuf, ref uint pcchValueBuf);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiRecordDataSize(IntPtr hRecord, uint iField);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiRecordReadStream(IntPtr hRecord, uint iField, byte[] szDataBuf, ref uint pcbDataBuf);

    [DllImport("msi.dll", CharSet = CharSet.Unicode)]
    public static extern uint MsiCloseHandle(IntPtr hAny);
"@

    try {
        Add-Type -MemberDefinition $msiSignature -Name "MsiNative" -Namespace "Win32" -ErrorAction SilentlyContinue
    } catch {
        # Type might already be added
    }

    try {
        $hDatabase = [IntPtr]::Zero
        # MSIDBOPEN_READONLY = 0
        $result = [Win32.MsiNative]::MsiOpenDatabase($MsiPath, [IntPtr]::Zero, [ref]$hDatabase)
        if ($result -ne 0) {
            Write-Host "MsiOpenDatabase failed with error $result"
            return $null
        }

        $hView = [IntPtr]::Zero
        $result = [Win32.MsiNative]::MsiDatabaseOpenView($hDatabase, "SELECT Name, Data FROM Icon", [ref]$hView)
        if ($result -ne 0) {
            Write-Host "No Icon table in MSI (error $result)"
            [Win32.MsiNative]::MsiCloseHandle($hDatabase) | Out-Null
            return $null
        }

        $result = [Win32.MsiNative]::MsiViewExecute($hView, [IntPtr]::Zero)
        if ($result -ne 0) {
            Write-Host "MsiViewExecute failed with error $result"
            [Win32.MsiNative]::MsiCloseHandle($hView) | Out-Null
            [Win32.MsiNative]::MsiCloseHandle($hDatabase) | Out-Null
            return $null
        }

        $hRecord = [IntPtr]::Zero
        while (([Win32.MsiNative]::MsiViewFetch($hView, [ref]$hRecord)) -eq 0) {
            try {
                # Read icon name (field 1)
                $nameBufSize = [uint32]256
                $nameBuf = New-Object System.Text.StringBuilder 256
                [Win32.MsiNative]::MsiRecordGetString($hRecord, 1, $nameBuf, [ref]$nameBufSize) | Out-Null
                $iconName = $nameBuf.ToString()
                Write-Host "Found embedded icon: $iconName"

                # Get stream size (field 2)
                $streamSize = [Win32.MsiNative]::MsiRecordDataSize($hRecord, 2)
                if ($streamSize -eq 0) {
                    Write-Host "Icon entry '$iconName' has empty data, trying next..."
                    [Win32.MsiNative]::MsiCloseHandle($hRecord) | Out-Null
                    continue
                }

                # Read the binary stream
                $buffer = New-Object byte[] $streamSize
                $bufSize = [uint32]$streamSize
                $result = [Win32.MsiNative]::MsiRecordReadStream($hRecord, 2, $buffer, [ref]$bufSize)
                if ($result -ne 0) {
                    Write-Warning "MsiRecordReadStream failed with error $result"
                    [Win32.MsiNative]::MsiCloseHandle($hRecord) | Out-Null
                    continue
                }

                $iconPath = Join-Path $OutputDir "icon-original.ico"
                [System.IO.File]::WriteAllBytes($iconPath, $buffer)
                $written = (Get-Item $iconPath).Length
                Write-Host "Extracted embedded icon from MSI ($written bytes)"

                if ($written -lt 6) {
                    Write-Warning "Icon file is suspiciously small ($written bytes), skipping"
                    Remove-Item $iconPath -Force -ErrorAction SilentlyContinue
                    [Win32.MsiNative]::MsiCloseHandle($hRecord) | Out-Null
                    continue
                }

                # Success - clean up and return
                [Win32.MsiNative]::MsiCloseHandle($hRecord) | Out-Null
                [Win32.MsiNative]::MsiCloseHandle($hView) | Out-Null
                [Win32.MsiNative]::MsiCloseHandle($hDatabase) | Out-Null
                return $iconPath
            } catch {
                Write-Warning "Failed to read icon data: $_"
            }
            [Win32.MsiNative]::MsiCloseHandle($hRecord) | Out-Null
        }

        [Win32.MsiNative]::MsiCloseHandle($hView) | Out-Null
        [Win32.MsiNative]::MsiCloseHandle($hDatabase) | Out-Null
    } catch {
        Write-Host "Could not extract icon from MSI resource: $_"
    }

    return $null
}

function Extract-IconFromMsix {
    param(
        [string]$MsixPath,
        [string]$OutputDir
    )

    Write-Host "Extracting icon from MSIX: $MsixPath"

    $tempExtract = Join-Path $env:TEMP "msix_extract_$([System.IO.Path]::GetRandomFileName())"

    try {
        # MSIX is a ZIP file
        Expand-Archive -Path $MsixPath -DestinationPath $tempExtract -Force

        # Look for app icons in Assets folder
        $assetPatterns = @(
            "Assets\*logo*.png",
            "Assets\*icon*.png",
            "Assets\*Square*.png",
            "Assets\*AppList*.png",
            "Images\*logo*.png",
            "Images\*icon*.png",
            "*.png"
        )

        foreach ($pattern in $assetPatterns) {
            $icons = Get-ChildItem -Path $tempExtract -Filter $pattern -Recurse -ErrorAction SilentlyContinue |
                     Sort-Object Length -Descending |
                     Select-Object -First 1

            if ($icons) {
                $destPath = Join-Path $OutputDir "icon-original.png"
                Copy-Item $icons.FullName -Destination $destPath -Force
                Write-Host "Found MSIX icon: $($icons.Name)"
                return $destPath
            }
        }

        # Check AppxManifest for logo path
        $manifestPath = Join-Path $tempExtract "AppxManifest.xml"
        if (Test-Path $manifestPath) {
            [xml]$manifest = Get-Content $manifestPath
            $logoPath = $manifest.Package.Properties.Logo

            if ($logoPath) {
                $fullLogoPath = Join-Path $tempExtract $logoPath
                if (Test-Path $fullLogoPath) {
                    $destPath = Join-Path $OutputDir "icon-original.png"
                    Copy-Item $fullLogoPath -Destination $destPath -Force
                    return $destPath
                }
            }
        }
    } catch {
        Write-Warning "MSIX extraction failed: $_"
    } finally {
        if (Test-Path $tempExtract) {
            Remove-Item $tempExtract -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    return $null
}

function Convert-ToMultipleSizes {
    param(
        [string]$SourcePath,
        [string]$OutputDir,
        [int[]]$Sizes
    )

    Write-Host "Converting icon to multiple sizes..."

    # Check if ImageMagick is available
    $magick = Get-Command "magick" -ErrorAction SilentlyContinue
    if (-not $magick) {
        $magick = Get-Command "convert" -ErrorAction SilentlyContinue
    }

    $generatedFiles = @()

    # Determine if source is a multi-frame format (ICO, TIFF)
    $sourceExt = [System.IO.Path]::GetExtension($SourcePath).ToLower()
    $isMultiFrame = $sourceExt -in @('.ico', '.tif', '.tiff')

    foreach ($size in $Sizes) {
        $outputPath = Join-Path $OutputDir "icon-$size.png"
        $conversionSucceeded = $false

        # Try ImageMagick first (if available)
        if ($magick) {
            try {
                # Use [0] frame index for multi-frame formats to select the first frame
                $sourceArg = if ($isMultiFrame) { "${SourcePath}[0]" } else { $SourcePath }
                & magick $sourceArg -resize "${size}x${size}" -background none -gravity center -extent "${size}x${size}" $outputPath 2>$null
                if ($LASTEXITCODE -eq 0 -and (Test-Path $outputPath)) {
                    $generatedFiles += $outputPath
                    $conversionSucceeded = $true
                    Write-Host "Generated $outputPath (ImageMagick)"
                }
            } catch {
                Write-Host "ImageMagick failed for size ${size}, trying .NET fallback..."
            }
        }

        # Fall back to .NET if ImageMagick was unavailable or failed
        if (-not $conversionSucceeded) {
            try {
                Add-Type -AssemblyName System.Drawing

                $sourceImage = [System.Drawing.Image]::FromFile($SourcePath)
                $destRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
                $destImage = New-Object System.Drawing.Bitmap($size, $size)

                $graphics = [System.Drawing.Graphics]::FromImage($destImage)
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.DrawImage($sourceImage, $destRect)

                $destImage.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

                $graphics.Dispose()
                $destImage.Dispose()
                $sourceImage.Dispose()

                $generatedFiles += $outputPath
                Write-Host "Generated $outputPath (using .NET fallback)"
            } catch {
                Write-Warning ".NET conversion failed for size $size : $_"
            }
        }
    }

    return $generatedFiles
}

# Main execution
Write-Host "=== Icon Extraction for $AppId ===" -ForegroundColor Cyan
Write-Host "Installer: $InstallerPath"
Write-Host "Output: $OutputDir"

$iconPath = $null
$extension = [System.IO.Path]::GetExtension($InstallerPath).ToLower()

switch ($extension) {
    ".exe" {
        $iconPath = Extract-IconFromExe -ExePath $InstallerPath -OutputDir $OutputDir
    }
    ".msi" {
        $iconPath = Extract-IconFromMsi -MsiPath $InstallerPath -OutputDir $OutputDir
    }
    ".msix" {
        $iconPath = Extract-IconFromMsix -MsixPath $InstallerPath -OutputDir $OutputDir
    }
    ".appx" {
        $iconPath = Extract-IconFromMsix -MsixPath $InstallerPath -OutputDir $OutputDir
    }
    default {
        # Try as EXE
        $iconPath = Extract-IconFromExe -ExePath $InstallerPath -OutputDir $OutputDir
    }
}

if ($iconPath -and (Test-Path $iconPath)) {
    Write-Host "Extracted icon: $iconPath" -ForegroundColor Green

    # Convert to multiple sizes
    $generatedFiles = Convert-ToMultipleSizes -SourcePath $iconPath -OutputDir $OutputDir -Sizes $IconSizes

    if ($generatedFiles.Count -gt 0) {
        Write-Host "Generated $($generatedFiles.Count) icon sizes" -ForegroundColor Green

        # Clean up original if it's not one of the standard sizes
        if ($iconPath -notmatch "icon-\d+\.png$") {
            Remove-Item $iconPath -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Warning "Failed to generate icon sizes"
        exit 1
    }
} else {
    Write-Warning "No icon could be extracted from $InstallerPath"
    exit 1
}

Write-Host "=== Icon extraction complete ===" -ForegroundColor Cyan
