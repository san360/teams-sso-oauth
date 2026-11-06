<#
.SYNOPSIS
  Phase 2: grants tenant-wide admin consent for the SSO app's declared delegated permissions:
    - Microsoft Graph: openid profile offline_access
    - the SSO app's own API: agent_access
  Equivalent to "Grant admin consent" on the API permissions blade.
#>
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$state = Get-Content (Join-Path $PSScriptRoot '..\infra\.deploy-state.json') | ConvertFrom-Json
$token = az account get-access-token --subscription $state.subscriptionId --resource-type ms-graph --query accessToken -o tsv
function Graph($method, $path, $body) {
  $req = @{ Method = $method; Uri = "https://graph.microsoft.com/v1.0$path"; Headers = @{ Authorization = "Bearer $token" } }
  if ($body) { $req.Body = $body | ConvertTo-Json; $req.ContentType = 'application/json' }
  Invoke-RestMethod @req
}

$graphSp = (Graph GET "/servicePrincipals?`$filter=appId eq '00000003-0000-0000-c000-000000000000'").value[0]
$grants = @(
  @{ resourceId = $graphSp.id; scope = 'openid profile offline_access' },
  @{ resourceId = $state.ssoServicePrincipalId; scope = $state.scopeName }
)

foreach ($g in $grants) {
  $existing = (Graph GET "/oauth2PermissionGrants?`$filter=clientId eq '$($state.ssoServicePrincipalId)' and resourceId eq '$($g.resourceId)' and consentType eq 'AllPrincipals'").value
  if ($existing) {
    Graph PATCH "/oauth2PermissionGrants/$($existing[0].id)" @{ scope = $g.scope } | Out-Null
  } else {
    Graph POST '/oauth2PermissionGrants' @{
      clientId = $state.ssoServicePrincipalId; consentType = 'AllPrincipals'; resourceId = $g.resourceId; scope = $g.scope
    } | Out-Null
  }
  Write-Host "Admin consent granted: $($g.scope)"
}
