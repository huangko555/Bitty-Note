param(
    [string]$ExecutablePath = ''
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$defaultExe = Join-Path $projectRoot 'dist\Bitty-Note\Bitty-Note.exe'
$exePath = if ($ExecutablePath) { $ExecutablePath } else { $defaultExe }
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Packaged executable was not found: $exePath"
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NativeCloseTest {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$process = $null
$originalLocalAppData = $env:LOCALAPPDATA
$testDataRoot = Join-Path $projectRoot '.desktop-notes-dev'
$testProfile = Join-Path $testDataRoot "close-e2e-$PID-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testProfile -Force | Out-Null
$env:LOCALAPPDATA = $testProfile

try {
    $process = Start-Process -FilePath $exePath -WorkingDirectory (Split-Path -Parent $exePath) -WindowStyle Hidden -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 100
        $process.Refresh()
    } while (-not $process.HasExited -and $process.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $deadline)

    if ($process.HasExited) { throw "The app exited during startup: $($process.ExitCode)" }
    if ($process.MainWindowHandle -eq 0) { throw 'The app did not create a window within 15 seconds.' }

    $handle = $process.MainWindowHandle
    $rect = New-Object NativeCloseTest+RECT
    if (-not [NativeCloseTest]::GetWindowRect($handle, [ref]$rect)) {
        throw 'Could not read the application window bounds.'
    }

    $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $closeLabel = "$([char]0x5173)$([char]0x95ed)"
    $closeCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        $closeLabel
    )
    $closeElement = $null
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $closeElement = $rootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $closeCondition
        )
        if ($null -eq $closeElement) { Start-Sleep -Milliseconds 100 }
    } while ($null -eq $closeElement -and [DateTime]::UtcNow -lt $readyDeadline)
    if ($null -eq $closeElement) { throw 'The close button was not exposed within five seconds.' }

    $closeBounds = $closeElement.Current.BoundingRectangle
    if ($closeBounds.Width -le 0 -or $closeBounds.Height -le 0) {
        throw 'The close button did not expose valid bounds.'
    }
    $closeX = [int][Math]::Round($closeBounds.Left + ($closeBounds.Width / 2))
    $closeY = [int][Math]::Round($closeBounds.Top + ($closeBounds.Height / 2))
    Write-Host "INFO: Window=($($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)); close=($closeX,$closeY)."

    [NativeCloseTest]::SetForegroundWindow($handle) | Out-Null
    [NativeCloseTest]::SetCursorPos($closeX, $closeY) | Out-Null
    Start-Sleep -Milliseconds 150
    [NativeCloseTest]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    [NativeCloseTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)

    if (-not $process.WaitForExit(5000)) {
        throw 'A single click on the close button did not close the app.'
    }
    if ($process.ExitCode -ne 0) {
        throw "The app returned an unexpected exit code: $($process.ExitCode)"
    }
    Write-Host 'PASS: One close-button click closed the app.'
}
finally {
    $env:LOCALAPPDATA = $originalLocalAppData
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    $resolvedTestRoot = [IO.Path]::GetFullPath($testDataRoot).TrimEnd('\') + '\'
    $resolvedProfile = [IO.Path]::GetFullPath($testProfile)
    if ($resolvedProfile.StartsWith($resolvedTestRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
    }
}
