[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$versionSource = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'backend\desktop_notes\__init__.py')
if ($versionSource -notmatch '__version__\s*=\s*"([^"]+)"') {
    throw 'Unable to read the application version for the compatibility test.'
}
$expectedVersion = $Matches[1]
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$fixtureDirectory = Join-Path $tempRoot "bitty-publish-compat-$PID"
$fixtureDirectory = [IO.Path]::GetFullPath($fixtureDirectory)
if (-not $fixtureDirectory.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Fixture path is outside the temporary directory: $fixtureDirectory"
}
if (Test-Path -LiteralPath $fixtureDirectory) {
    throw "Fixture directory already exists: $fixtureDirectory"
}

New-Item -ItemType Directory -Path $fixtureDirectory | Out-Null
try {
    $missingReleaseCommand = Join-Path $fixtureDirectory 'missing-release.cmd'
    [IO.File]::WriteAllText(
        $missingReleaseCommand,
        "@echo off`r`necho release not found 1>&2`r`nexit /b 1`r`n",
        [Text.Encoding]::ASCII
    )
    $harnessPath = Join-Path $fixtureDirectory 'invoke-preflight.ps1'
    $harnessSource = @'
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string]$PublishScript,
    [Parameter(Mandatory)] [string]$MissingReleaseCommand
)

$ErrorActionPreference = 'Stop'

function global:git {
    param([Parameter(ValueFromRemainingArguments)] [string[]]$CommandArgs)

    $global:LASTEXITCODE = 0
    if ($CommandArgs[0] -eq 'rev-parse' -and $CommandArgs[1] -eq 'HEAD') {
        return '0000000000000000000000000000000000000000'
    }
    if ($CommandArgs[0] -eq 'branch' -and $CommandArgs[1] -eq '--show-current') {
        return 'main'
    }
    if ($CommandArgs[0] -eq 'status') {
        return
    }
    $global:LASTEXITCODE = 99
}

function global:gh {
    param([Parameter(ValueFromRemainingArguments)] [string[]]$CommandArgs)

    if ($CommandArgs[0] -eq 'auth') {
        $global:LASTEXITCODE = 0
        return
    }
    if ($CommandArgs[0] -eq 'release' -and $CommandArgs[1] -eq 'view') {
        & $MissingReleaseCommand
        return
    }
    $global:LASTEXITCODE = 99
}

& $PublishScript -PreflightOnly
'@
    [IO.File]::WriteAllText($harnessPath, $harnessSource, (New-Object Text.UTF8Encoding($false)))

    $windowsPowerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $output = & $windowsPowerShell -NoProfile -ExecutionPolicy Bypass `
        -File $harnessPath `
        -PublishScript (Join-Path $PSScriptRoot 'publish-github.ps1') `
        -MissingReleaseCommand $missingReleaseCommand 2>&1
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        throw "Windows PowerShell 5 preflight failed for a missing release:`n$($output -join "`n")"
    }
    $expectedOutput = 'Preflight passed for v' + [regex]::Escape($expectedVersion) + ' at 0{40}\.'
    if (($output -join "`n") -notmatch $expectedOutput) {
        throw "Preflight did not reach the missing-release success path:`n$($output -join "`n")"
    }

    Write-Host 'Windows PowerShell 5 missing-release preflight passed.'
} finally {
    if (Test-Path -LiteralPath $fixtureDirectory) {
        Remove-Item -LiteralPath $fixtureDirectory -Recurse -Force
    }
}
