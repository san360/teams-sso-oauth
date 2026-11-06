<#
.SYNOPSIS
  Deploys the Teams / Microsoft 365 Copilot SSO test agent.

  Sample topology:
    - Bot identity  : user-assigned managed identity (MI). Azure Bot type = UserAssignedMSI.
    - SSO auth app  : separate Entra app registration, single tenant, no secret.
                      Application ID URI = api://botid-{MI client id}, scope agent_access.
                      Federated credential trusts the Bot Framework Token Store.
    - OAuth connection on the Azure Bot: "AAD v2 with Federated Credentials" using the SSO app.
    - App Service (Linux, Node 22) runs the agent as the MI.

  Re-runnable: existing resources are reused. Admin consent is NOT granted here
  (see scripts/grant-admin-consent.ps1 for phase 2).
#>
param(
  [Parameter(Mandatory)][guid]$SubscriptionId,
  [Parameter(Mandatory)][guid]$TenantId,
  [string]$Location       = 'swedencentral',
  [string]$ResourceGroup  = 'rg-teams-sso-oauth',
  [string]$Name           = 'teams-sso-oauth',
  [string]$ConnectionName = 'SsoConnection',
  [string]$ScopeName      = 'agent_access'
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true  # fail fast when an az command fails
$root = Split-Path $PSScriptRoot -Parent
$account = az account show --subscription $SubscriptionId -o json | ConvertFrom-Json
if ($account.tenantId -ne $TenantId) { throw 'The subscription does not belong to the requested tenant.' }
if ($Name -notmatch '^[a-z][a-z0-9-]{2,30}$') { throw 'Name must contain 3-31 lowercase letters, digits or hyphens, starting with a letter.' }
if ($ScopeName -notmatch '^[a-zA-Z][a-zA-Z0-9_]*$') { throw 'ScopeName must be an identifier starting with a letter.' }

# Bot Framework Token Store first-party app, base64url encoded (from the Agents SDK FIC documentation).
$TokenStoreAppEncoded = '9ExAW52n_ky4ZiS_jhpJIQ'

# First-party clients allowed to request the SSO token silently (Teams, Microsoft 365, Outlook, Office).
$PreAuthorizedClients = @(
  '1fec8e78-bce4-4aaf-ab1b-5451cc387264', # Teams desktop / mobile
  '5e3ce6c0-2b1f-4285-8d4b-75ee78787346', # Teams web
  '4765445b-32c6-49b0-83e6-1d93765276ca', # Microsoft 365 web
  '0ec893e0-5785-4de6-99da-4ed124e5296c', # Microsoft 365 desktop
  'd3590ed6-52b3-4102-aeff-aad2292ab01c', # Microsoft 365 mobile / Outlook desktop
  'bc59ab01-8403-45c6-8796-ac3ef710b3e3', # Outlook web
  '27922004-5251-4030-b22d-91ecd9a37ea4', # Outlook mobile
  '3068386c-7a16-4f6a-a664-043b6b232816'  # Word, Excel, PowerPoint
)

function Step($text) { Write-Host "`n=== $text" -ForegroundColor Cyan }

function Invoke-Graph($Method, $Path, $Body) {
  $token = az account get-access-token --subscription $SubscriptionId --resource-type ms-graph --query accessToken -o tsv
  $req = @{ Method = $Method; Uri = "https://graph.microsoft.com/v1.0$Path"; Headers = @{ Authorization = "Bearer $token" } }
  if ($Body) { $req.Body = ($Body | ConvertTo-Json -Depth 10); $req.ContentType = 'application/json' }
  Invoke-RestMethod @req
}

function Invoke-Arm($Method, $Path, $Body) {
  $token = az account get-access-token --subscription $SubscriptionId --query accessToken -o tsv
  $req = @{ Method = $Method; Uri = "https://management.azure.com$Path"; Headers = @{ Authorization = "Bearer $token" } }
  if ($Body) { $req.Body = ($Body | ConvertTo-Json -Depth 10); $req.ContentType = 'application/json' }
  Invoke-RestMethod @req
}

function ConvertTo-Base64UrlGuid([guid]$Guid) {
  [Convert]::ToBase64String($Guid.ToByteArray()).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

$suffix   = $SubscriptionId.ToString().Substring(0, 6)
$miName   = "id-$Name"
$planName = "asp-$Name"
$appName  = "app-$Name-$suffix"
$botName  = "bot-$Name-$suffix"

# ---------------------------------------------------------------------------
Step "Resource group $ResourceGroup"
az group create -n $ResourceGroup -l $Location --subscription $SubscriptionId -o none

Step "User-assigned managed identity $miName (bot identity)"
$mi = az identity create -g $ResourceGroup -n $miName -l $Location --subscription $SubscriptionId -o json | ConvertFrom-Json
$botId = $mi.clientId
Write-Host "Bot ID (MI client ID): $botId"

Step "App Service $appName (Linux, Node 22)"
az appservice plan create -g $ResourceGroup -n $planName --is-linux --sku B1 -l $Location --subscription $SubscriptionId -o none
$exists = az webapp list -g $ResourceGroup --subscription $SubscriptionId --query "[?name=='$appName'].name" -o tsv
if (-not $exists) {
  az webapp create -g $ResourceGroup -p $planName -n $appName --runtime 'NODE:22-lts' --assign-identity $mi.id --subscription $SubscriptionId -o none
} else {
  az webapp identity assign -g $ResourceGroup -n $appName --identities $mi.id --subscription $SubscriptionId -o none
}
az webapp update -g $ResourceGroup -n $appName --https-only true --subscription $SubscriptionId -o none
$endpoint = "https://$appName.azurewebsites.net/api/messages"

# ---------------------------------------------------------------------------
Step "SSO auth app registration (separate from the bot identity)"
$ssoDisplayName = "$Name-sso"
$apps = @((Invoke-Graph GET "/applications?`$filter=displayName eq '$ssoDisplayName'").value)
if ($apps.Count -gt 1) { throw 'Multiple SSO apps have this display name. Choose a unique Name.' }
$app = $apps | Select-Object -First 1
if (-not $app) {
  $app = Invoke-Graph POST '/applications' @{
    displayName    = $ssoDisplayName
    signInAudience = 'AzureADMyOrg'
    api            = @{ requestedAccessTokenVersion = 2 }
    web            = @{ redirectUris = @('https://token.botframework.com/.auth/web/redirect') }
  }
  Start-Sleep 10
}
$ssoAppId = $app.appId
Write-Host "SSO app ID: $ssoAppId"

# Keep the scope id stable across re-runs.
$scopeId = ($app.api.oauth2PermissionScopes | Where-Object value -eq $ScopeName).id
if (-not $scopeId) { $scopeId = [guid]::NewGuid().ToString() }

$scope = @{
  id                      = $scopeId
  value                   = $ScopeName
  type                    = 'User'
  isEnabled               = $true
  adminConsentDisplayName = 'Access the SSO test agent as the signed-in user'
  adminConsentDescription = 'Allows Teams and Microsoft 365 Copilot to call the SSO test agent on behalf of the signed-in user.'
  userConsentDisplayName  = 'Access the SSO test agent as you'
  userConsentDescription  = 'Allows Teams and Microsoft 365 Copilot to call the SSO test agent on your behalf.'
}

# 1) v2 tokens + scope. v2 is required before Entra accepts api://botid-{other GUID}.
Invoke-Graph PATCH "/applications/$($app.id)" @{ api = @{ requestedAccessTokenVersion = 2; oauth2PermissionScopes = @($scope) } } | Out-Null

# 2) Application ID URI built from the BOT ID (MI client ID), not the SSO app ID.
$resourceUri = "api://botid-$botId"
Invoke-Graph PATCH "/applications/$($app.id)" @{ identifierUris = @($resourceUri) } | Out-Null

# 3) Pre-authorize Teams / Microsoft 365 clients and declare required permissions (consent is NOT granted here).
Start-Sleep 5
Invoke-Graph PATCH "/applications/$($app.id)" @{
  api = @{ preAuthorizedApplications = @($PreAuthorizedClients | ForEach-Object { @{ appId = $_; delegatedPermissionIds = @($scopeId) } }) }
  requiredResourceAccess = @(
    @{ resourceAppId = '00000003-0000-0000-c000-000000000000'; resourceAccess = @(
        @{ id = '37f7f235-527c-4136-accd-4a02d197296e'; type = 'Scope' }, # openid
        @{ id = '14dad69e-099b-42c9-810b-d002981feec1'; type = 'Scope' }, # profile
        @{ id = '7427e0e9-2fba-42fe-b0c0-848c9e6a8182'; type = 'Scope' }  # offline_access
    ) },
    @{ resourceAppId = $ssoAppId; resourceAccess = @(@{ id = $scopeId; type = 'Scope' }) }  # own agent_access
  )
} | Out-Null

# Service principal so the app exists in the tenant.
$sp = (Invoke-Graph GET "/servicePrincipals?`$filter=appId eq '$ssoAppId'").value | Select-Object -First 1
if (-not $sp) { $sp = Invoke-Graph POST '/servicePrincipals' @{ appId = $ssoAppId } }

# 4) Federated credential: lets the Bot Framework Token Store act as the SSO app (no client secret).
$uniqueId = [guid]::NewGuid().ToString()
$existingFic = (Invoke-Graph GET "/applications/$($app.id)/federatedIdentityCredentials").value | Where-Object name -eq 'bot-token-store'
if ($existingFic) {
  $uniqueId = $existingFic.subject.Split('/')[-1]
} else {
  $subject = "/eid1/c/pub/t/$(ConvertTo-Base64UrlGuid $TenantId)/a/$TokenStoreAppEncoded/$uniqueId"
  Invoke-Graph POST "/applications/$($app.id)/federatedIdentityCredentials" @{
    name      = 'bot-token-store'
    issuer    = "https://login.microsoftonline.com/$TenantId/v2.0"
    subject   = $subject
    audiences = @('api://AzureADTokenExchange')
  } | Out-Null
}
Write-Host "FIC unique identifier: $uniqueId"

# ---------------------------------------------------------------------------
Step "Azure Bot $botName (UserAssignedMSI) + Teams channel"
$botPath = "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup/providers/Microsoft.BotService/botServices/$botName"
Invoke-Arm PUT "$botPath`?api-version=2022-09-15" @{
  location = 'global'
  kind     = 'azurebot'
  sku      = @{ name = 'F0' }
  properties = @{
    displayName          = $Name
    endpoint             = $endpoint
    msaAppId             = $botId
    msaAppType           = 'UserAssignedMSI'
    msaAppTenantId       = $TenantId
    msaAppMSIResourceId  = $mi.id
  }
} | Out-Null
Invoke-Arm PUT "$botPath/channels/MsTeamsChannel?api-version=2022-09-15" @{
  location = 'global'
  properties = @{ channelName = 'MsTeamsChannel'; properties = @{ isEnabled = $true } }
} | Out-Null

Step "OAuth connection $ConnectionName (AAD v2 with Federated Credentials)"
$scopes = "openid profile offline_access $resourceUri/$ScopeName"
Invoke-Arm PUT "$botPath/connections/$ConnectionName`?api-version=2022-09-15" @{
  location = 'global'
  properties = @{
    serviceProviderId          = 'c00b44ab-5e16-c44c-af26-2fd5bc55eb18'
    serviceProviderDisplayName = 'AAD v2 with Federated Credentials'
    clientId                   = $ssoAppId
    scopes                     = $scopes
    parameters = @(
      @{ key = 'ClientId';                   value = $ssoAppId },
      @{ key = 'UniqueIdentifier';           value = $uniqueId },
      @{ key = 'TokenExchangeUrl';           value = $resourceUri },
      @{ key = 'TenantId';                   value = $TenantId },
      @{ key = 'LoginUri';                   value = 'https://login.microsoftonline.com' },
      @{ key = 'IsMultiTenantFlowSupported'; value = 'false' }
    )
  }
} | Out-Null

# ---------------------------------------------------------------------------
Step "App settings + logging"
az webapp config appsettings set -g $ResourceGroup -n $appName --subscription $SubscriptionId -o none --settings `
  "connections__serviceConnection__settings__authType=UserManagedIdentity" `
  "connections__serviceConnection__settings__clientId=$botId" `
  "connections__serviceConnection__settings__tenantId=$TenantId" `
  "connectionsMap__0__connection=serviceConnection" `
  "connectionsMap__0__serviceUrl=*" `
  "AgentApplication__UserAuthorization__Handlers__sso__Settings__azureBotOAuthConnectionName=$ConnectionName" `
  "AgentApplication__UserAuthorization__Handlers__sso__Settings__title=Sign in" `
  "AgentApplication__UserAuthorization__Handlers__sso__Settings__text=Sign in to the SSO test agent" `
  "SCM_DO_BUILD_DURING_DEPLOYMENT=true"
az webapp config set -g $ResourceGroup -n $appName --subscription $SubscriptionId --startup-file 'npm start' --min-tls-version 1.2 -o none
az webapp log config -g $ResourceGroup -n $appName --application-logging filesystem --docker-container-logging filesystem --level information --subscription $SubscriptionId -o none

Step "Deploy code (Kudu publish API with an Entra token; no publishing credentials needed)"
$zip = Join-Path $env:TEMP "$Name.zip"
Remove-Item $zip -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $root 'src'), (Join-Path $root 'package.json'), (Join-Path $root 'package-lock.json') -DestinationPath $zip
$armToken = az account get-access-token --subscription $SubscriptionId --query accessToken -o tsv
Invoke-RestMethod -Method Post -Uri "https://$appName.scm.azurewebsites.net/api/publish?type=zip" `
  -Headers @{ Authorization = "Bearer $armToken" } -InFile $zip -ContentType 'application/zip' | Out-Null
Remove-Item $zip

# ---------------------------------------------------------------------------
$state = [ordered]@{
  subscriptionId = $SubscriptionId; tenantId = $TenantId; resourceGroup = $ResourceGroup
  appServiceName = $appName; endpoint = $endpoint
  botName = $botName; botId = $botId; managedIdentityId = $mi.id
  ssoAppId = $ssoAppId; ssoAppObjectId = $app.id; ssoServicePrincipalId = $sp.id; scopeId = $scopeId
  resourceUri = $resourceUri; scopeName = $ScopeName; connectionName = $ConnectionName; connectionScopes = $scopes; ficUniqueIdentifier = $uniqueId
}
$state | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot '.deploy-state.json')
Step 'Done'
$state | Format-List
