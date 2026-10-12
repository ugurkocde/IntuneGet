<#
.SYNOPSIS
    Drives a bounded, reviewed vendor-uninstaller dialog sequence.
.DESCRIPTION
    This helper is copied only into packages with an internal
    reviewedUninstallWindowAutomation adapter. It restricts window discovery to
    the exact uninstaller path and to processes started by the current uninstall
    invocation. The deployment script still treats removal of the exact captured
    ARP registration as the authoritative completion signal.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$ExpectedProcessPath,

    [Parameter(Mandatory = $true)]
    [datetime]$MinimumStartTimeUtc
)

$ErrorActionPreference = 'Stop'

$configPath = Join-Path $PSScriptRoot 'ReviewedUninstallWindowAutomation.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw 'The reviewed uninstall window-automation configuration is missing.'
}

$config = Get-Content -LiteralPath $configPath -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
$configuredProcessName = ([string]$config.processName).Trim()
if ($configuredProcessName -notmatch '^[A-Za-z0-9 _().-]+\.exe$' -or
    $configuredProcessName.Length -gt 128 -or
    [System.IO.Path]::GetFileName($configuredProcessName) -ne $configuredProcessName) {
    throw 'The reviewed uninstall window-automation process name is invalid.'
}

$expectedProcess = Get-Item -LiteralPath $ExpectedProcessPath -ErrorAction Stop
if ($expectedProcess.PSIsContainer -or $expectedProcess.Name -ine $configuredProcessName) {
    throw 'The registered uninstaller does not match the reviewed window-automation process.'
}
$expectedFullPath = [System.IO.Path]::GetFullPath($expectedProcess.FullName)
$minimumStartUtc = $MinimumStartTimeUtc.ToUniversalTime()

$steps = @($config.steps)
if ($steps.Count -lt 1 -or $steps.Count -gt 10) {
    throw 'The reviewed uninstall window-automation step count is invalid.'
}

if (-not ('IntuneGetReviewedUninstallWindowAutomationNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class IntuneGetReviewedUninstallWindowAutomationNative
{
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    private const uint BM_CLICK = 0x00F5;
    private const uint WM_GETTEXT = 0x000D;
    private const uint WM_GETTEXTLENGTH = 0x000E;
    private const uint SMTO_ABORTIFHUNG = 0x0002;

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLengthW(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint message,
        IntPtr wParam,
        IntPtr lParam,
        uint flags,
        uint timeout,
        out IntPtr result);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint message,
        IntPtr wParam,
        StringBuilder lParam,
        uint flags,
        uint timeout,
        out IntPtr result);

    public static IntPtr[] GetTopLevelWindows(uint processId)
    {
        List<IntPtr> windows = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr unused)
        {
            uint ownerProcessId;
            GetWindowThreadProcessId(hWnd, out ownerProcessId);
            if (ownerProcessId == processId)
            {
                windows.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }

    public static bool WindowContainsText(IntPtr topLevelWindow, string expectedText)
    {
        if (String.IsNullOrEmpty(expectedText))
        {
            return true;
        }

        if (ContainsText(ReadWindowText(topLevelWindow), expectedText))
        {
            return true;
        }

        bool found = false;
        EnumChildWindows(topLevelWindow, delegate(IntPtr hWnd, IntPtr unused)
        {
            if (ContainsText(ReadWindowText(hWnd), expectedText))
            {
                found = true;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static int GetButtonCount(IntPtr topLevelWindow)
    {
        return GetButtons(topLevelWindow).Count;
    }

    public static bool ClickButton(IntPtr topLevelWindow, int oneBasedIndex)
    {
        List<IntPtr> buttons = GetButtons(topLevelWindow);
        if (oneBasedIndex < 1 || oneBasedIndex > buttons.Count)
        {
            return false;
        }

        IntPtr result;
        return SendMessageTimeout(
            buttons[oneBasedIndex - 1],
            BM_CLICK,
            IntPtr.Zero,
            IntPtr.Zero,
            SMTO_ABORTIFHUNG,
            5000,
            out result) != IntPtr.Zero;
    }

    private static List<IntPtr> GetButtons(IntPtr topLevelWindow)
    {
        List<IntPtr> buttons = new List<IntPtr>();
        EnumChildWindows(topLevelWindow, delegate(IntPtr hWnd, IntPtr unused)
        {
            StringBuilder className = new StringBuilder(64);
            GetClassNameW(hWnd, className, className.Capacity);
            if (String.Equals(className.ToString(), "Button", StringComparison.Ordinal))
            {
                buttons.Add(hWnd);
            }
            return true;
        }, IntPtr.Zero);
        return buttons;
    }

    private static bool ContainsText(string value, string expectedText)
    {
        return !String.IsNullOrEmpty(value) &&
            value.IndexOf(expectedText, StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static string ReadWindowText(IntPtr hWnd)
    {
        int length = GetWindowTextLengthW(hWnd);
        if (length > 0)
        {
            StringBuilder directText = new StringBuilder(length + 1);
            if (GetWindowTextW(hWnd, directText, directText.Capacity) > 0)
            {
                return directText.ToString();
            }
        }

        IntPtr textLengthResult;
        if (SendMessageTimeout(
                hWnd,
                WM_GETTEXTLENGTH,
                IntPtr.Zero,
                IntPtr.Zero,
                SMTO_ABORTIFHUNG,
                1000,
                out textLengthResult) == IntPtr.Zero)
        {
            return String.Empty;
        }

        int messageLength = textLengthResult.ToInt32();
        if (messageLength <= 0 || messageLength > 4096)
        {
            return String.Empty;
        }

        StringBuilder messageText = new StringBuilder(messageLength + 1);
        IntPtr textResult;
        if (SendMessageTimeout(
                hWnd,
                WM_GETTEXT,
                new IntPtr(messageText.Capacity),
                messageText,
                SMTO_ABORTIFHUNG,
                1000,
                out textResult) == IntPtr.Zero)
        {
            return String.Empty;
        }
        return messageText.ToString();
    }
}
'@
}

$processNameWithoutExtension = [System.IO.Path]::GetFileNameWithoutExtension($configuredProcessName)
for ($stepIndex = 0; $stepIndex -lt $steps.Count; $stepIndex++) {
    $step = $steps[$stepIndex]
    $windowText = [string]$step.windowText
    $buttonIndex = 0
    $timeoutSeconds = 0
    if (-not [int]::TryParse([string]$step.buttonIndex, [ref]$buttonIndex) -or
        $buttonIndex -lt 1 -or $buttonIndex -gt 20 -or
        -not [int]::TryParse([string]$step.timeoutSeconds, [ref]$timeoutSeconds) -or
        $timeoutSeconds -lt 1 -or $timeoutSeconds -gt 120 -or
        $windowText.Length -gt 128 -or
        [regex]::IsMatch($windowText, '[\x00-\x1F\x7F]')) {
        throw 'A reviewed uninstall window-automation step is invalid.'
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($timeoutSeconds)
    $clicked = $false
    do {
        $candidateProcesses = @(Get-Process -Name $processNameWithoutExtension -ErrorAction SilentlyContinue | Where-Object {
            try {
                $_.StartTime.ToUniversalTime() -ge $minimumStartUtc -and
                    [System.IO.Path]::GetFullPath($_.Path) -ieq $expectedFullPath
            } catch {
                $false
            }
        })

        foreach ($candidateProcess in $candidateProcesses) {
            $windows = [IntuneGetReviewedUninstallWindowAutomationNative]::GetTopLevelWindows(
                [uint32]$candidateProcess.Id
            )
            foreach ($window in $windows) {
                if (-not [IntuneGetReviewedUninstallWindowAutomationNative]::WindowContainsText(
                    $window,
                    $windowText
                )) {
                    continue
                }
                if ([IntuneGetReviewedUninstallWindowAutomationNative]::GetButtonCount($window) -lt $buttonIndex) {
                    continue
                }
                if ([IntuneGetReviewedUninstallWindowAutomationNative]::ClickButton($window, $buttonIndex)) {
                    $clicked = $true
                    break
                }
            }
            if ($clicked) { break }
        }

        if (-not $clicked) {
            Start-Sleep -Milliseconds 250
        }
    } while (-not $clicked -and [DateTime]::UtcNow -lt $deadline)

    if (-not $clicked) {
        throw "Reviewed uninstall window-automation step [$($stepIndex + 1)] did not find its exact process window and button before the deadline."
    }

    Write-Output "Reviewed uninstall window-automation clicked button [$buttonIndex] for step [$($stepIndex + 1)]."
}
