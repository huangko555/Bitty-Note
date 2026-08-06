param(
    [string]$OutputDirectory = 'release\store-exe'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
$version = & $python -c 'from desktop_notes import __version__; print(__version__)'
if ($LASTEXITCODE -ne 0 -or -not $version) {
    throw 'Unable to read the application version.'
}
$version = $version.Trim()

$packDirectory = Join-Path $projectRoot 'dist\Bitty-Note'
if (-not (Test-Path -LiteralPath (Join-Path $packDirectory 'Bitty-Note.exe'))) {
    throw 'Build output is missing. Run scripts\build.ps1 first.'
}

$outputPath = [IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$generatedInstaller = Join-Path $outputPath 'BittyNote-win-Setup.exe'
$versionedInstaller = Join-Path $outputPath "BittyNote-$version-win-Setup.exe"
if (Test-Path -LiteralPath $generatedInstaller) {
    Remove-Item -LiteralPath $generatedInstaller -Force
}
if (Test-Path -LiteralPath $versionedInstaller) {
    throw "A store installer for version $version already exists: $versionedInstaller"
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
    --outputDir $outputPath
if ($LASTEXITCODE -ne 0) {
    throw "Velopack packaging failed with exit code $LASTEXITCODE"
}

if (-not (Test-Path -LiteralPath $generatedInstaller)) {
    throw "Velopack installer is missing: $generatedInstaller"
}
Move-Item -LiteralPath $generatedInstaller -Destination $versionedInstaller
Write-Host "Microsoft Store EXE installer completed: $versionedInstaller"
