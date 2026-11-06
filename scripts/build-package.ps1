<#
.SYNOPSIS
  Builds the Teams / Microsoft 365 app package (appPackage/build/sso-test-agent.zip) from
  manifest.template.json and infra/.deploy-state.json.
#>
param([string]$Version = '1.0.0')
$ErrorActionPreference = 'Stop'
$root  = Split-Path $PSScriptRoot -Parent
$pkg   = Join-Path $root 'appPackage'
$build = Join-Path $pkg 'build'
$state = Get-Content (Join-Path $root 'infra\.deploy-state.json') | ConvertFrom-Json
New-Item -ItemType Directory -Force $build | Out-Null

# Keep this generated ID locally so re-uploads update the same app.
$appIdFile = Join-Path $pkg 'teams-app-id.txt'
if (-not (Test-Path $appIdFile)) { [guid]::NewGuid().ToString() | Set-Content $appIdFile -NoNewline }
$teamsAppId = (Get-Content $appIdFile -Raw).Trim()

$manifest = (Get-Content (Join-Path $pkg 'manifest.template.json') -Raw).
  Replace('{{VERSION}}', $Version).
  Replace('{{TEAMS_APP_ID}}', $teamsAppId).
  Replace('{{BOT_ID}}', $state.botId).
  Replace('{{SSO_APP_ID}}', $state.ssoAppId).
  Replace('{{SSO_RESOURCE}}', $state.resourceUri)
$manifest | Set-Content (Join-Path $build 'manifest.json') -Encoding utf8NoBOM

if ($manifest -match '\{\{[^}]+\}\}') { throw 'The manifest contains unresolved placeholders.' }
$null = $manifest | ConvertFrom-Json
foreach ($icon in 'color.png', 'outline.png') {
  Copy-Item (Join-Path $pkg $icon) $build -Force
}

$zip = Join-Path $build 'sso-test-agent.zip'
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $build 'manifest.json'), (Join-Path $build 'color.png'), (Join-Path $build 'outline.png') -DestinationPath $zip
Write-Host "Teams app ID : $teamsAppId"
Write-Host "Package      : $zip"
