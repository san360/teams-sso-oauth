<#
.SYNOPSIS
  Resets consent so a test phase can be repeated: deletes ALL delegated permission grants
  (admin and user consent) where the SSO app is the client.
  Also ask the test user to type "logout" in the chat to clear the cached token in the Bot Framework Token Service.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param()
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$state = Get-Content (Join-Path $PSScriptRoot '..\infra\.deploy-state.json') | ConvertFrom-Json
$token = az account get-access-token --subscription $state.subscriptionId --resource-type ms-graph --query accessToken -o tsv
$headers = @{ Authorization = "Bearer $token" }

$grants = (Invoke-RestMethod -Headers $headers "https://graph.microsoft.com/v1.0/oauth2PermissionGrants?`$filter=clientId eq '$($state.ssoServicePrincipalId)'").value
foreach ($g in $grants) {
  if ($PSCmdlet.ShouldProcess('SSO sample delegated permission grant', "Delete $($g.consentType) consent for $($g.scope.Trim())")) {
    Invoke-RestMethod -Method Delete -Headers $headers "https://graph.microsoft.com/v1.0/oauth2PermissionGrants/$($g.id)" | Out-Null
    Write-Host "Deleted $($g.consentType) grant: $($g.scope.Trim())"
  }
}
if (-not $grants) { Write-Host 'No consent grants to delete.' }
