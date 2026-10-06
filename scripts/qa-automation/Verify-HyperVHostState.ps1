# Read-only verification of the QA Hyper-V host after an interrupted VM test.
# Run elevated. Makes no changes: only Get-* and Test-VHD calls.
# Every collection failure is recorded in `errors`, so an empty `errors` list
# means the evidence below is complete.
$ErrorActionPreference = 'Continue'
$out = Join-Path $PSScriptRoot ('hyperv-verification-{0}.json' -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmZ'))
$result = [ordered]@{
    observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
    verifiedBy    = "$env:USERDOMAIN\$env:USERNAME (elevated, read-only)"
    systemDrive   = $env:SystemDrive
    vmms          = $null
    volumes       = @()
    vms           = @()
    errors        = @()
}
try { $result.vmms = (Get-Service vmms -ErrorAction Stop).Status.ToString() }
catch { $result.errors += "vmms: $($_.Exception.Message)" }
try {
    foreach ($v in Get-Volume -ErrorAction Stop | Where-Object DriveLetter) {
        $result.volumes += [ordered]@{
            drive  = "$($v.DriveLetter):"
            system = ("$($v.DriveLetter):" -eq $env:SystemDrive)
            freeGB = [math]::Round($v.SizeRemaining / 1GB, 1)
            sizeGB = [math]::Round($v.Size / 1GB, 1)
            health = "$($v.HealthStatus)"
        }
    }
} catch { $result.errors += "volumes: $($_.Exception.Message)" }
try {
    foreach ($vm in Get-VM -ErrorAction Stop) {
        $snaps = @()
        try { $snaps = @(Get-VMSnapshot -VM $vm -ErrorAction Stop) }
        catch { $result.errors += "$($vm.Name) checkpoints: $($_.Exception.Message)" }
        $disks = @()
        try {
            foreach ($d in Get-VMHardDiskDrive -VM $vm -ErrorAction Stop) {
                $ok = $false; $err = $null
                try { $ok = Test-VHD -Path $d.Path -ErrorAction Stop } catch { $err = $_.Exception.Message }
                if (-not $ok) { $result.errors += "$($vm.Name) disk $($d.Path): Test-VHD failed $err" }
                $disks += [ordered]@{ path = $d.Path; exists = (Test-Path -LiteralPath $d.Path); testVhd = $ok; error = $err }
            }
        } catch { $result.errors += "$($vm.Name) disks: $($_.Exception.Message)" }
        if ($disks.Count -eq 0) { $result.errors += "$($vm.Name): no disks enumerated" }
        $result.vms += [ordered]@{
            name = $vm.Name; state = "$($vm.State)"; status = "$($vm.Status)"
            heartbeat = "$($vm.Heartbeat)"; parentCheckpoint = $vm.ParentCheckpointName
            checkpoints = @($snaps | ForEach-Object { [ordered]@{ name = $_.Name; created = $_.CreationTime.ToUniversalTime().ToString('o'); type = "$($_.SnapshotType)" } })
            disks = $disks
        }
    }
} catch { $result.errors += "vms: $($_.Exception.Message)" }
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $out -Encoding UTF8
