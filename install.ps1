<#
.SYNOPSIS
    Installs see-crets on Windows.

.DESCRIPTION
    Downloads the see-crets binary for Windows x64, verifies its SHA256
    checksum, installs it to the specified prefix (or the default location
    "$env:USERPROFILE\.see-crets\bin"), and adds the install directory to
    the current user's PATH (HKCU — no elevation required).

.PARAMETER Prefix
    Optional install directory.  Defaults to "$env:USERPROFILE\.see-crets\bin".

.EXAMPLE
    # From a PowerShell session (PS 5.1 or 7+):
    iex (irm 'https://raw.githubusercontent.com/yldgio/see-crets/main/install.ps1')

.EXAMPLE
    # From cmd.exe (spawns powershell.exe — may fail in VS Code or some terminal hosts):
    PowerShell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/yldgio/see-crets/main/install.ps1 | iex"

.EXAMPLE
    # Pin a specific version (from a PowerShell session):
    $env:VERSION='1.2.3'; iex (irm 'https://raw.githubusercontent.com/yldgio/see-crets/main/install.ps1')

.EXAMPLE
    .\install.ps1 -Prefix C:\tools

.NOTES
    Compatible with Windows PowerShell 5.1 and PowerShell 7+.
    No null-coalescing (??), null-conditional (?.), or ternary operators used.
#>
[CmdletBinding()]
param(
    [string]$Prefix = ""
)

# ─── Helpers ────────────────────────────────────────────────────────────────

# Shared temp-dir reference so cleanup can run before any exit point.
$Script:_tmpDir = $null

function Remove-TmpDir {
    if ($null -ne $Script:_tmpDir -and (Test-Path $Script:_tmpDir)) {
        Remove-Item -Path $Script:_tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Exit-Fatal {
    param(
        [string]$Message
    )
    Write-Host "ERROR: $Message" -ForegroundColor Red
    Remove-TmpDir
    throw $Message
}

function Verify-Cosign {
    param(
        [string]$ChecksumsPath,
        [string]$ChecksumsUrl
    )

    if (-not (Get-Command 'cosign' -ErrorAction SilentlyContinue)) {
        if ($env:COSIGN_ENFORCE -eq '1') {
            Exit-Fatal "COSIGN_ENFORCE=1 but cosign is not installed. Install cosign and retry."
        }
        Write-Warning "cosign not found — skipping out-of-band provenance verification."
        Write-Warning "For stronger supply-chain guarantees, install cosign: https://docs.sigstore.dev/cosign/installation"
        return
    }

    $bundleUrl  = $ChecksumsUrl -replace '\.txt$', '.txt.bundle'
    $bundlePath = Join-Path $Script:_tmpDir 'checksums.txt.bundle'

    try {
        Invoke-WebRequest -Uri $bundleUrl -OutFile $bundlePath -UseBasicParsing -ErrorAction Stop
    } catch {
        Write-Warning "cosign bundle not available for this release — skipping provenance verification."
        return
    }

    $result = & cosign verify-blob `
        --bundle $bundlePath `
        --certificate-identity-regexp "https://github.com/yldgio/see-crets/.*" `
        --certificate-oidc-issuer "https://token.actions.githubusercontent.com" `
        $ChecksumsPath 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Cosign provenance verified ✓" -ForegroundColor Green
    } else {
        Write-Warning "Cosign verification failed — checksums.txt may have been tampered with."
        if ($env:COSIGN_ENFORCE -eq '1') {
            Exit-Fatal "Aborting: COSIGN_ENFORCE=1"
        }
    }
}

# ─── Architecture detection ──────────────────────────────────────────────────

$arch    = $env:PROCESSOR_ARCHITECTURE
$archWow = $env:PROCESSOR_ARCHITEW6432

# WOW64 processes report AMD64 in PROCESSOR_ARCHITEW6432 even when $arch is x86.
# Check WOW64 first so 32-bit host processes on 64-bit OS still resolve correctly.
$resolvedArch = $null
if ($archWow -eq 'AMD64' -or $arch -eq 'AMD64') {
    $resolvedArch = 'x64'
} elseif ($archWow -eq 'ARM64' -or $arch -eq 'ARM64') {
    Write-Host "ERROR: ARM64 is not yet supported." -ForegroundColor Red
    Write-Host "       Check https://github.com/yldgio/see-crets/releases for ARM64 availability." -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "ERROR: Unsupported processor architecture: '$arch'." -ForegroundColor Red
    Write-Host "       Only AMD64/x64 is currently supported." -ForegroundColor Yellow
    exit 1
}

# ─── Version resolution ──────────────────────────────────────────────────────

$Version = $null
if (-not [string]::IsNullOrWhiteSpace($env:VERSION)) {
    $Version = $env:VERSION.Trim().TrimStart('v')
    # Reject path-traversal sequences and invalid chars so VERSION cannot redirect the
    # download URL to a different repository.
    if ([string]::IsNullOrWhiteSpace($Version)) {
        Exit-Fatal "VERSION is empty after trimming. Provide a valid semver (e.g. 1.2.3)."
    }
    if ($Version -match '[/\\]' -or $Version -match '\.\.') {
        Exit-Fatal "VERSION contains invalid characters ('/', '\', or '..'). Provide a plain semver (e.g. 1.2.3)."
    }
} else {
    Write-Host "Fetching latest release version..."
    try {
        if ($PSVersionTable.PSVersion.Major -lt 6) {
            $releaseInfo = Invoke-RestMethod `
                -Uri 'https://api.github.com/repos/yldgio/see-crets/releases/latest' `
                -UseBasicParsing `
                -ErrorAction Stop
        } else {
            $releaseInfo = Invoke-RestMethod `
                -Uri 'https://api.github.com/repos/yldgio/see-crets/releases/latest' `
                -ErrorAction Stop
        }
        $Version = ([string]$releaseInfo.tag_name).TrimStart('v')
        if ([string]::IsNullOrWhiteSpace($Version)) {
            Exit-Fatal "GitHub API returned an empty or invalid version tag. Use `$env:VERSION` to pin a version."
        }
    } catch {
        $statusCode = 0
        if ($null -ne $_.Exception.Response) {
            try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
        }
        if ($statusCode -eq 403 -or $statusCode -eq 429) {
            Write-Host "ERROR: GitHub API rate limit hit (HTTP $statusCode)." -ForegroundColor Red
            Write-Host "       Pin a version with the VERSION environment variable:" -ForegroundColor Yellow
            Write-Host '         $env:VERSION=''1.2.3''; irm https://raw.githubusercontent.com/yldgio/see-crets/main/install.ps1 | iex' -ForegroundColor Yellow
            exit 1
        }
        Exit-Fatal "Failed to fetch latest release from GitHub API: $_"
    }
}

Write-Host "Installing see-crets v$Version (windows-$resolvedArch)..."

# ─── Prepare temp directory ──────────────────────────────────────────────────

$Script:_tmpDir = Join-Path $env:TEMP "see-crets-install-$(Get-Random)"
New-Item -ItemType Directory -Path $Script:_tmpDir -Force | Out-Null

# ─── Download ────────────────────────────────────────────────────────────────

$assetName    = "see-crets-windows-$resolvedArch.exe"
$baseUrl      = "https://github.com/yldgio/see-crets/releases/download/v$Version"
$binaryPath   = Join-Path $Script:_tmpDir $assetName
$checksumPath = Join-Path $Script:_tmpDir 'checksums.txt'

Write-Host "Downloading $assetName..."
try {
    if ($PSVersionTable.PSVersion.Major -lt 6) {
        Invoke-WebRequest `
            -Uri     "$baseUrl/$assetName" `
            -OutFile $binaryPath `
            -UseBasicParsing `
            -ErrorAction Stop
    } else {
        Invoke-WebRequest `
            -Uri     "$baseUrl/$assetName" `
            -OutFile $binaryPath `
            -ErrorAction Stop
    }
} catch {
    Exit-Fatal "Download failed for '$assetName': $_"
}

Write-Host "Downloading checksums.txt..."
try {
    if ($PSVersionTable.PSVersion.Major -lt 6) {
        Invoke-WebRequest `
            -Uri     "$baseUrl/checksums.txt" `
            -OutFile $checksumPath `
            -UseBasicParsing `
            -ErrorAction Stop
    } else {
        Invoke-WebRequest `
            -Uri     "$baseUrl/checksums.txt" `
            -OutFile $checksumPath `
            -ErrorAction Stop
    }
} catch {
    Exit-Fatal "Download failed for 'checksums.txt': $_"
}

# ─── Verify SHA256 ───────────────────────────────────────────────────────────

Write-Host "Verifying SHA256 checksum..."

$actualHash   = (Get-FileHash -Path $binaryPath -Algorithm SHA256).Hash.ToLowerInvariant()
$expectedHash = $null

foreach ($line in (Get-Content -Path $checksumPath)) {
    # sha256sum format: "<64-hex-chars>  <filename>"  (two spaces between hash and name)
    if ($line -match '^([0-9a-fA-F]{64})\s+(.+)$') {
        $lineFile = $Matches[2].Trim()
        if ($lineFile -eq $assetName) {
            $expectedHash = $Matches[1].ToLowerInvariant()
            break
        }
    }
}

if ($null -eq $expectedHash) {
    Exit-Fatal "Checksum entry for '$assetName' not found in checksums.txt."
}

if ($actualHash -ne $expectedHash) {
    Write-Host "ERROR: Checksum mismatch for $assetName!" -ForegroundColor Red
    Write-Host "  Expected : $expectedHash" -ForegroundColor Red
    Write-Host "  Actual   : $actualHash" -ForegroundColor Red
    Write-Host "  The download may be corrupted. Please try again." -ForegroundColor Yellow
    Remove-TmpDir
    exit 1
}

Write-Host "Checksum OK."

# ─── Cosign out-of-band verification (optional) ──────────────────────────────

Verify-Cosign -ChecksumsPath $checksumPath -ChecksumsUrl "$baseUrl/checksums.txt"

# ─── Install ─────────────────────────────────────────────────────────────────

$installDir = $null
if (-not [string]::IsNullOrWhiteSpace($Prefix)) {
    $installDir = $Prefix.Trim()
} else {
    $installDir = Join-Path $env:USERPROFILE '.see-crets\bin'
}

try {
    Write-Host "Installing to $installDir ..."
    New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    $installPath = Join-Path $installDir 'see-crets.exe'
    Copy-Item -Path $binaryPath -Destination $installPath -Force -ErrorAction Stop
} catch {
    Exit-Fatal "Failed to install to '$installDir': $($_.Exception.Message)"
} finally {
    Remove-TmpDir
}

Write-Host "Installed: $installPath"

# ─── PATH update (HKCU — no elevation required) ──────────────────────────────

$userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($null -eq $userPath) {
    $userPath = ''
}

$pathEntries   = @($userPath -split ';' | Where-Object { $_.Trim() -ne '' })
$normalTarget  = $installDir.TrimEnd('\').ToLowerInvariant()
$alreadyInPath = $false

foreach ($entry in $pathEntries) {
    if ($entry.TrimEnd('\').ToLowerInvariant() -eq $normalTarget) {
        $alreadyInPath = $true
        break
    }
}

if (-not $alreadyInPath) {
    $newPath = ($pathEntries + $installDir) -join ';'
    [Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
    Write-Host "Added '$installDir' to user PATH."
    Write-Host "A new terminal session is required for PATH changes to take effect."
} else {
    Write-Host "'$installDir' is already in user PATH."
}

# ─── Done ────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "see-crets v$Version installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open a new terminal (required for PATH changes to take effect)."
Write-Host "  2. Verify installation : see-crets --version"
Write-Host "  3. Get started         : see-crets list"
