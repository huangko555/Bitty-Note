param(
    [string]$ExecutablePath = '',
    [string]$ResultPath = ''
)

$ErrorActionPreference = 'Stop'

trap {
    if ($ResultPath) {
        @{ ok = $false; error = $_.Exception.Message } |
            ConvertTo-Json -Compress |
            Set-Content -LiteralPath $ResultPath -Encoding UTF8
    }
    exit 1
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$defaultExe = Join-Path $projectRoot 'dist\Bitty-Note\Bitty-Note.exe'
$exePath = if ($ExecutablePath) { $ExecutablePath } else { $defaultExe }
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Packaged executable was not found: $exePath"
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NativeTaskbarToggleTest {
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string className, string windowName);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@

function Invoke-TaskbarButton {
    param([System.Windows.Automation.AutomationElement]$Button)

    $bounds = $Button.Current.BoundingRectangle
    $x = [int]($bounds.Left + ($bounds.Width / 2))
    $y = [int]($bounds.Top + ($bounds.Height / 2))
    [NativeTaskbarToggleTest]::SetCursorPos($x, $y) | Out-Null
    [NativeTaskbarToggleTest]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [NativeTaskbarToggleTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 700
}

$process = $null
$cursor = New-Object NativeTaskbarToggleTest+POINT
[NativeTaskbarToggleTest]::GetCursorPos([ref]$cursor) | Out-Null
$originalLocalAppData = $env:LOCALAPPDATA
$testDataRoot = Join-Path $projectRoot '.desktop-notes-dev'
$testProfile = Join-Path $testDataRoot "taskbar-e2e-$PID-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testProfile -Force | Out-Null
$env:LOCALAPPDATA = $testProfile

try {
    $process = Start-Process -FilePath $exePath -WorkingDirectory (Split-Path -Parent $exePath) -PassThru
    $windowDeadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 100
        $process.Refresh()
    } while (-not $process.HasExited -and $process.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $windowDeadline)

    if ($process.HasExited) { throw "The app exited during startup: $($process.ExitCode)" }
    if ($process.MainWindowHandle -eq 0) { throw 'The app did not create a window within 15 seconds.' }
    $handle = [IntPtr]$process.MainWindowHandle

    $taskbarHandle = [NativeTaskbarToggleTest]::FindWindow('Shell_TrayWnd', $null)
    $taskbar = [System.Windows.Automation.AutomationElement]::FromHandle($taskbarHandle)
    $buttonDeadline = [DateTime]::UtcNow.AddSeconds(8)
    $taskbarButton = $null
    do {
        $buttons = $taskbar.FindAll(
            [System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.PropertyCondition]::new(
                [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
                [System.Windows.Automation.ControlType]::Button
            )
        )
        $taskbarButton = @($buttons | Where-Object {
            $_.Current.AutomationId -eq 'Appid: velopack.BittyNote' -or
            $_.Current.Name -like '*Bitty*' -or
            $_.Current.Name -like '*小记*'
        })[0]
        if ($null -eq $taskbarButton) { Start-Sleep -Milliseconds 100 }
    } while ($null -eq $taskbarButton -and [DateTime]::UtcNow -lt $buttonDeadline)
    if ($null -eq $taskbarButton) {
        $taskbarButtons = @($buttons | ForEach-Object {
            "[$($_.Current.AutomationId)] $($_.Current.Name)"
        }) -join '; '
        throw "The Bitty taskbar button was not found. Buttons: $taskbarButtons"
    }

    if ([NativeTaskbarToggleTest]::GetForegroundWindow() -ne $handle) {
        Invoke-TaskbarButton $taskbarButton
    }
    if ([NativeTaskbarToggleTest]::GetForegroundWindow() -ne $handle) {
        throw 'The first taskbar click did not activate the Bitty window.'
    }

    Invoke-TaskbarButton $taskbarButton
    if (-not [NativeTaskbarToggleTest]::IsIconic($handle)) {
        throw 'Clicking the active Bitty taskbar button did not minimize the window.'
    }
    Write-Host 'PASS: Clicking the active taskbar button minimized the window.'

    Invoke-TaskbarButton $taskbarButton
    if ([NativeTaskbarToggleTest]::IsIconic($handle) -or [NativeTaskbarToggleTest]::GetForegroundWindow() -ne $handle) {
        throw 'Clicking the minimized Bitty taskbar button did not restore and activate the window.'
    }
    Write-Host 'PASS: Clicking the minimized taskbar button restored the window.'

    [NativeTaskbarToggleTest]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    if (-not $process.WaitForExit(2000)) {
        Stop-Process -Id $process.Id -Force
        $process.WaitForExit(5000) | Out-Null
    }
}
finally {
    $env:LOCALAPPDATA = $originalLocalAppData
    [NativeTaskbarToggleTest]::SetCursorPos($cursor.X, $cursor.Y) | Out-Null
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    $resolvedTestRoot = [IO.Path]::GetFullPath($testDataRoot).TrimEnd('\') + '\'
    $resolvedProfile = [IO.Path]::GetFullPath($testProfile)
    if ($resolvedProfile.StartsWith($resolvedTestRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($ResultPath) {
    @{ ok = $true } |
        ConvertTo-Json -Compress |
        Set-Content -LiteralPath $ResultPath -Encoding UTF8
}
