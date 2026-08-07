param(
    [Parameter(Mandatory = $true)]
    [string]$IdentityName,
    [Parameter(Mandatory = $true)]
    [string]$Publisher,
    [Parameter(Mandatory = $true)]
    [string]$PublisherDisplayName,
    [string]$CertificateThumbprint,
    [string]$PackageVersion
)

$ErrorActionPreference = 'Stop'

& (Join-Path $PSScriptRoot 'package-store-msix.ps1') @PSBoundParameters
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
