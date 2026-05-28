# Write oaao.ai-v1 version + build metadata (Windows dev).
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$VersionFile = Join-Path $Root 'VERSION'
$OutRepo = Join-Path $Root 'build\oaao_build_info.json'
$OutConfig = Join-Path $Root 'backbone\config\oaaoai\build_info.json'

$Version = (Get-Content -Raw $VersionFile).Trim()
$GitSha = 'dev'
$GitBranch = 'local'
$Dirty = $false
if (Get-Command git -ErrorAction SilentlyContinue) {
    Push-Location $Root
    try {
        $GitSha = (git rev-parse --short HEAD 2>$null)
        if (-not $GitSha) { $GitSha = 'dev' }
        $GitBranch = (git rev-parse --abbrev-ref HEAD 2>$null)
        if (-not $GitBranch) { $GitBranch = 'local' }
        $Dirty = [bool](git status --porcelain 2>$null)
    } finally {
        Pop-Location
    }
}
$BuiltAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$BuildId = $GitSha
if ($Dirty) { $BuildId = "${BuildId}-dirty" }

$Payload = [ordered]@{
    version   = $Version
    build_id  = $BuildId
    built_at  = $BuiltAt
    git_sha   = $GitSha
    git_branch = $GitBranch
    dirty     = $Dirty
    component = 'oaaoai-v1'
}
$Json = ($Payload | ConvertTo-Json -Depth 4) + "`n"
New-Item -ItemType Directory -Force -Path (Split-Path $OutRepo) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $OutConfig) | Out-Null
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($OutRepo, $Json, $Utf8NoBom)
[System.IO.File]::WriteAllText($OutConfig, $Json, $Utf8NoBom)
Write-Host "wrote $OutRepo"
Write-Host "wrote $OutConfig"
