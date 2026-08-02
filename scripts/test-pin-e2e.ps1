param(
    [string]$ExecutablePath = '',
    [string[]]$ArgumentList = @(),
    [string]$LogPath = ''
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$defaultExe = Join-Path $projectRoot 'dist\Bitty-Note\Bitty-Note.exe'
$exePath = if ($ExecutablePath) { $ExecutablePath } else { $defaultExe }
if (-not $exePath -or -not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Packaged executable was not found: $exePath"
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NativeWindowTest {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr hWndInsertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    public static extern uint GetDpiForWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int index);

    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
}
'@
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing

function Save-WindowScreenshot {
    param([IntPtr]$Handle, [string]$Path)

    $rect = New-Object NativeWindowTest+RECT
    [NativeWindowTest]::GetWindowRect($Handle, [ref]$rect) | Out-Null
    $bitmap = New-Object System.Drawing.Bitmap ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
        $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Invoke-PointerDrag {
    param(
        [int]$StartX,
        [int]$StartY,
        [int]$EndX,
        [int]$EndY
    )

    [NativeWindowTest]::SetCursorPos($StartX, $StartY) | Out-Null
    [NativeWindowTest]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    try {
        Start-Sleep -Milliseconds 150
        foreach ($step in 1..8) {
            $x = [int]($StartX + (($EndX - $StartX) * $step / 8))
            $y = [int]($StartY + (($EndY - $StartY) * $step / 8))
            [NativeWindowTest]::SetCursorPos($x, $y) | Out-Null
            Start-Sleep -Milliseconds 25
        }
    }
    finally {
        [NativeWindowTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
    }
    Start-Sleep -Milliseconds 250
}

$process = $null
$cursor = New-Object NativeWindowTest+POINT
[NativeWindowTest]::GetCursorPos([ref]$cursor) | Out-Null
$originalLocalAppData = $env:LOCALAPPDATA
$testDataRoot = Join-Path $projectRoot '.desktop-notes-dev'
$testProfile = Join-Path $testDataRoot "e2e-$PID-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $testProfile -Force | Out-Null
$env:LOCALAPPDATA = $testProfile

try {
    $packageDir = Split-Path -Parent $exePath
    $startArguments = @{
        FilePath = $exePath
        WorkingDirectory = $packageDir
        WindowStyle = 'Hidden'
        PassThru = $true
    }
    if ($ArgumentList.Count -gt 0) { $startArguments.ArgumentList = $ArgumentList }
    if ($LogPath) {
        $startArguments.RedirectStandardOutput = "$LogPath.stdout.log"
        $startArguments.RedirectStandardError = "$LogPath.stderr.log"
    }
    $process = Start-Process @startArguments
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 100
        $process.Refresh()
    } while (-not $process.HasExited -and $process.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $deadline)

    if ($process.HasExited) { throw "The app exited during startup: $($process.ExitCode)" }
    if ($process.MainWindowHandle -eq 0) { throw 'The app did not create a window within 15 seconds.' }

    $handle = $process.MainWindowHandle
    $beforeStyle = [NativeWindowTest]::GetWindowLongPtr($handle, -20).ToInt64()
    $beforeTopmost = ($beforeStyle -band 0x8) -ne 0

    [NativeWindowTest]::SetForegroundWindow($handle) | Out-Null
    $rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $pinLabel = "$([char]0x7f6e)$([char]0x9876)"
    $pinCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        $pinLabel
    )
    $pinElement = $null
    $readyDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        $pinElement = $rootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $pinCondition
        )
        if ($null -eq $pinElement) { Start-Sleep -Milliseconds 100 }
    } while ($null -eq $pinElement -and [DateTime]::UtcNow -lt $readyDeadline)

    $moveRect = New-Object NativeWindowTest+RECT
    [NativeWindowTest]::GetWindowRect($handle, [ref]$moveRect) | Out-Null
    # This point is inside the title bar's former left-side dead zone, not on a button.
    $titleX = $moveRect.Left + 70
    $titleY = $moveRect.Top + 21
    Invoke-PointerDrag $titleX $titleY ($titleX + 60) ($titleY + 40)

    $movedRect = New-Object NativeWindowTest+RECT
    [NativeWindowTest]::GetWindowRect($handle, [ref]$movedRect) | Out-Null
    if ([Math]::Abs($movedRect.Left - $moveRect.Left) -lt 30 -or
        [Math]::Abs($movedRect.Top - $moveRect.Top) -lt 20) {
        $failureImage = Join-Path $projectRoot '.desktop-notes-dev\window-e2e-failure.png'
        Save-WindowScreenshot $handle $failureImage
        throw 'Dragging the title bar did not move the window.'
    }
    Write-Host 'PASS: The title bar moved the window.'

    $widthBefore = $movedRect.Right - $movedRect.Left
    $heightBefore = $movedRect.Bottom - $movedRect.Top
    Invoke-PointerDrag ($movedRect.Right - 4) ($movedRect.Bottom - 4) ($movedRect.Right + 66) ($movedRect.Bottom + 46)

    $resizedRect = New-Object NativeWindowTest+RECT
    [NativeWindowTest]::GetWindowRect($handle, [ref]$resizedRect) | Out-Null
    $widthAfter = $resizedRect.Right - $resizedRect.Left
    $heightAfter = $resizedRect.Bottom - $resizedRect.Top
    if ($widthAfter - $widthBefore -lt 35 -or $heightAfter - $heightBefore -lt 25) {
        throw 'Dragging the bottom-right corner did not resize the window.'
    }
    Write-Host 'PASS: The bottom-right corner resized the window.'

    if ($null -ne $pinElement) {
        try {
            $invokePattern = $pinElement.GetCurrentPattern(
                [System.Windows.Automation.InvokePattern]::Pattern
            )
            $invokePattern.Invoke()
            Write-Host 'INFO: Invoked the pin button through UI Automation.'
        }
        catch {
            # WebView2 may expose the button name without exposing InvokePattern.
            $pinElement = $null
        }
    }
    if ($null -eq $pinElement) {
        # Some WebView2 versions do not expose web buttons to UI Automation.
        # The five-second readiness wait makes coordinate fallback deterministic.
        $rect = New-Object NativeWindowTest+RECT
        if (-not [NativeWindowTest]::GetWindowRect($handle, [ref]$rect)) {
            throw 'Could not read the application window bounds.'
        }
        $dpi = [NativeWindowTest]::GetDpiForWindow($handle)
        if ($dpi -eq 0) { $dpi = 96 }
        $scale = $dpi / 96.0
        $pinX = [int][Math]::Round($rect.Right - (89 * $scale))
        $pinY = [int][Math]::Round($rect.Top + (21 * $scale))
        [NativeWindowTest]::SetCursorPos($pinX, $pinY) | Out-Null
        [NativeWindowTest]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [NativeWindowTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        Write-Host "INFO: Used the title-bar coordinate fallback (DPI=$dpi, X=$pinX, Y=$pinY)."
    }

    $toggleDeadline = [DateTime]::UtcNow.AddSeconds(2)
    $afterTopmost = $beforeTopmost
    do {
        Start-Sleep -Milliseconds 50
        $afterStyle = [NativeWindowTest]::GetWindowLongPtr($handle, -20).ToInt64()
        $afterTopmost = ($afterStyle -band 0x8) -ne 0
    } while ($afterTopmost -eq $beforeTopmost -and [DateTime]::UtcNow -lt $toggleDeadline)

    if ($afterTopmost -eq $beforeTopmost) {
        [NativeWindowTest]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
        if (-not $process.WaitForExit(1500)) {
            throw 'Pin state did not change and the app stopped responding to close.'
        }
        throw 'Pin state did not change, but the app still responded to close.'
    }

    $configPath = Join-Path $testProfile 'DesktopNotes\config.json'
    $savedDeadline = [DateTime]::UtcNow.AddSeconds(2)
    $savedTopmost = $false
    do {
        if (Test-Path -LiteralPath $configPath -PathType Leaf) {
            $savedTopmost = [bool]((Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).always_on_top)
        }
        if (-not $savedTopmost) { Start-Sleep -Milliseconds 50 }
    } while (-not $savedTopmost -and [DateTime]::UtcNow -lt $savedDeadline)
    if (-not $savedTopmost) {
        throw 'The enabled pin state was not persisted before native synchronization testing.'
    }

    # Simulate Windows or another process changing the real topmost state while
    # the stored UI state is stale, then reactivate the window as a user would.
    [NativeWindowTest]::SetWindowPos($handle, [IntPtr](-2), 0, 0, 0, 0, 0x0013) | Out-Null
    [NativeWindowTest]::ShowWindow($handle, 6) | Out-Null
    Start-Sleep -Milliseconds 150
    [NativeWindowTest]::ShowWindow($handle, 9) | Out-Null
    [NativeWindowTest]::SetForegroundWindow($handle) | Out-Null

    $syncDeadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
        Start-Sleep -Milliseconds 50
        $nativeStyle = [NativeWindowTest]::GetWindowLongPtr($handle, -20).ToInt64()
        $nativeTopmost = ($nativeStyle -band 0x8) -ne 0
        $savedTopmost = [bool]((Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).always_on_top)
    } while (($nativeTopmost -or $savedTopmost) -and [DateTime]::UtcNow -lt $syncDeadline)
    if ($nativeTopmost -or $savedTopmost) {
        throw 'The stored pin state did not synchronize with the native window state after reactivation.'
    }
    Write-Host 'PASS: Stored pin state synchronized with the native window state.'

    [NativeWindowTest]::PostMessage($handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    if (-not $process.WaitForExit(5000)) {
        throw 'The app could not close normally after toggling pin state.'
    }
    if ($process.ExitCode -ne 0) {
        throw "The app returned an unexpected exit code: $($process.ExitCode)"
    }

    Write-Host 'PASS: Pin state changed and the app closed normally.'
}
finally {
    $env:LOCALAPPDATA = $originalLocalAppData
    [NativeWindowTest]::SetCursorPos($cursor.X, $cursor.Y) | Out-Null
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    $resolvedTestRoot = [IO.Path]::GetFullPath($testDataRoot).TrimEnd('\') + '\'
    $resolvedProfile = [IO.Path]::GetFullPath($testProfile)
    if ($resolvedProfile.StartsWith($resolvedTestRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
    }
}
