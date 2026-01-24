<#
.SYNOPSIS
    Lightweight installation change detection for Windows apps

.DESCRIPTION
    Instead of full system snapshots, this script:
    1. Captures baseline (services, uninstall keys)
    2. After install, finds new uninstall entry
    3. Lists files in install directory only
    4. Checks Start Menu for new shortcuts
    5. Compares services

.PARAMETER Mode
    - "baseline": Capture pre-install baseline (services, uninstall keys)
    - "analyze": Analyze changes after installation

.PARAMETER Baseline
    The baseline object from a previous "baseline" call (for "analyze" mode)

.PARAMETER AppName
    Optional app name hint to help find the correct uninstall entry

.EXAMPLE
    $baseline = .\snapshot.ps1 -Mode "baseline"
    # ... install app ...
    $changes = .\snapshot.ps1 -Mode "analyze" -Baseline $baseline -AppName "Firefox"
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("baseline", "analyze")]
    [string]$Mode,

    [Parameter(Mandatory=$false)]
    [object]$Baseline,

    [Parameter(Mandatory=$false)]
    [string]$AppName = ""
)

$ErrorActionPreference = 'Continue'

function Get-UninstallKeys {
    $keys = @()
    $paths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )

    foreach ($path in $paths) {
        try {
            $items = Get-ItemProperty $path -ErrorAction SilentlyContinue |
                     Where-Object { $_.DisplayName } |
                     Select-Object PSPath, DisplayName, DisplayVersion, Publisher,
                                   InstallLocation, UninstallString, EstimatedSize,
                                   InstallDate, QuietUninstallString, ModifyPath,
                                   InstallSource, URLInfoAbout, URLUpdateInfo,
                                   HelpLink, Comments,
                                   @{N='KeyName';E={Split-Path $_.PSPath -Leaf}},
                                   @{N='RegistryPath';E={$_.PSPath -replace 'Microsoft.PowerShell.Core\\Registry::', ''}}
            if ($items) {
                $keys += $items
            }
        } catch {}
    }
    return $keys
}

function Get-ServicesList {
    Get-Service -ErrorAction SilentlyContinue |
    Select-Object Name, DisplayName, Status, StartType |
    Sort-Object Name
}

function Get-StartMenuShortcuts {
    $shortcuts = @()
    $paths = @(
        "$env:ProgramData\Microsoft\Windows\Start Menu\Programs",
        "$env:APPDATA\Microsoft\Windows\Start Menu\Programs",
        "$env:PUBLIC\Desktop",
        "$env:USERPROFILE\Desktop"
    )

    foreach ($path in $paths) {
        if (Test-Path $path) {
            $items = Get-ChildItem -Path $path -Filter "*.lnk" -Recurse -ErrorAction SilentlyContinue |
                     Select-Object Name, FullName, CreationTime, LastWriteTime
            if ($items) {
                $shortcuts += $items
            }
        }
    }
    return $shortcuts
}

function Get-DirectorySize {
    param([string]$Path)

    if (-not $Path -or -not (Test-Path $Path)) { return 0 }

    try {
        $size = (Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue |
                 Measure-Object -Property Length -Sum).Sum
        return [long]($size ?? 0)
    } catch {
        return 0
    }
}

function Get-DirectoryFiles {
    param([string]$Path, [int]$MaxFiles = 500)

    if (-not $Path -or -not (Test-Path $Path)) { return @() }

    try {
        $files = Get-ChildItem -Path $Path -Recurse -File -ErrorAction SilentlyContinue |
                 Select-Object -First $MaxFiles |
                 ForEach-Object {
                     @{
                         path = $_.FullName.Replace($Path, '').TrimStart('\')
                         size = $_.Length
                         extension = $_.Extension
                     }
                 }
        return @($files)
    } catch {
        return @()
    }
}

# Main logic
switch ($Mode) {
    "baseline" {
        Write-Host "Capturing baseline..."

        $baseline = @{
            timestamp = Get-Date -Format "o"
            uninstall_keys = @(Get-UninstallKeys | ForEach-Object { $_.KeyName })
            services = @(Get-ServicesList | ForEach-Object { $_.Name })
            shortcuts = @(Get-StartMenuShortcuts | ForEach-Object { $_.FullName })
        }

        Write-Host "Baseline captured: $($baseline.uninstall_keys.Count) uninstall keys, $($baseline.services.Count) services, $($baseline.shortcuts.Count) shortcuts"

        # Debug: Show some baseline keys
        if ($baseline.uninstall_keys.Count -gt 0) {
            Write-Host "Sample baseline keys (first 5):"
            $baseline.uninstall_keys | Select-Object -First 5 | ForEach-Object { Write-Host "  - $_" }
        }

        return $baseline
    }

    "analyze" {
        if (-not $Baseline) {
            throw "Baseline parameter is required for analyze mode"
        }

        Write-Host "Analyzing changes..."

        # Get current state
        $currentUninstallKeys = Get-UninstallKeys
        $currentServices = Get-ServicesList
        $currentShortcuts = Get-StartMenuShortcuts

        # Debug: Check baseline type and count
        Write-Host "Baseline type: $($Baseline.GetType().Name)"
        Write-Host "Baseline uninstall_keys count: $($Baseline.uninstall_keys.Count)"
        Write-Host "Current uninstall keys count: $($currentUninstallKeys.Count)"

        # Debug: Show sample of current keys
        Write-Host "Sample current keys (first 5):"
        $currentUninstallKeys | Select-Object -First 5 | ForEach-Object { Write-Host "  - $($_.KeyName)" }

        # Find new uninstall entries
        $newKeys = $currentUninstallKeys | Where-Object {
            $_.KeyName -notin $Baseline.uninstall_keys
        }

        Write-Host "Found $($newKeys.Count) new uninstall entries"

        # Debug: If new keys found, show them
        if ($newKeys.Count -gt 0) {
            Write-Host "New entries found:"
            $newKeys | ForEach-Object { Write-Host "  - $($_.KeyName): $($_.DisplayName)" }
        } else {
            # Debug: Show what we're comparing
            Write-Host "No new keys detected. Checking for partial matches..."
            $recentKeys = $currentUninstallKeys | Where-Object {
                $_.DisplayName -like "*$AppName*"
            }
            if ($recentKeys.Count -gt 0) {
                Write-Host "Keys matching app name '$AppName':"
                $recentKeys | ForEach-Object {
                    $inBaseline = $_.KeyName -in $Baseline.uninstall_keys
                    Write-Host "  - $($_.KeyName) (in baseline: $inBaseline)"
                }
            }
        }

        # Find the most relevant entry (by app name if provided)
        $appEntry = $null
        if ($newKeys.Count -gt 0) {
            if ($AppName) {
                # Try exact match first
                $appEntry = $newKeys | Where-Object {
                    $_.DisplayName -like "*$AppName*" -or
                    $_.KeyName -like "*$AppName*"
                } | Select-Object -First 1
            }
            if (-not $appEntry) {
                # Take the first new entry
                $appEntry = $newKeys | Select-Object -First 1
            }
        }

        # Fallback: If no new keys found, try to find by app name in current keys
        if (-not $appEntry -and $AppName) {
            Write-Host "Attempting fallback: searching for app by name..."
            $appEntry = $currentUninstallKeys | Where-Object {
                $_.DisplayName -like "*$AppName*" -or
                $_.KeyName -like "*$AppName*"
            } | Select-Object -First 1

            if ($appEntry) {
                Write-Host "Fallback found: $($appEntry.DisplayName) ($($appEntry.KeyName))"
            }
        }

        # Build detailed registry entry for the app
        $appRegistryEntry = $null
        if ($appEntry) {
            $appRegistryEntry = @{
                key_name = $appEntry.KeyName
                registry_path = $appEntry.RegistryPath
                display_name = $appEntry.DisplayName
                display_version = $appEntry.DisplayVersion
                publisher = $appEntry.Publisher
                install_location = $appEntry.InstallLocation
                uninstall_string = $appEntry.UninstallString
                quiet_uninstall_string = $appEntry.QuietUninstallString
                modify_path = $appEntry.ModifyPath
                install_source = $appEntry.InstallSource
                install_date = $appEntry.InstallDate
                estimated_size_kb = $appEntry.EstimatedSize
                url_info_about = $appEntry.URLInfoAbout
                url_update_info = $appEntry.URLUpdateInfo
                help_link = $appEntry.HelpLink
                comments = $appEntry.Comments
                detection_method = if ($newKeys.Count -gt 0 -and $appEntry.KeyName -in ($newKeys | ForEach-Object { $_.KeyName })) { "new_key" } else { "fallback_search" }
            }
        }

        # Build result
        $result = @{
            timestamp = Get-Date -Format "o"
            app_found = $null -ne $appEntry
            display_name = $appEntry.DisplayName
            version = $appEntry.DisplayVersion
            publisher = $appEntry.Publisher
            install_path = $appEntry.InstallLocation
            uninstall_string = $appEntry.UninstallString
            quiet_uninstall_string = $appEntry.QuietUninstallString
            estimated_size_kb = $appEntry.EstimatedSize
            registry_key = $appEntry.KeyName

            # Files in install directory
            files = @()
            file_count = 0
            total_size_bytes = 0

            # New shortcuts
            shortcuts_created = @()

            # New services
            services_created = @()

            # Detailed registry entry for the main app
            app_registry_entry = $appRegistryEntry

            # All new uninstall entries (in case multiple components installed)
            all_new_entries = @($newKeys | ForEach-Object {
                @{
                    key_name = $_.KeyName
                    registry_path = $_.RegistryPath
                    display_name = $_.DisplayName
                    display_version = $_.DisplayVersion
                    publisher = $_.Publisher
                    install_location = $_.InstallLocation
                    uninstall_string = $_.UninstallString
                    quiet_uninstall_string = $_.QuietUninstallString
                    estimated_size_kb = $_.EstimatedSize
                }
            })
        }

        # Get files from install directory
        if ($appEntry -and $appEntry.InstallLocation -and (Test-Path $appEntry.InstallLocation)) {
            Write-Host "Scanning install directory: $($appEntry.InstallLocation)"
            $result.files = @(Get-DirectoryFiles -Path $appEntry.InstallLocation)
            $result.file_count = $result.files.Count
            $result.total_size_bytes = Get-DirectorySize -Path $appEntry.InstallLocation
            Write-Host "Found $($result.file_count) files, $('{0:N2}' -f ($result.total_size_bytes / 1MB)) MB"
        } elseif ($appEntry -and $appEntry.EstimatedSize) {
            # Use estimated size from registry if no install path
            $result.total_size_bytes = $appEntry.EstimatedSize * 1024
            Write-Host "Using estimated size from registry: $('{0:N2}' -f ($result.total_size_bytes / 1MB)) MB"
        }

        # Find new shortcuts (multiple detection methods)
        $baselineTime = [DateTime]::Parse($Baseline.timestamp)

        # Method 1: Shortcuts not in baseline list
        $newShortcutsByList = $currentShortcuts | Where-Object {
            $_.FullName -notin $Baseline.shortcuts
        }

        # Method 2: Shortcuts created after baseline timestamp
        $newShortcutsByTime = $currentShortcuts | Where-Object {
            $_.CreationTime -gt $baselineTime -or $_.LastWriteTime -gt $baselineTime
        }

        # Method 3: Shortcuts matching app name (if provided)
        $newShortcutsByName = @()
        if ($AppName -and $appEntry) {
            $searchTerms = @($AppName)
            if ($appEntry.DisplayName) { $searchTerms += $appEntry.DisplayName }
            if ($appEntry.Publisher) { $searchTerms += $appEntry.Publisher }

            $newShortcutsByName = $currentShortcuts | Where-Object {
                $shortcutName = $_.Name
                $searchTerms | Where-Object { $shortcutName -like "*$_*" }
            }
        }

        # Combine all methods and deduplicate
        $allNewShortcuts = @($newShortcutsByList) + @($newShortcutsByTime) + @($newShortcutsByName) |
            Sort-Object FullName -Unique

        $result.shortcuts_created = @($allNewShortcuts | ForEach-Object {
            @{
                name = $_.Name
                path = $_.FullName
                created = $_.CreationTime.ToString("o")
                detection_method = $(
                    $methods = @()
                    if ($_.FullName -notin $Baseline.shortcuts) { $methods += "new_in_list" }
                    if ($_.CreationTime -gt $baselineTime -or $_.LastWriteTime -gt $baselineTime) { $methods += "created_after_baseline" }
                    if ($AppName -and $_.Name -like "*$AppName*") { $methods += "name_match" }
                    $methods -join ","
                )
            }
        })
        Write-Host "Found $($result.shortcuts_created.Count) shortcuts (by list: $($newShortcutsByList.Count), by time: $($newShortcutsByTime.Count), by name: $($newShortcutsByName.Count))"

        # Find new services
        $newServices = $currentServices | Where-Object {
            $_.Name -notin $Baseline.services
        }
        $result.services_created = @($newServices | ForEach-Object {
            @{
                name = $_.Name
                display_name = $_.DisplayName
                start_type = $_.StartType.ToString()
            }
        })
        Write-Host "Found $($result.services_created.Count) new services"

        return $result
    }
}
