<#
.SYNOPSIS
    Import OAAO endpoint + purpose settings from JSON (via web container).

.EXAMPLE
    ./scripts/oaao_endpoints_import.ps1 -InFile .\endpoints-backup.json
    ./scripts/oaao_endpoints_import.ps1 -InFile .\endpoints-backup.json -DryRun
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InFile,
    [switch]$DryRun,
    [int]$TenantId = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$containerPath = '/tmp/oaao-endpoints-import.json'
$dryFlag = if ($DryRun) { '--dry-run' } else { '' }
$tenantFlag = if ($TenantId -gt 0) { "--tenant-id=$TenantId" } else { '' }

if (-not (Test-Path $InFile)) {
    Write-Error "File not found: $InFile"
}

Push-Location $root
try {
    docker compose cp $InFile "web:${containerPath}"
    docker compose exec web php /var/www/html/scripts/oaao_endpoints_import.php `
        --in=$containerPath $dryFlag $tenantFlag
} finally {
    Pop-Location
}
