<#
.SYNOPSIS
  Prints the last lines of the App Service container log (agent stdout), optionally filtered.
  Uses the Kudu VFS API with an ARM token for the deployment account, so no publishing credentials are needed.

.EXAMPLE
  ./scripts/get-logs.ps1                      # last 200 lines
  ./scripts/get-logs.ps1 -Filter 'sso-test|signin|exchange' -Tail 400
#>
param(
  [int]$Tail = 200,
  [string]$Filter
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$state = Get-Content (Join-Path $PSScriptRoot '..\infra\.deploy-state.json') | ConvertFrom-Json
$token = az account get-access-token --subscription $state.subscriptionId --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $token" }
$kudu = "https://$($state.appServiceName).scm.azurewebsites.net"

$logs = Invoke-RestMethod -Headers $headers "$kudu/api/vfs/LogFiles/"
$latest = $logs | Where-Object name -like '*_default_docker.log' | Sort-Object mtime -Descending | Select-Object -First 1
if (-not $latest) { throw 'No container log found yet.' }

Write-Host "Log file: $($latest.name) (modified $($latest.mtime))" -ForegroundColor Cyan
$lines = (Invoke-WebRequest -Headers $headers $latest.href).Content -split "`n"
if ($Filter) { $lines = $lines | Select-String -Pattern $Filter | ForEach-Object Line }
$lines | Select-Object -Last $Tail
