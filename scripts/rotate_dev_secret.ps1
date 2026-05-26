<#
.SYNOPSIS
    W11-S1 — Rotate the local dev OAAO_ORCH_SHARED_SECRET in docker/env.

.DESCRIPTION
    Generates a fresh 32-byte hex secret and rewrites the OAAO_ORCH_SHARED_SECRET
    line in docker/env. docker/env is not tracked in git (see .gitignore); for
    production use a secret manager (AWS SM / Vault / Doppler / k8s Secret).

.PARAMETER Print
    Only print a new secret to stdout; do not modify any file.

.EXAMPLE
    ./scripts/rotate_dev_secret.ps1
    ./scripts/rotate_dev_secret.ps1 -Print
#>
[CmdletBinding()]
param(
    [switch]$Print,
    [string]$EnvFile = "docker/env"
)

$ErrorActionPreference = "Stop"

function New-DevSecret {
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

if ($Print) {
    New-DevSecret
    return
}

if (-not (Test-Path $EnvFile)) {
    Write-Error "ERROR: $EnvFile not found. Copy from docker/env.example first."
    exit 1
}

$key = "OAAO_ORCH_SHARED_SECRET"
$secret = New-DevSecret
$backup = "$EnvFile.bak.$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $EnvFile $backup

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$text = [System.IO.File]::ReadAllText($EnvFile, $utf8NoBom)

if ($text -match "(?m)^$key=") {
    $new = [regex]::Replace($text, "(?m)^$key=.*$", "$key=$secret")
} else {
    $new = $text.TrimEnd("`r", "`n") + "`n$key=$secret`n"
}

[System.IO.File]::WriteAllText($EnvFile, $new, $utf8NoBom)

Write-Host "Rotated $key in $EnvFile"
Write-Host "Backup: $backup"
Write-Host "Restart: docker compose up -d orchestrator web"
