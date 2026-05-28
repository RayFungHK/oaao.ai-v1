<#
.SYNOPSIS
    Export OAAO endpoint + purpose settings to JSON (via web container).

.EXAMPLE
    ./scripts/oaao_endpoints_export.ps1 -OutFile .\endpoints-backup.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$OutFile,
    [switch]$Pretty,
    [int]$TenantId = 0
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$containerPath = '/tmp/oaao-endpoints-export.json'
$prettyFlag = if ($Pretty) { '--pretty' } else { '' }
$tenantFlag = if ($TenantId -gt 0) { "--tenant-id=$TenantId" } else { '' }

Push-Location $root
try {
    docker compose exec web php /var/www/html/scripts/oaao_endpoints_export.php `
        --out=$containerPath $prettyFlag $tenantFlag
    docker compose cp "web:${containerPath}" $OutFile
    Write-Host "Saved to $OutFile"
} finally {
    Pop-Location
}
