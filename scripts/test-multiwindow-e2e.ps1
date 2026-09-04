param(
    [string]$ExecutablePath = ''
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvConfig = Get-Content -LiteralPath (Join-Path $projectRoot '.venv\pyvenv.cfg')
$pythonHome = ($venvConfig | Where-Object { $_ -like 'home = *' } | Select-Object -First 1) -replace '^home = ', ''
$defaultExe = Join-Path $pythonHome 'python.exe'
$exePath = if ($ExecutablePath) { $ExecutablePath } else { $defaultExe }
$sourceEntry = "m=__import__('desktop_notes.main',fromlist=['*']);m.is_store_package=lambda:True;m.main()"
$startArguments = if ($ExecutablePath) { @() } else { @('-c', $sourceEntry) }
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "Application entry point was not found: $exePath"
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeMultiWindowTest {
    public delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll")]
    public static extern int GetWindowTextLengthW(IntPtr handle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr handle, StringBuilder title, int length);
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr handle);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")]
    public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam);

    public static IntPtr[] VisibleWindows(int processId) {
        var result = new List<IntPtr>();
        EnumWindows((handle, parameter) => {
            uint owner;
            GetWindowThreadProcessId(handle, out owner);
            if (owner == processId && IsWindowVisible(handle)) result.Add(handle);
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }

    public static string Title(IntPtr handle) {
        var length = GetWindowTextLengthW(handle);
        var title = new StringBuilder(length + 1);
        GetWindowTextW(handle, title, title.Capacity);
        return title.ToString();
    }
}
'@
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Find-NamedElement {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$Name,
        [int]$TimeoutSeconds = 5
    )

    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        $Name
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $element = $Root.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $condition
        )
        if ($null -ne $element) { return $element }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    $allElements = $Root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    $names = foreach ($candidate in $allElements) {
        if ($candidate.Current.Name) { $candidate.Current.Name }
    }
    throw "UI element was not found: $Name. Available: $($names -join ' | ')"
}

function Invoke-ElementClick {
    param(
        [System.Windows.Automation.AutomationElement]$Element,
        [switch]$Right
    )

    $bounds = $Element.Current.BoundingRectangle
    if ($bounds.Width -le 0 -or $bounds.Height -le 0) {
        throw "UI element has invalid bounds: $($Element.Current.Name)"
    }
    $x = [int][Math]::Round($bounds.Left + ($bounds.Width / 2))
    $y = [int][Math]::Round($bounds.Top + ($bounds.Height / 2))
    [NativeMultiWindowTest]::SetCursorPos($x, $y) | Out-Null
    $down = if ($Right) { 0x0008 } else { 0x0002 }
    $up = if ($Right) { 0x0010 } else { 0x0004 }
    [NativeMultiWindowTest]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 200
    [NativeMultiWindowTest]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
}

function Invoke-ElementDoubleClick {
    param([System.Windows.Automation.AutomationElement]$Element)

    $bounds = $Element.Current.BoundingRectangle
    $x = [int][Math]::Round($bounds.Left + ($bounds.Width / 2))
    $y = [int][Math]::Round($bounds.Top + ($bounds.Height / 2))
    [NativeMultiWindowTest]::SetCursorPos($x, $y) | Out-Null
    foreach ($click in 1..2) {
        [NativeMultiWindowTest]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 60
        [NativeMultiWindowTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 80
    }
}

function Invoke-ElementAction {
    param([System.Windows.Automation.AutomationElement]$Element)

    $pattern = $Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    ([System.Windows.Automation.InvokePattern]$pattern).Invoke()
}

function Invoke-PointDrag {
    param(
        [int]$StartX,
        [int]$StartY,
        [int]$EndX,
        [int]$EndY
    )

    [NativeMultiWindowTest]::SetCursorPos($StartX, $StartY) | Out-Null
    [NativeMultiWindowTest]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
    1..8 | ForEach-Object {
        $x = [int][Math]::Round($StartX + (($EndX - $StartX) * $_ / 8))
        $y = [int][Math]::Round($StartY + (($EndY - $StartY) * $_ / 8))
        [NativeMultiWindowTest]::SetCursorPos($x, $y) | Out-Null
        Start-Sleep -Milliseconds 20
    }
    [NativeMultiWindowTest]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
}

$launcher = $null
$process = $null
$originalLocalAppData = $env:LOCALAPPDATA
$originalPythonPath = $env:PYTHONPATH
$testDataRoot = Join-Path $projectRoot '.desktop-notes-dev'
$testProfile = Join-Path $testDataRoot "multiwindow-e2e-$PID-$([Guid]::NewGuid().ToString('N'))"
$notesDirectory = Join-Path $testProfile 'notes'
New-Item -ItemType Directory -Path $notesDirectory -Force | Out-Null
Set-Content -LiteralPath (Join-Path $notesDirectory 'Alpha.md') -Value 'Alpha' -Encoding utf8
Set-Content -LiteralPath (Join-Path $notesDirectory 'Beta.md') -Value 'Beta' -Encoding utf8
$configDirectory = Join-Path $testProfile 'DesktopNotes'
New-Item -ItemType Directory -Path $configDirectory -Force | Out-Null
@{
    save_dir = $notesDirectory
    language = 'zh-CN'
    autostart = $false
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $configDirectory 'config.json') -Encoding utf8
$env:LOCALAPPDATA = $testProfile
$env:PYTHONPATH = "$(Join-Path $projectRoot 'backend');$(Join-Path $projectRoot '.venv\Lib\site-packages')"

try {
    $launch = @{
        FilePath = $exePath
        WorkingDirectory = $projectRoot
        PassThru = $true
    }
    $stdoutPath = Join-Path $testProfile 'stdout.log'
    $stderrPath = Join-Path $testProfile 'stderr.log'
    $launch.RedirectStandardOutput = $stdoutPath
    $launch.RedirectStandardError = $stderrPath
    if ($startArguments.Count -gt 0) { $launch.ArgumentList = $startArguments }
    $launcher = Start-Process @launch
    $process = $launcher
    $deadline = [DateTime]::UtcNow.AddSeconds(15)
    do {
        Start-Sleep -Milliseconds 100
        $process.Refresh()
        $initialHandles = [NativeMultiWindowTest]::VisibleWindows($process.Id)
        $mainHandle = $initialHandles | Where-Object {
            [NativeMultiWindowTest]::Title($_) -in @('小记', 'Bitty')
        } | Select-Object -First 1
    } while (-not $process.HasExited -and $null -eq $mainHandle -and [DateTime]::UtcNow -lt $deadline)
    if ($process.HasExited) { throw "The app exited during startup: $($process.ExitCode)" }
    if ($null -eq $mainHandle) {
        $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { '' }
        $visibleTitles = $initialHandles | ForEach-Object { "[$([NativeMultiWindowTest]::Title($_))]" }
        throw "The main window was not created. Visible titles: $($visibleTitles -join ', '); stderr: $stderrText"
    }

    [NativeMultiWindowTest]::SetForegroundWindow($mainHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    $mainRoot = [System.Windows.Automation.AutomationElement]::FromHandle($mainHandle)
    $alpha = Find-NamedElement $mainRoot '打开 Alpha.md'
    Invoke-ElementClick $alpha -Right
    $openWindow = Find-NamedElement $mainRoot '在新窗口打开'
    Invoke-ElementClick $openWindow

    $windowDeadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 100
        $handles = [NativeMultiWindowTest]::VisibleWindows($process.Id) | Where-Object {
            [NativeMultiWindowTest]::Title($_)
        }
    } while ($handles.Count -lt 2 -and [DateTime]::UtcNow -lt $windowDeadline)
    if ($handles.Count -ne 2) {
        $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { '' }
        throw "Expected two visible windows, found $($handles.Count). stderr: $stderrText"
    }
    $titles = $handles | ForEach-Object { [NativeMultiWindowTest]::Title($_) }
    if ($titles -notcontains '小记' -or $titles -notcontains 'Alpha') {
        throw "Unexpected initial window titles: $($titles -join ', ')"
    }
    $alphaHandle = $handles | Where-Object {
        [NativeMultiWindowTest]::Title($_) -eq 'Alpha'
    } | Select-Object -First 1
    $alphaRoot = [System.Windows.Automation.AutomationElement]::FromHandle($alphaHandle)
    $closeAuxiliary = Find-NamedElement $alphaRoot '关闭' 5

    [NativeMultiWindowTest]::SetForegroundWindow($mainHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    $openedAlphaCard = Find-NamedElement $mainRoot '打开 Alpha.md'
    Invoke-ElementClick $openedAlphaCard -Right
    $renameOpenedNote = Find-NamedElement $mainRoot '重命名'
    Invoke-ElementClick $renameOpenedNote
    $renameFocusDeadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
        Start-Sleep -Milliseconds 50
        $foreground = [NativeMultiWindowTest]::GetForegroundWindow()
    } while ($foreground -ne $alphaHandle -and [DateTime]::UtcNow -lt $renameFocusDeadline)
    if ($foreground -ne $alphaHandle) {
        throw 'Renaming an open note did not focus its existing window.'
    }
    $null = Find-NamedElement $alphaRoot '记录名称' 3

    [NativeMultiWindowTest]::SetForegroundWindow($mainHandle) | Out-Null
    Start-Sleep -Milliseconds 250

    [NativeMultiWindowTest]::SetForegroundWindow($alphaHandle) | Out-Null
    $beforeDrag = $alphaRoot.Current.BoundingRectangle
    $dragStartX = [int][Math]::Round($beforeDrag.Left + ($beforeDrag.Width / 2))
    $dragStartY = [int][Math]::Round($beforeDrag.Top + 15)
    Invoke-PointDrag $dragStartX $dragStartY ($dragStartX + 400) ($dragStartY + 40)
    Start-Sleep -Milliseconds 200
    $afterDrag = $alphaRoot.Current.BoundingRectangle
    if ([Math]::Abs($afterDrag.Left - $beforeDrag.Left) -lt 30 -or
        [Math]::Abs($afterDrag.Top - $beforeDrag.Top) -lt 20) {
        throw 'Dragging from the note title text did not move the note window.'
    }

    [NativeMultiWindowTest]::SetForegroundWindow($alphaHandle) | Out-Null
    $beta = Find-NamedElement $mainRoot '打开 Beta.md'
    Invoke-ElementClick $beta
    $inactiveClickDeadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
        Start-Sleep -Milliseconds 50
        $mainTitle = [NativeMultiWindowTest]::Title($mainHandle)
    } while ($mainTitle -ne 'Beta' -and [DateTime]::UtcNow -lt $inactiveClickDeadline)
    if ($mainTitle -ne 'Beta') {
        $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { '' }
        throw "The first click on the inactive main window only focused it. stderr: $stderrText"
    }

    [NativeMultiWindowTest]::SetForegroundWindow($alphaHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    $mainPin = Find-NamedElement $mainRoot '置顶'
    Invoke-ElementClick $mainPin
    $configPath = Join-Path $configDirectory 'config.json'
    $pinDeadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
        Start-Sleep -Milliseconds 50
        $alwaysOnTop = [bool]((Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).always_on_top)
    } while (-not $alwaysOnTop -and [DateTime]::UtcNow -lt $pinDeadline)
    if (-not $alwaysOnTop) {
        throw 'The first click on the inactive note title-bar pin only focused the window.'
    }
    Invoke-ElementClick $mainPin
    $unpinDeadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
        Start-Sleep -Milliseconds 50
        $alwaysOnTop = [bool]((Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).always_on_top)
    } while ($alwaysOnTop -and [DateTime]::UtcNow -lt $unpinDeadline)
    if ($alwaysOnTop) { throw 'The title-bar pin could not be reset after inactive-click testing.' }

    [NativeMultiWindowTest]::SetForegroundWindow($mainHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    $back = Find-NamedElement $mainRoot '返回'
    Invoke-ElementAction $back
    $alpha = Find-NamedElement $mainRoot '打开 Alpha.md'
    Invoke-ElementClick $alpha -Right
    $openWindow = Find-NamedElement $mainRoot '在新窗口打开'
    Invoke-ElementClick $openWindow
    $focusDeadline = [DateTime]::UtcNow.AddSeconds(3)
    do {
        Start-Sleep -Milliseconds 50
        $foreground = [NativeMultiWindowTest]::GetForegroundWindow()
    } while ($foreground -ne $alphaHandle -and [DateTime]::UtcNow -lt $focusDeadline)
    if ($foreground -ne $alphaHandle) { throw 'Opening the same note did not focus its existing window.' }
    $deduplicated = [NativeMultiWindowTest]::VisibleWindows($process.Id) | Where-Object {
        [NativeMultiWindowTest]::Title($_)
    }
    if ($deduplicated.Count -ne 2) { throw 'Opening the same note created a duplicate window.' }

    [NativeMultiWindowTest]::SetForegroundWindow($mainHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    $beta = Find-NamedElement $mainRoot '打开 Beta.md'
    Invoke-ElementClick $beta
    $titleDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        Start-Sleep -Milliseconds 100
        $mainTitle = [NativeMultiWindowTest]::Title($mainHandle)
    } while ($mainTitle -ne 'Beta' -and [DateTime]::UtcNow -lt $titleDeadline)
    if ($mainTitle -ne 'Beta') { throw "The main taskbar title did not change: $mainTitle" }

    [NativeMultiWindowTest]::SetForegroundWindow($alphaHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    $auxiliaryTitle = Find-NamedElement $alphaRoot 'Alpha.md'
    Invoke-ElementDoubleClick $auxiliaryTitle
    try {
        $null = Find-NamedElement $alphaRoot '记录名称' 3
    } catch {
        $titleBounds = $auxiliaryTitle.Current.BoundingRectangle
        $windowBounds = $alphaRoot.Current.BoundingRectangle
        throw "Double-clicking an auxiliary note title did not enter rename mode. Title=$titleBounds Window=$windowBounds"
    }

    [NativeMultiWindowTest]::SetForegroundWindow($mainHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    [NativeMultiWindowTest]::SetForegroundWindow($alphaHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    $quickCreate = Find-NamedElement $alphaRoot '新建记录'
    Invoke-ElementAction $quickCreate
    $quickCreateDeadline = [DateTime]::UtcNow.AddSeconds(8)
    $defaultTitle = (Get-Date).ToString('yyyy-MM-dd')
    do {
        Start-Sleep -Milliseconds 100
        $createdHandle = [NativeMultiWindowTest]::VisibleWindows($process.Id) | Where-Object {
            [NativeMultiWindowTest]::Title($_) -eq $defaultTitle
        } | Select-Object -First 1
    } while ($null -eq $createdHandle -and [DateTime]::UtcNow -lt $quickCreateDeadline)
    if ($null -eq $createdHandle) {
        $visibleTitles = [NativeMultiWindowTest]::VisibleWindows($process.Id) | ForEach-Object {
            [NativeMultiWindowTest]::Title($_)
        }
        $visibleElements = [NativeMultiWindowTest]::VisibleWindows($process.Id) | ForEach-Object {
            $root = [System.Windows.Automation.AutomationElement]::FromHandle($_)
            $root.FindAll(
                [System.Windows.Automation.TreeScope]::Descendants,
                [System.Windows.Automation.Condition]::TrueCondition
            ) | ForEach-Object { if ($_.Current.Name) { $_.Current.Name } }
        }
        $stderrText = if (Test-Path -LiteralPath $stderrPath) { Get-Content -Raw -LiteralPath $stderrPath } else { '' }
        throw "Quick create did not open a new window with the default note name. Visible: $($visibleTitles -join ', '); elements: $($visibleElements -join ' | '); stderr: $stderrText"
    }
    $createdRoot = [System.Windows.Automation.AutomationElement]::FromHandle($createdHandle)
    $closeCreated = Find-NamedElement $createdRoot '关闭' 3
    try { Invoke-ElementAction $closeCreated } catch { }
    Start-Sleep -Milliseconds 300

    [NativeMultiWindowTest]::SetForegroundWindow($alphaHandle) | Out-Null
    Start-Sleep -Milliseconds 250
    Invoke-ElementAction $closeAuxiliary
    $closeDeadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        Start-Sleep -Milliseconds 100
        $remainingHandles = [NativeMultiWindowTest]::VisibleWindows($process.Id) | Where-Object {
            [NativeMultiWindowTest]::Title($_)
        }
    } while ($remainingHandles.Count -ne 1 -and [DateTime]::UtcNow -lt $closeDeadline)
    if ($remainingHandles.Count -ne 1 -or $remainingHandles[0] -ne $mainHandle) {
        throw 'The auxiliary close button did not close only its note window.'
    }

    [NativeMultiWindowTest]::PostMessage($mainHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    if (-not $process.WaitForExit(8000)) { throw 'The multi-window app did not close normally.' }
    if ($process.ExitCode -ne 0) { throw "The app returned exit code $($process.ExitCode)." }
    Write-Host 'PASS: Cross-window rename, quick-create window, title double-click and drag, auxiliary close, inactive content and title-button clicks, and dynamic titles all worked.'
}
finally {
    $env:LOCALAPPDATA = $originalLocalAppData
    $env:PYTHONPATH = $originalPythonPath
    if ($null -ne $process -and -not $process.HasExited) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $launcher -and -not $launcher.HasExited) {
        Stop-Process -Id $launcher.Id -Force -ErrorAction SilentlyContinue
    }
    $resolvedTestRoot = [IO.Path]::GetFullPath($testDataRoot).TrimEnd('\') + '\'
    $resolvedProfile = [IO.Path]::GetFullPath($testProfile)
    if ($resolvedProfile.StartsWith($resolvedTestRoot, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction SilentlyContinue
    }
}
