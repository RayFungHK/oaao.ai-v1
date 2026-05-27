# W8-S3 Stage 2 - enable Redis queue backend (Windows dev).
# Usage: .\scripts\redis_canary_stage2_enable.ps1 [-Check] [-Rollback]
param(
    [switch]$Check,
    [switch]$Rollback
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = if ($env:OAAO_DOCKER_ENV) { $env:OAAO_DOCKER_ENV } else { Join-Path $Root 'docker\env' }
$RedisUrl = if ($env:OAAO_QUEUE_REDIS_URL) { $env:OAAO_QUEUE_REDIS_URL } else { 'redis://redis:6379/0' }

function Set-EnvKv($Key, $Val) {
    if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile - copy from docker/env.example" }
    $lines = Get-Content $EnvFile
    $found = $false
    $out = foreach ($line in $lines) {
        if ($line -match "^${Key}=") { $found = $true; "${Key}=${Val}" }
        else { $line }
    }
    if (-not $found) { $out += "${Key}=${Val}" }
    $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($EnvFile, ($out -join "`n") + "`n", $Utf8NoBom)
}

function Remove-EnvKv($Key) {
    if (-not (Test-Path $EnvFile)) { return }
    $out = Get-Content $EnvFile | Where-Object { $_ -notmatch "^${Key}=" }
    $Utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($EnvFile, ($out -join "`n") + "`n", $Utf8NoBom)
}

function Verify-Backend {
    $secretLine = (Get-Content $EnvFile | Where-Object { $_ -match '^OAAO_ORCH_SHARED_SECRET=' } | Select-Object -First 1)
    if (-not $secretLine) { throw 'OAAO_ORCH_SHARED_SECRET missing in docker/env' }
    $secret = ($secretLine -split '=', 2)[1].Trim()
    Write-Host '== GET /v1/work_queues/status =='
    docker compose --env-file $EnvFile --project-directory $Root exec -T orchestrator python -c @"
import json, urllib.request
req = urllib.request.Request(
    'http://127.0.0.1:8103/v1/work_queues/status',
    headers={'X-OAAO-Internal-Token': '$secret'},
)
with urllib.request.urlopen(req, timeout=10) as r:
    print(json.dumps(json.load(r), indent=2))
"@
    Write-Host ''
}

Push-Location $Root
try {
    if ($Check) { Verify-Backend; return }
    if ($Rollback) {
        Set-EnvKv 'OAAO_QUEUE_BACKEND' 'memory'
        Remove-EnvKv 'OAAO_QUEUE_REDIS_URL'
        docker compose --env-file $EnvFile --project-directory $Root up -d --force-recreate orchestrator
        Start-Sleep -Seconds 3
        Verify-Backend
        return
    }

    docker compose --env-file $EnvFile --profile redis-canary --project-directory $Root up -d redis
    Set-EnvKv 'OAAO_QUEUE_BACKEND' 'redis'
    Set-EnvKv 'OAAO_QUEUE_REDIS_URL' $RedisUrl
    docker compose --env-file $EnvFile --project-directory $Root up -d --force-recreate orchestrator
    Start-Sleep -Seconds 5
    Verify-Backend
    Write-Host 'Monitor: bash scripts/redis_canary_monitor.sh --interval 900 --duration 86400'
} finally {
    Pop-Location
}
