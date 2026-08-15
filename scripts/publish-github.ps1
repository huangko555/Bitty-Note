[CmdletBinding()]
param(
    [switch]$PreflightOnly
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$repository = 'huangko555/Bitty-Note'
$remote = 'origin'
$branch = 'main'
$assetNames = @(
    'BittyNote-{0}-win-Setup.exe',
    'BittyNote-{0}-full.nupkg',
    'BittyNote-win-Portable.zip',
    'releases.win.json',
    'assets.win.json',
    'RELEASES'
)

function Invoke-Checked {
    param(
        [Parameter(Mandatory)] [scriptblock]$Command,
        [Parameter(Mandatory)] [string]$FailureMessage
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage Exit code: $LASTEXITCODE"
    }
}

function Get-ReleaseInfo {
    param([Parameter(Mandatory)] [string]$Tag)

    $json = & gh release view $Tag --repo $repository `
        --json 'url,isDraft,isPrerelease,tagName,targetCommitish,publishedAt,assets' 2>$null
    if ($LASTEXITCODE -ne 0) {
        return $null
    }
    return $json | ConvertFrom-Json
}

function Get-FileDigest {
    param([Parameter(Mandatory)] [string]$Path)

    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Assert-ReleaseAssets {
    param(
        [Parameter(Mandatory)] $Release,
        [Parameter(Mandatory)] [string]$OutputDirectory,
        [Parameter(Mandatory)] [string[]]$ExpectedNames
    )

    $remoteAssets = @($Release.assets)
    if ($remoteAssets.Count -ne $ExpectedNames.Count) {
        throw "Release asset count mismatch: expected $($ExpectedNames.Count), got $($remoteAssets.Count)."
    }

    foreach ($name in $ExpectedNames) {
        $localPath = Join-Path $OutputDirectory $name
        if (-not (Test-Path -LiteralPath $localPath)) {
            throw "Local release asset is missing: $localPath"
        }

        $remoteAsset = @($remoteAssets | Where-Object name -eq $name)
        if ($remoteAsset.Count -ne 1) {
            throw "Remote release asset is missing or duplicated: $name"
        }

        $localFile = Get-Item -LiteralPath $localPath
        $localDigest = Get-FileDigest -Path $localPath
        $remoteDigest = [string]$remoteAsset[0].digest
        if ($remoteAsset[0].size -ne $localFile.Length) {
            throw "Release asset size mismatch: $name"
        }
        if ($remoteDigest -ne "sha256:$localDigest") {
            throw "Release asset digest mismatch: $name"
        }
    }
}

function Assert-PublishedReleaseShape {
    param(
        [Parameter(Mandatory)] $Release,
        [Parameter(Mandatory)] [string[]]$ExpectedNames
    )

    $remoteAssets = @($Release.assets)
    if ($remoteAssets.Count -ne $ExpectedNames.Count) {
        throw "Published release asset count mismatch: expected $($ExpectedNames.Count), got $($remoteAssets.Count)."
    }
    foreach ($name in $ExpectedNames) {
        $asset = @($remoteAssets | Where-Object name -eq $name)
        $digest = if ($asset.Count -eq 1) { [string]$asset[0].digest } else { '' }
        if ($asset.Count -ne 1 -or $asset[0].size -le 0 -or -not $digest.StartsWith('sha256:')) {
            throw "Published release asset is missing, duplicated, empty, or lacks a SHA-256 digest: $name"
        }
    }
}

function Send-ReleaseAsset {
    param(
        [Parameter(Mandatory)] [string]$Tag,
        [Parameter(Mandatory)] [string]$Path
    )

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        & gh release upload $Tag $Path --repo $repository --clobber
        if ($LASTEXITCODE -eq 0) {
            return
        }
        if ($attempt -lt 3) {
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
    throw "Unable to upload release asset after 3 attempts: $Path"
}

if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    throw 'Python virtual environment is missing. Run scripts\build.ps1 once to create it.'
}

$version = & '.\.venv\Scripts\python.exe' -c 'from desktop_notes import __version__; print(__version__)'
if ($LASTEXITCODE -ne 0 -or -not $version) {
    throw 'Unable to read the application version.'
}
$version = $version.Trim()
$tag = "v$version"
$expectedNames = $assetNames | ForEach-Object { $_ -f $version }
$head = (& git rev-parse HEAD).Trim()
$currentBranch = (& git branch --show-current).Trim()

if ($currentBranch -ne $branch) {
    throw "GitHub releases must run from branch '$branch'; current branch is '$currentBranch'."
}
if (& git status --porcelain) {
    throw 'The Git worktree must be clean before publishing.'
}
if (-not (Select-String -LiteralPath 'CHANGELOG.md' -Pattern "^## $([regex]::Escape($tag)) — " -Quiet)) {
    throw "CHANGELOG.md does not contain a release heading for $tag."
}

Invoke-Checked -FailureMessage 'Version consistency check failed.' -Command {
    & '.\.venv\Scripts\python.exe' '.\scripts\check_version.py'
}
Invoke-Checked -FailureMessage 'GitHub authentication check failed.' -Command {
    gh auth status
}

$existingRelease = Get-ReleaseInfo -Tag $tag
if ($existingRelease -and -not $existingRelease.isDraft) {
    if ($existingRelease.isPrerelease) {
        throw "$tag already exists as a prerelease."
    }
    $tagCommitOutput = & git rev-list -n 1 $tag 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $tagCommitOutput) {
        throw "$tag is already published but the local tag is missing."
    }
    $tagCommit = ([string]$tagCommitOutput).Trim()
    if ($tagCommit -ne $head) {
        throw "$tag is already published but does not point to the current commit."
    }
    Assert-PublishedReleaseShape -Release $existingRelease -ExpectedNames $expectedNames
    Write-Host "$tag is already published: $($existingRelease.url)"
    return
}

if ($PreflightOnly) {
    Write-Host "Preflight passed for $tag at $head."
    if ($existingRelease) {
        Write-Host 'A draft release already exists and can be resumed.'
    }
    return
}

Invoke-Checked -FailureMessage 'Build and tests failed.' -Command {
    & '.\scripts\build.ps1'
}

$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $releaseRoot 'github'))
if (-not $outputDirectory.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Resolved GitHub output path is outside the release directory.'
}
if (Test-Path -LiteralPath $outputDirectory) {
    $existingFiles = @(Get-ChildItem -LiteralPath $outputDirectory -Force)
    if ($existingFiles.Count -gt 0) {
        $archiveName = "archive-github-before-$tag-$(Get-Date -Format 'yyyyMMddHHmmss')"
        $archiveDirectory = [IO.Path]::GetFullPath((Join-Path $releaseRoot $archiveName))
        if (-not $archiveDirectory.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Resolved GitHub archive path is outside the release directory.'
        }
        if (Test-Path -LiteralPath $archiveDirectory) {
            throw "GitHub archive directory already exists: $archiveDirectory"
        }
        Move-Item -LiteralPath $outputDirectory -Destination $archiveDirectory
    }
}
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

Invoke-Checked -FailureMessage 'GitHub packaging failed.' -Command {
    & '.\scripts\package-github.ps1'
}

$localNames = @(Get-ChildItem -LiteralPath $outputDirectory -File | Select-Object -ExpandProperty Name)
if (@($localNames).Count -ne $expectedNames.Count) {
    throw "GitHub output must contain exactly $($expectedNames.Count) assets."
}
foreach ($name in $expectedNames) {
    if ($name -notin $localNames) {
        throw "GitHub output is missing: $name"
    }
}

$releaseManifest = Get-Content -Raw -LiteralPath (Join-Path $outputDirectory 'releases.win.json') | ConvertFrom-Json
$fullPackageName = "BittyNote-$version-full.nupkg"
$fullPackagePath = Join-Path $outputDirectory $fullPackageName
$manifestAsset = @($releaseManifest.Assets | Where-Object FileName -eq $fullPackageName)
if ($manifestAsset.Count -ne 1 -or $manifestAsset[0].Version -ne $version) {
    throw 'releases.win.json does not describe the expected full package and version.'
}
$fullPackage = Get-Item -LiteralPath $fullPackagePath
if ($manifestAsset[0].Size -ne $fullPackage.Length -or
    $manifestAsset[0].SHA256.ToLowerInvariant() -ne (Get-FileDigest -Path $fullPackagePath)) {
    throw 'releases.win.json does not match the full package size and SHA-256.'
}

$localTagOutput = & git rev-list -n 1 $tag 2>$null
if ($LASTEXITCODE -ne 0 -or -not $localTagOutput) {
    git -c user.name='huangko555' `
        -c user.email='43404722+huangko555@users.noreply.github.com' `
        tag -a $tag -m "Bitty Note $tag"
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to create tag $tag."
    }
} elseif (([string]$localTagOutput).Trim() -ne $head) {
    throw "Existing local tag $tag does not point to the current commit."
}

Invoke-Checked -FailureMessage 'Unable to push main and the release tag.' -Command {
    git push $remote $branch $tag
}

$notesPath = Join-Path $releaseRoot "release-notes-$tag.md"
$changelog = Get-Content -Raw -LiteralPath 'CHANGELOG.md'
$heading = "## $tag"
$start = $changelog.IndexOf($heading, [StringComparison]::Ordinal)
if ($start -lt 0) {
    throw "Unable to find $heading in CHANGELOG.md."
}
$next = $changelog.IndexOf("`n## v", $start + $heading.Length, [StringComparison]::Ordinal)
$notes = if ($next -lt 0) { $changelog.Substring($start) } else { $changelog.Substring($start, $next - $start) }
$notes = ($notes -split "`r?`n" | Select-Object -Skip 2) -join "`n"
[IO.File]::WriteAllText($notesPath, $notes.Trim() + "`n", (New-Object System.Text.UTF8Encoding($false)))

$release = Get-ReleaseInfo -Tag $tag
if (-not $release) {
    Invoke-Checked -FailureMessage 'Unable to create the draft GitHub Release.' -Command {
        gh release create $tag --repo $repository --title "Bitty Note $tag" `
            --notes-file $notesPath --verify-tag --draft
    }
} elseif (-not $release.isDraft) {
    throw "$tag became public before asset verification completed."
} else {
    Invoke-Checked -FailureMessage 'Unable to refresh the draft GitHub Release.' -Command {
        gh release edit $tag --repo $repository --title "Bitty Note $tag" `
            --notes-file $notesPath --draft
    }
}

foreach ($name in $expectedNames) {
    Send-ReleaseAsset -Tag $tag -Path (Join-Path $outputDirectory $name)
}

$draft = Get-ReleaseInfo -Tag $tag
if (-not $draft -or -not $draft.isDraft) {
    throw 'The release must remain a draft until every asset is verified.'
}
Assert-ReleaseAssets -Release $draft -OutputDirectory $outputDirectory -ExpectedNames $expectedNames

Invoke-Checked -FailureMessage 'Unable to publish the verified GitHub Release.' -Command {
    gh release edit $tag --repo $repository --draft=false --latest
}

$published = Get-ReleaseInfo -Tag $tag
if (-not $published -or $published.isDraft -or $published.isPrerelease) {
    throw 'The GitHub Release was not published as a stable release.'
}
Assert-ReleaseAssets -Release $published -OutputDirectory $outputDirectory -ExpectedNames $expectedNames

$latestManifest = Invoke-RestMethod -Uri "https://github.com/$repository/releases/latest/download/releases.win.json"
if ($latestManifest.Assets[0].Version -ne $version -or
    $latestManifest.Assets[0].FileName -ne $fullPackageName -or
    $latestManifest.Assets[0].SHA256.ToLowerInvariant() -ne (Get-FileDigest -Path $fullPackagePath)) {
    throw 'The public latest update manifest does not match the release package.'
}

$remoteMain = (& git rev-parse "$remote/$branch").Trim()
$tagCommit = (& git rev-list -n 1 $tag).Trim()
if ($head -ne $remoteMain -or $head -ne $tagCommit) {
    throw 'HEAD, origin/main, and the release tag do not point to the same commit.'
}

$setupPath = Join-Path $outputDirectory "BittyNote-$version-win-Setup.exe"
$setup = Get-Item -LiteralPath $setupPath
Write-Host "Published: $($published.url)"
Write-Host "Commit: $head"
Write-Host "Setup: $setupPath"
Write-Host "Setup size: $($setup.Length)"
Write-Host "Setup SHA-256: $((Get-FileHash -Algorithm SHA256 -LiteralPath $setupPath).Hash)"
