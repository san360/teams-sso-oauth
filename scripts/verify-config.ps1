<#
.SYNOPSIS
  Reads the live configuration (Entra SSO app, Azure Bot, OAuth connection, App Service settings, manifest)
  and checks the SSO alignment rules from the Microsoft documentation. Also reports the consent state.
#>
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$root  = Split-Path $PSScriptRoot -Parent
$state = Get-Content (Join-Path $root 'infra\.deploy-state.json') | ConvertFrom-Json
$sub   = $state.subscriptionId

$graphToken = az account get-access-token --subscription $sub --resource-type ms-graph --query accessToken -o tsv
$armToken   = az account get-access-token --subscription $sub --query accessToken -o tsv
function Graph($path) { Invoke-RestMethod -Headers @{ Authorization = "Bearer $graphToken" } "https://graph.microsoft.com/v1.0$path" }
function Arm($path)   { Invoke-RestMethod -Headers @{ Authorization = "Bearer $armToken" } "https://management.azure.com$path" }

$results = [System.Collections.Generic.List[object]]::new()
function Check($area, $rule, $ok, $actual) {
  $results.Add([pscustomobject]@{ Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Area = $area; Rule = $rule; Actual = "$actual" })
}

$botPath = "/subscriptions/$sub/resourceGroups/$($state.resourceGroup)/providers/Microsoft.BotService/botServices/$($state.botName)"
$bot  = Arm "$botPath`?api-version=2022-09-15"
$conn = Arm "$botPath/connections/$($state.connectionName)?api-version=2022-09-15"
$p = @{}; $conn.properties.parameters | ForEach-Object { $p[$_.key] = $_.value }

$app  = Graph "/applications/$($state.ssoAppObjectId)"
$fics = (Graph "/applications/$($state.ssoAppObjectId)/federatedIdentityCredentials").value
$botId = $bot.properties.msaAppId
$expectedUri = "api://botid-$botId"

$settingsJson = az webapp config appsettings list -g $state.resourceGroup -n $state.appServiceName --subscription $sub -o json
$settings = @{}; ($settingsJson | ConvertFrom-Json) | ForEach-Object { $settings[$_.name] = $_.value }

$manifestPath = Join-Path $root 'appPackage\build\manifest.json'
if (-not (Test-Path $manifestPath)) { throw 'Build the Teams package before verifying configuration.' }
$manifest = Get-Content $manifestPath | ConvertFrom-Json

# Azure Bot
Check 'Azure Bot' 'Bot type is UserAssignedMSI' ($bot.properties.msaAppType -eq 'UserAssignedMSI') $bot.properties.msaAppType
Check 'Azure Bot' 'Bot ID matches managed identity client ID' ($botId -eq $state.botId) $botId
Check 'Azure Bot' 'Bot tenant matches deployment' ($bot.properties.msaAppTenantId -eq $state.tenantId) $bot.properties.msaAppTenantId
Check 'Azure Bot' 'Bot MSI resource matches deployment' ($bot.properties.msaAppMSIResourceId -eq $state.managedIdentityId) $bot.properties.msaAppMSIResourceId
Check 'Azure Bot' 'Messaging endpoint points to the App Service' ($bot.properties.endpoint -eq $state.endpoint) $bot.properties.endpoint

# Entra SSO app
Check 'Entra app' "identifierUris contains $expectedUri (bot ID, not SSO app ID)" ($app.identifierUris -contains $expectedUri) ($app.identifierUris -join ', ')
Check 'Entra app' 'requestedAccessTokenVersion = 2' ($app.api.requestedAccessTokenVersion -eq 2) $app.api.requestedAccessTokenVersion
Check 'Entra app' 'Single tenant (FIC connection supports single tenant only)' ($app.signInAudience -eq 'AzureADMyOrg') $app.signInAudience
$scope = $app.api.oauth2PermissionScopes | Where-Object { $_.id -eq $state.scopeId }
Check 'Entra app' 'Configured scope exists and is enabled' ($scope -and $scope.isEnabled -and $scope.value -eq $state.scopeName) "$($scope.value) type=$($scope.type)"
foreach ($client in '1fec8e78-bce4-4aaf-ab1b-5451cc387264', '5e3ce6c0-2b1f-4285-8d4b-75ee78787346', '4765445b-32c6-49b0-83e6-1d93765276ca', '0ec893e0-5785-4de6-99da-4ed124e5296c', 'd3590ed6-52b3-4102-aeff-aad2292ab01c', 'bc59ab01-8403-45c6-8796-ac3ef710b3e3', '27922004-5251-4030-b22d-91ecd9a37ea4', '3068386c-7a16-4f6a-a664-043b6b232816') {
  $pre = $app.api.preAuthorizedApplications | Where-Object appId -eq $client
  Check 'Entra app' "Client $client pre-authorized for the scope" ($pre -and $pre.delegatedPermissionIds -contains $state.scopeId) ($pre.delegatedPermissionIds -join ',')
}
Check 'Entra app' 'Redirect URI https://token.botframework.com/.auth/web/redirect' ($app.web.redirectUris -contains 'https://token.botframework.com/.auth/web/redirect') ($app.web.redirectUris -join ', ')
$encodedTenant = [Convert]::ToBase64String(([guid]$state.tenantId).ToByteArray()).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$expectedSubject = "/eid1/c/pub/t/$encodedTenant/a/9ExAW52n_ky4ZiS_jhpJIQ/$($p.UniqueIdentifier)"
$fic = $fics | Where-Object {
  $_.subject -ceq $expectedSubject -and
  $_.issuer -ceq "https://login.microsoftonline.com/$($state.tenantId)/v2.0" -and
  $_.audiences -contains 'api://AzureADTokenExchange'
}
Check 'Entra app' 'Federated credential issuer, subject and audience match Token Store trust' ([bool]$fic) ([bool]$fic)

# OAuth connection
Check 'OAuth connection' 'Provider is AAD v2 with Federated Credentials' ($conn.properties.serviceProviderDisplayName -eq 'AAD v2 with Federated Credentials') $conn.properties.serviceProviderDisplayName
Check 'OAuth connection' 'Client ID = SSO app' ($p.ClientId -eq $app.appId) $p.ClientId
Check 'OAuth connection' "Token Exchange URL = $expectedUri" ($p.TokenExchangeUrl -ceq $expectedUri) $p.TokenExchangeUrl
Check 'OAuth connection' 'Scopes include the exposed API scope' ($conn.properties.scopes -split ' ' -contains "$expectedUri/$($state.scopeName)") $conn.properties.scopes
Check 'OAuth connection' 'Tenant matches deployment' ($p.TenantId -eq $state.tenantId) $p.TenantId

# App Service
Check 'App Service' 'Service connection authType = UserManagedIdentity' ($settings['connections__serviceConnection__settings__authType'] -eq 'UserManagedIdentity') $settings['connections__serviceConnection__settings__authType']
Check 'App Service' 'Service connection clientId = bot ID' ($settings['connections__serviceConnection__settings__clientId'] -eq $botId) $settings['connections__serviceConnection__settings__clientId']
Check 'App Service' 'Service connection tenant matches deployment' ($settings['connections__serviceConnection__settings__tenantId'] -eq $state.tenantId) $settings['connections__serviceConnection__settings__tenantId']
Check 'App Service' 'Handler uses the OAuth connection' ($settings['AgentApplication__UserAuthorization__Handlers__sso__Settings__azureBotOAuthConnectionName'] -eq $state.connectionName) $settings['AgentApplication__UserAuthorization__Handlers__sso__Settings__azureBotOAuthConnectionName']

# Teams manifest
if ($manifest) {
  Check 'Manifest' 'bots[0].botId = bot ID' ($manifest.bots[0].botId -eq $botId) $manifest.bots[0].botId
  Check 'Manifest' 'customEngineAgents[0].id = bot ID' ($manifest.copilotAgents.customEngineAgents[0].id -eq $botId) $manifest.copilotAgents.customEngineAgents[0].id
  Check 'Manifest' 'webApplicationInfo.id = SSO app' ($manifest.webApplicationInfo.id -eq $app.appId) $manifest.webApplicationInfo.id
  Check 'Manifest' "webApplicationInfo.resource = $expectedUri" ($manifest.webApplicationInfo.resource -ceq $expectedUri) $manifest.webApplicationInfo.resource
  Check 'Manifest' 'Token Service domain is allowed' ($manifest.validDomains -contains 'token.botframework.com') ($manifest.validDomains -join ', ')
}

$results | Format-Table -AutoSize -Wrap

# Consent state (the variable between phase 1 and phase 2)
$grants = (Graph "/oauth2PermissionGrants?`$filter=clientId eq '$($state.ssoServicePrincipalId)'").value
Write-Host "`nConsent grants where the SSO app is the client:" -ForegroundColor Cyan
if (-not $grants) { Write-Host '  none (no admin or user consent yet)' }
foreach ($g in $grants) {
  $resource = (Graph "/servicePrincipals/$($g.resourceId)?`$select=displayName").displayName
  Write-Host "  $($g.consentType) -> $resource : $($g.scope.Trim())"
}
if ($results.Result -contains 'FAIL') { throw 'SSO configuration checks failed. Correct every FAIL before testing.' }
