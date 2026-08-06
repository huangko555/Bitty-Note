param(
    [Parameter(Mandatory = $true)]
    [string]$IdentityName,
    [Parameter(Mandatory = $true)]
    [string]$Publisher,
    [Parameter(Mandatory = $true)]
    [string]$PublisherDisplayName,
    [string]$CertificateThumbprint
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
$version = & $python -c 'from desktop_notes import __version__; print(__version__)'
if ($LASTEXITCODE -ne 0 -or -not $version) {
    throw 'Unable to read the application version.'
}
$msixVersion = "$($version.Trim()).0"

$appDirectory = Join-Path $projectRoot 'dist\Bitty-Note'
if (-not (Test-Path -LiteralPath (Join-Path $appDirectory 'Bitty-Note.exe'))) {
    throw 'Build output is missing. Run scripts\build.ps1 first.'
}

function Find-SdkTool([string]$Name) {
    $roots = @(
        'C:\Program Files (x86)\Windows Kits\10\bin',
        (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.nuget\packages\microsoft.windows.sdk.buildtools')
    )
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        $tool = Get-ChildItem -LiteralPath $root -Filter $Name -Recurse -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "\\x64\\$([regex]::Escape($Name))$" } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($tool) { return $tool }
    }
    return $null
}

$makeAppx = Find-SdkTool 'MakeAppx.exe'
if (-not $makeAppx) {
    dotnet restore '.\packaging\WindowsSdkBuildTools.csproj'
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to restore Microsoft Windows SDK Build Tools: $LASTEXITCODE"
    }
    $makeAppx = Find-SdkTool 'MakeAppx.exe'
}
if (-not $makeAppx) {
    throw 'MakeAppx.exe was not found after restoring Microsoft Windows SDK Build Tools.'
}

$buildRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'build'))
$packageRoot = [IO.Path]::GetFullPath((Join-Path $buildRoot 'msix-package'))
if (-not $packageRoot.StartsWith($buildRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Resolved MSIX staging path is outside the build directory.'
}
if (Test-Path -LiteralPath $packageRoot) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $packageRoot | Out-Null
Copy-Item -LiteralPath $appDirectory -Destination (Join-Path $packageRoot 'Bitty-Note') -Recurse

& $python '.\scripts\build_msix_assets.py' '.\assets\app-icon.png' (Join-Path $packageRoot 'Assets')
if ($LASTEXITCODE -ne 0) {
    throw "Unable to build MSIX image assets: $LASTEXITCODE"
}

$manifest = Get-Content -Raw -LiteralPath '.\packaging\AppxManifest.xml.template'
$manifest = $manifest.Replace('__IDENTITY_NAME__', [System.Security.SecurityElement]::Escape($IdentityName))
$manifest = $manifest.Replace('__PUBLISHER__', [System.Security.SecurityElement]::Escape($Publisher))
$manifest = $manifest.Replace('__PUBLISHER_DISPLAY_NAME__', [System.Security.SecurityElement]::Escape($PublisherDisplayName))
$manifest = $manifest.Replace('__VERSION__', $msixVersion)
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $packageRoot 'AppxManifest.xml'), $manifest, $utf8NoBom)

$outputDirectory = Join-Path $projectRoot 'release\store'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$outputPackage = Join-Path $outputDirectory "BittyNote-$($version.Trim())-x64.msix"
& $makeAppx.FullName pack /d $packageRoot /p $outputPackage /o
if ($LASTEXITCODE -ne 0) {
    throw "MSIX packaging failed with exit code $LASTEXITCODE"
}

if ($CertificateThumbprint) {
    $signTool = Find-SdkTool 'SignTool.exe'
    if (-not $signTool) {
        throw 'SignTool.exe was not found in the Windows SDK.'
    }
    & $signTool.FullName sign /fd SHA256 /sha1 $CertificateThumbprint $outputPackage
    if ($LASTEXITCODE -ne 0) {
        throw "MSIX signing failed with exit code $LASTEXITCODE"
    }
}

Write-Host "Store package completed: $outputPackage"
