# Open a new window and run redis_canary_monitor.ps1 (24h default).
#
# Usage:
#   .\scripts\start_redis_canary_monitor.ps1
#   .\scripts\start_redis_canary_monitor.ps1 -IntervalSeconds 300 -DurationSeconds 3600
param(
    [int]$IntervalSeconds = 900,
    [int]$DurationSeconds = 86400
)

$Monitor = Join-Path $PSScriptRoot 'redis_canary_monitor.ps1'
if (-not (Test-Path $Monitor)) { throw "Missing $Monitor" }

$args = @(
    '-NoExit',
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', $Monitor,
    '-IntervalSeconds', $IntervalSeconds,
    '-DurationSeconds', $DurationSeconds
)

Start-Process powershell -WorkingDirectory (Split-Path -Parent $PSScriptRoot) -ArgumentList $args
Write-Host "Started monitor in new window (interval=${IntervalSeconds}s, duration=${DurationSeconds}s)."
