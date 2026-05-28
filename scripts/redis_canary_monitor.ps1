# W8-S3 / W13 - sample orchestrator queue metrics (+ optional Redis XLEN/XPENDING).
#
# Usage:
#   cd oaao.ai-v1
#   .\scripts\redis_canary_monitor.ps1
#   .\scripts\redis_canary_monitor.ps1 -IntervalSeconds 900 -DurationSeconds 86400
#   .\scripts\start_redis_canary_monitor.ps1   # new window, 24h default
#   .\scripts\redis_canary_monitor.ps1 -IntervalSeconds 5 -DurationSeconds 1800 -CsvPath loadtest\2026-05-27\queue-depth.csv
param(
    [int]$IntervalSeconds = 900,
    [int]$DurationSeconds = 0,
    [string]$CsvPath = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = if ($env:OAAO_DOCKER_ENV) { $env:OAAO_DOCKER_ENV } else { Join-Path $Root 'docker\env' }
$Base = if ($env:OAAO_ORCHESTRATOR_INTERNAL_URL) { $env:OAAO_ORCHESTRATOR_INTERNAL_URL.TrimEnd('/') } else { 'http://127.0.0.1:8103' }
$Stream = if ($env:OAAO_QUEUE_REDIS_STREAM) { $env:OAAO_QUEUE_REDIS_STREAM } else { 'oaao:queue:post_stream_metrics' }

$Secret = $env:OAAO_ORCH_SHARED_SECRET
if (-not $Secret -and (Test-Path $EnvFile)) {
    $line = Get-Content $EnvFile | Where-Object { $_ -match '^OAAO_ORCH_SHARED_SECRET=' } | Select-Object -First 1
    if ($line) { $Secret = ($line -split '=', 2)[1].Trim() }
}
if (-not $Secret) {
    throw 'Set OAAO_ORCH_SHARED_SECRET or populate docker/env'
}

function Get-WorkQueuesStatus {
    $headers = @{ 'X-OAAO-Internal-Token' = $Secret }
    return Invoke-RestMethod -Uri "$Base/v1/work_queues/status" -Headers $headers -TimeoutSec 15
}

function Get-RedisStreamMetrics {
    $composeArgs = @('compose', '--env-file', $EnvFile, '--project-directory', $Root, '--profile', 'redis-canary', 'exec', '-T', 'redis', 'redis-cli')
    try {
        $xlen = (& docker @composeArgs XLEN $Stream 2>$null | Out-String).Trim()
        $xpendingRaw = (& docker @composeArgs XPENDING $Stream oaao-orchestrator 2>$null | Out-String).Trim()
        $xpending = ''
        if ($xpendingRaw) {
            $xpending = ($xpendingRaw -split '\s+')[0]
        }
        return @{ xlen = $xlen; xpending = $xpending }
    } catch {
        return @{ xlen = $null; xpending = $null }
    }
}

function Sample-Once {
    $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $status = Get-WorkQueuesStatus
    $backend = [string]$status.queue_backend
    $depth = 0
    $xack = 0
    if ($status.post_stream_pools) {
        foreach ($pool in $status.post_stream_pools) {
            $poolDepth = $pool.queue_depth
            if ($null -eq $poolDepth) { $poolDepth = 0 }
            $depth += [int]$poolDepth
            $poolXack = $pool.xack_failures
            if ($null -eq $poolXack) { $poolXack = 0 }
            $xack = [Math]::Max($xack, [int]$poolXack)
        }
    }
    $xlen = 'n/a'
    $xpending = 'n/a'
    if ($backend -eq 'redis') {
        $redis = Get-RedisStreamMetrics
        if ($null -ne $redis.xlen -and $redis.xlen -ne '') { $xlen = $redis.xlen }
        if ($null -ne $redis.xpending -and $redis.xpending -ne '') { $xpending = $redis.xpending }
    }
    Write-Host "[$ts] backend=$backend depth=$depth xack_failures=$xack xlen=$xlen xpending=$xpending"
    if ($CsvPath) {
        $row = "$ts,$backend,$depth,$xlen,$xpending,$xack"
        Add-Content -Path $CsvPath -Value $row -Encoding utf8
    }
}

if ($CsvPath) {
    $dir = Split-Path -Parent $CsvPath
    if ($dir -and -not (Test-Path $dir)) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    if (-not (Test-Path $CsvPath)) {
        Set-Content -Path $CsvPath -Value 'ts,queue_backend,queue_depth,xlen,xpending,xack_failures' -Encoding utf8
    }
}

$deadline = if ($DurationSeconds -gt 0) { (Get-Date).AddSeconds($DurationSeconds) } else { $null }

do {
    Sample-Once
    if (-not $deadline) { break }
    if ((Get-Date) -ge $deadline) { break }
    Start-Sleep -Seconds $IntervalSeconds
} while ($true)
