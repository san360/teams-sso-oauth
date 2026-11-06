<#
.SYNOPSIS
  Shows recent Entra sign-ins that involve the SSO app (as resource or as client), interactive and non-interactive.
  This is where a silent SSO failure shows its real reason (AADSTS code), before anything reaches the bot.

.EXAMPLE
  ./scripts/get-signins.ps1 -Minutes 30
#>
param([int]$Minutes = 60)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$state = Get-Content (Join-Path $PSScriptRoot '..\infra\.deploy-state.json') | ConvertFrom-Json
$token = az account get-access-token --subscription $state.subscriptionId --resource-type ms-graph --query accessToken -o tsv
$since = (Get-Date).ToUniversalTime().AddMinutes(-$Minutes).ToString('yyyy-MM-ddTHH:mm:ssZ')

$rows = foreach ($type in 'interactiveUser', 'nonInteractiveUser') {
  foreach ($field in 'resourceId', 'appId') {
    $filter = "createdDateTime ge $since and $field eq '$($state.ssoAppId)' and signInEventTypes/any(t: t eq '$type')"
    $uri = "https://graph.microsoft.com/beta/auditLogs/signIns?`$filter=$([uri]::EscapeDataString($filter))&`$top=50"
    (Invoke-RestMethod -Headers @{ Authorization = "Bearer $token" } $uri).value | ForEach-Object {
      [pscustomobject]@{
        TimeUtc  = $_.createdDateTime
        Type     = $type
        Client   = $_.appDisplayName
        Resource = $_.resourceDisplayName
        Code     = $_.status.errorCode
        Reason   = $_.status.failureReason
      }
    }
  }
}
if (-not $rows) { Write-Host "No sign-ins for the SSO app in the last $Minutes minutes (sign-in logs can lag 2-10 minutes)." }
$rows | Sort-Object TimeUtc -Unique | Format-Table -AutoSize -Wrap
