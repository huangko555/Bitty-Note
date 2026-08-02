$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$version = & '.\.venv\Scripts\python.exe' -c 'from desktop_notes import __version__; print(__version__)'
if ($LASTEXITCODE -ne 0 -or -not $version) {
    throw 'Unable to read the application version.'
}

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
    --packVersion $version.Trim() `
    --packDir $packDirectory `
    --mainExe 'Bitty-Note.exe' `
    --packTitle 'Bitty-Note' `
    --icon 'assets\app-icon.ico' `
    --outputDir 'release\velopack'
if ($LASTEXITCODE -ne 0) {
    throw "Velopack packaging failed with exit code $LASTEXITCODE"
}

Write-Host "Portable release completed: release\velopack\BittyNote-Portable.zip"
