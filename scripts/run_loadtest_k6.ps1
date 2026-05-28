# W13-S1 - run k6 profile + capture profiling / queue-depth samples (Windows).
#
# Usage:
#   .\scripts\run_loadtest_k6.ps1 baseline-soak
#   .\scripts\run_loadtest_k6.ps1 stress-burst
#   .\scripts\run_loadtest_k6.ps1 baseline-soak -UseDocker   # if k6 not on PATH
param(
    [Parameter(Position = 0)]
    [ValidateSet('baseline-soak', 'stress-burst')]
    [string]$Profile = 'baseline-soak',
    [switch]$UseDocker
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = if ($env:OAAO_DOCKER_ENV) { $env:OAAO_DOCKER_ENV } else { Join-Path $Root 'docker\env' }
$DateTag = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
$OutDir = Join-Path $Root "loadtest\$DateTag"
$Script = Join-Path $Root "loadtest\k6\$Profile.js"

if (-not (Test-Path $Script)) { throw "Missing $Script" }

if (-not $env:OAAO_ORCH_SHARED_SECRET -and (Test-Path $EnvFile)) {
    $line = Get-Content $EnvFile | Where-Object { $_ -match '^OAAO_ORCH_SHARED_SECRET=' } | Select-Object -First 1
    if ($line) { $env:OAAO_ORCH_SHARED_SECRET = ($line -split '=', 2)[1].Trim() }
}
if (-not $env:OAAO_ORCH_SHARED_SECRET) { throw 'Set OAAO_ORCH_SHARED_SECRET or populate docker/env' }

if (-not $env:OAAO_ORCHESTRATOR_URL) {
    $env:OAAO_ORCHESTRATOR_URL = 'http://127.0.0.1:8103'
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$Summary = Join-Path $OutDir "k6-$Profile-summary.json"
$Profiling = Join-Path $OutDir 'orch-profiling.json'
$QueueCsv = Join-Path $OutDir 'queue-depth.csv'

Write-Host "== Output: $OutDir =="

$monJob = $null
$durationSec = if ($Profile -eq 'stress-burst') { 420 } else { 1800 }
try {
    $monJob = Start-Job -ScriptBlock {
        param($Root, $Csv, $Dur, $Interval)
        Set-Location $Root
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts\redis_canary_monitor.ps1') `
            -IntervalSeconds $Interval -DurationSeconds $Dur -CsvPath $Csv
    } -ArgumentList $Root, $QueueCsv, $durationSec, 5
} catch {
    Write-Warning "Queue monitor job not started: $_"
}

$k6Exit = 0
try {
    if ($UseDocker -or -not (Get-Command k6 -ErrorAction SilentlyContinue)) {
        if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
            throw 'k6 not on PATH; install with: winget install GrafanaLabs.k6 — or pass -UseDocker with Docker running'
        }
        $k6ScriptDir = (Join-Path $Root 'loadtest\k6').Replace('\', '/')
        docker run --rm `
            -e OAAO_ORCH_SHARED_SECRET=$env:OAAO_ORCH_SHARED_SECRET `
            -e OAAO_ORCHESTRATOR_URL=$env:OAAO_ORCHESTRATOR_URL `
            -e OAAO_K6_VUS=$env:OAAO_K6_VUS `
            -e OAAO_K6_DURATION=$env:OAAO_K6_DURATION `
            -e OAAO_K6_HOLD=$env:OAAO_K6_HOLD `
            -e OAAO_K6_SLEEP_SEC=$env:OAAO_K6_SLEEP_SEC `
            -v "${Root}/loadtest/k6:/scripts:ro" `
            -v "${OutDir}:/out" `
            --add-host=host.docker.internal:host-gateway `
            grafana/k6 run --summary-export "/out/k6-$Profile-summary.json" "/scripts/$Profile.js"
        if ($LASTEXITCODE -ne 0) { $k6Exit = $LASTEXITCODE }
    } else {
        & k6 run --summary-export $Summary $Script
        if ($LASTEXITCODE -ne 0) { $k6Exit = $LASTEXITCODE }
    }
} catch {
    $k6Exit = 1
    throw
} finally {
    if ($monJob) {
        Wait-Job $monJob -Timeout 30 | Out-Null
        Remove-Job $monJob -Force -ErrorAction SilentlyContinue
    }
}

$base = $env:OAAO_ORCHESTRATOR_URL.TrimEnd('/')
try {
    $headers = @{ 'X-OAAO-Internal-Token' = $env:OAAO_ORCH_SHARED_SECRET }
    Invoke-RestMethod -Uri "$base/v1/admin/profiling" -Headers $headers -TimeoutSec 15 |
        ConvertTo-Json -Depth 8 | Set-Content -Path $Profiling -Encoding utf8
} catch {
    '{"ok":false,"note":"profiling fetch failed"}' | Set-Content -Path $Profiling -Encoding utf8
}

Write-Host 'Wrote:'
Write-Host "  $Summary"
Write-Host "  $Profiling"
Write-Host "  $QueueCsv"

exit $k6Exit
