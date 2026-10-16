# Shared by standalone setup and the local packager's inline download path.
function Get-PackagerToolManifest {
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'tool-manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.intuneWinAppUtil.fileName -ne 'IntuneWinAppUtil.exe' -or
        $manifest.psadtTemplate.archiveName -ne 'PSAppDeployToolkit_Template_v4.zip' -or
        $manifest.psadtTemplate.extractDir -ne 'PSAppDeployToolkit') { throw 'Invalid tool integrity manifest' }
    foreach ($tool in @($manifest.intuneWinAppUtil, $manifest.psadtTemplate)) {
        if ($tool.sha256 -cnotmatch '^[A-F0-9]{64}$' -or $tool.url -notmatch '^https://github\.com/') { throw 'Invalid tool integrity pin' }
    }
    return $manifest
}

function Assert-PackagerRegularPath([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Tool integrity refuses reparse point: $current" }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Get-PackagerFileSha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Assert-PackagerFileHash([string]$Path, [string]$Expected) {
    Assert-PackagerRegularPath $Path
    $actual = Get-PackagerFileSha256 $Path
    if ($actual -ne $Expected) { throw "TOOL_HASH_MISMATCH: $Path does not match the pinned SHA256. Use a fresh tools directory or restore the pinned file." }
}

function Get-PackagerArchiveMap([string]$ArchivePath) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $files = New-Object 'System.Collections.Generic.Dictionary[string,string]' ([StringComparer]::OrdinalIgnoreCase)
    $dirs = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $zip = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            $relative = $name.TrimEnd('/')
            $segments = $relative.Split('/')
            if (-not $relative -or $name.StartsWith('/') -or $name -match '[<>:"|?*\x00]' -or
                $segments -contains '..' -or $segments -contains '.' -or $segments -contains '' -or
                ($segments | Where-Object { $_ -match '[. ]$|^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)' }) -or
                (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960 -or -not $seen.Add($relative)) {
                throw 'Unsafe or duplicate path in pinned toolkit archive'
            }
            for ($i = 1; $i -lt $segments.Length; $i++) { [void]$dirs.Add(($segments[0..($i - 1)] -join '/')) }
            if ($name.EndsWith('/')) { [void]$dirs.Add($relative); continue }
            $stream = $entry.Open()
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $files.Add($relative, [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')) }
            finally { $sha.Dispose(); $stream.Dispose() }
        }
        foreach ($file in $files.Keys) { if ($dirs.Contains($file)) { throw 'File and directory collide in toolkit archive' } }
    }
    finally { $zip.Dispose() }
    if (-not $files.ContainsKey('Invoke-AppDeployToolkit.exe') -or -not $dirs.Contains('PSAppDeployToolkit')) { throw 'Pinned toolkit archive has an invalid layout' }
    return @{ Files = $files; Directories = $dirs }
}

function Assert-PackagerToolkitTree([string]$Directory, $Map) {
    Assert-PackagerRegularPath $Directory
    $root = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    $seenFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $seenDirs = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $stack = New-Object 'System.Collections.Generic.Stack[string]'
    $stack.Push($Directory)
    while ($stack.Count) {
        foreach ($item in Get-ChildItem -LiteralPath $stack.Pop() -Force -ErrorAction Stop) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Toolkit integrity refuses reparse points' }
            $relative = $item.FullName.Substring($root.Length).Replace('\', '/')
            if ($item.PSIsContainer) {
                if (-not $Map.Directories.Contains($relative)) { throw "Unexpected toolkit directory: $relative" }
                [void]$seenDirs.Add($relative); $stack.Push($item.FullName)
            } else {
                if (-not $Map.Files.ContainsKey($relative)) { throw "Unexpected toolkit file: $relative" }
                Assert-PackagerFileHash $item.FullName $Map.Files[$relative]
                [void]$seenFiles.Add($relative)
            }
        }
    }
    if ($seenFiles.Count -ne $Map.Files.Count -or $seenDirs.Count -ne $Map.Directories.Count) { throw 'Toolkit integrity check found missing files or directories' }
}

function Initialize-VerifiedPsadt([string]$ToolsDir, $Manifest) {
    $root = [IO.Path]::GetFullPath($ToolsDir).TrimEnd('\', '/')
    if ($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\', '/')) { throw 'Tools directory cannot be a filesystem root' }
    Assert-PackagerRegularPath $root
    $archive = Join-Path $root $Manifest.psadtTemplate.archiveName
    Assert-PackagerFileHash $archive $Manifest.psadtTemplate.sha256
    $map = Get-PackagerArchiveMap $archive
    $destination = Join-Path $root $Manifest.psadtTemplate.extractDir
    if (Test-Path -LiteralPath $destination) { Assert-PackagerToolkitTree $destination $map; return }
    $stage = Join-Path $root ('.staging-' + [Guid]::NewGuid().ToString('N'))
    try {
        [void][IO.Directory]::CreateDirectory($stage)
        [IO.Compression.ZipFile]::ExtractToDirectory($archive, $stage)
        Assert-PackagerToolkitTree $stage $map
        [IO.Directory]::Move($stage, $destination)
    }
    finally {
        if (Test-Path -LiteralPath $stage) {
            # Failed staging is never considered a verified toolkit. Preserve it
            # rather than recursively delete a user configured cache path.
            Write-Warning "Unused toolkit staging retained at $stage"
        }
    }
}

function Save-VerifiedPackagerDownload([string]$Url, [string]$Path, [string]$Expected) {
    Assert-PackagerRegularPath ([IO.Path]::GetDirectoryName($Path))
    $temporary = $Path + '.part-' + [Guid]::NewGuid().ToString('N')
    try {
        Invoke-WebRequest -Uri $Url -OutFile $temporary -UseBasicParsing -ErrorAction Stop
        Assert-PackagerFileHash $temporary $Expected
        [IO.File]::Move($temporary, $Path)
    }
    finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction Stop } }
}
