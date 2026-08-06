$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$version = & '.\.venv\Scripts\python.exe' -c 'from desktop_notes import __version__; print(__version__)'
if ($LASTEXITCODE -ne 0 -or -not $version) {
    throw 'Unable to read the application version.'
}
$version = $version.Trim()

$packDirectory = Join-Path $projectRoot 'dist\Bitty-Note'
if (-not (Test-Path -LiteralPath (Join-Path $packDirectory 'Bitty-Note.exe'))) {
    throw 'Build output is missing. Run scripts\build.ps1 first.'
}

dotnet tool restore
if ($LASTEXITCODE -ne 0) {
    throw "Unable to restore the Velopack build tool: $LASTEXITCODE"
}

dotnet tool run vpk pack `
    --packId 'BittyNote' `
    --packVersion $version `
    --packDir $packDirectory `
    --mainExe 'Bitty-Note.exe' `
    --packTitle 'Bitty Note' `
    --icon 'assets\app-icon.ico' `
    --outputDir 'release\github'
if ($LASTEXITCODE -ne 0) {
    throw "Velopack packaging failed with exit code $LASTEXITCODE"
}

$outputDirectory = Join-Path $projectRoot 'release\github'
$generatedInstaller = Join-Path $outputDirectory 'BittyNote-win-Setup.exe'
$versionedInstaller = Join-Path $outputDirectory "BittyNote-$version-win-Setup.exe"
if (-not (Test-Path -LiteralPath $generatedInstaller)) {
    throw "Velopack installer is missing: $generatedInstaller"
}
Move-Item -LiteralPath $generatedInstaller -Destination $versionedInstaller -Force

$assetsPath = Join-Path $outputDirectory 'assets.win.json'
if (Test-Path -LiteralPath $assetsPath) {
    $assets = Get-Content -Raw -LiteralPath $assetsPath | ConvertFrom-Json
    foreach ($asset in $assets) {
        if ($asset.Type -eq 'Installer') {
            $asset.RelativeFileName = Split-Path -Leaf $versionedInstaller
        }
    }
    $assetsJson = $assets | ConvertTo-Json -Compress
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($assetsPath, $assetsJson, $utf8NoBom)
}

Write-Host "GitHub release completed: $versionedInstaller"
