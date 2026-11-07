# End-to-end SSO configuration

[Overview](../README.md) | [Architecture](ARCHITECTURE.md) | [Deploy](DEPLOYMENT.md) | [Troubleshoot](TEST-RESULTS.md)

This sample targets Azure public cloud with the global Bot Framework Token Service. Sovereign clouds and regional token endpoints require coordinated changes to URLs, audiences and manifest domains. All deployment-specific values below are placeholders.

## 1. Distinguish the three identities

| Symbol | Meaning | Where it is used |
|---|---|---|
| `<bot-id>` | User-assigned managed identity **client ID**, not its object ID | Azure Bot Microsoft App ID, runtime client ID, `bots[].botId`, `customEngineAgents[].id`, URI suffix |
| `<sso-app-id>` | Separate Entra app registration **application/client ID** | OAuth connection Client ID and manifest `webApplicationInfo.id` |
| `<teams-app-id>` | Independently generated Teams package ID | Manifest root `id`; keep stable for package updates |
| `<tenant-id>` | Directory containing these resources and test users | Runtime tenant, Azure Bot tenant, OAuth tenant, federated issuer |
| `<scope-id>` | Generated GUID for the exposed permission | Scope definition and every authorized client's delegated permission reference |

**Critical invariant:** the exact, case-sensitive string `api://botid-<bot-id>` must match the SSO app's **Application ID URI**, the OAuth connection's **Token Exchange URL**, and manifest **webApplicationInfo.resource**. The suffix is the bot/managed-identity client ID, **not** the separate SSO app ID.

The managed identity authenticates Bot Service channel traffic. The SSO app and its OAuth connection authorize the user. Configuring one does not configure the other.

## 2. Configure the Entra SSO app

In Entra **App registrations**, create a dedicated registration:

1. Select **Accounts in this organizational directory only** (`AzureADMyOrg`). This FIC OAuth provider currently supports single-tenant apps.
2. Under **Authentication**, add a **Web** platform redirect URI: `https://token.botframework.com/.auth/web/redirect`.
3. Set `api.requestedAccessTokenVersion` to `2` in the app manifest. Set this before configuring the `botid-` URI containing a different client ID. Directory identifier-URI policy can still require administrator review; do not disable tenant security policy to bypass an error.
4. Under **Expose an API**, set Application ID URI to `api://botid-<bot-id>`.
5. Add an enabled scope `agent_access` with a stable generated scope ID. This sample uses consent type **Admins and users** (`User`) and descriptive display names. User consent remains subject to tenant policy.
6. Under **Authorized client applications**, add each client you need and select the `agent_access` scope. The deployment script configures these public first-party clients:

| Public client ID | Application |
|---|---|
| `1fec8e78-bce4-4aaf-ab1b-5451cc387264` | Teams desktop/mobile |
| `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` | Teams web |
| `4765445b-32c6-49b0-83e6-1d93765276ca` | Microsoft 365 web |
| `0ec893e0-5785-4de6-99da-4ed124e5296c` | Microsoft 365 desktop |
| `d3590ed6-52b3-4102-aeff-aad2292ab01c` | Microsoft 365 mobile / Outlook desktop |
| `bc59ab01-8403-45c6-8796-ac3ef710b3e3` | Outlook web |
| `27922004-5251-4030-b22d-91ecd9a37ea4` | Outlook mobile |
| `3068386c-7a16-4f6a-a664-043b6b232816` | Word, Excel and PowerPoint |

Only pre-authorize trusted clients relevant to your deployment. Pre-authorization is permission for those clients to request your scope; it is not blanket consent for your app to call other APIs.

Under **API permissions**, the sample declares Microsoft Graph delegated `openid`, `profile`, `offline_access` and its own `agent_access` scope. It does not call Graph or request `User.Read`. Declaring permissions alone does not grant tenant-wide consent. Admin consent is an optional, explicitly privileged operation described in the deployment runbook; do not assume every tenant can sign in silently without it.

### Federated credential (no secret)

Under **Certificates & secrets > Federated credentials > Add credential**, choose **Other issuer**:

| Field | Value |
|---|---|
| Issuer | `https://login.microsoftonline.com/<tenant-id>/v2.0` |
| Subject | `/eid1/c/pub/t/<base64url-tenant-guid-bytes>/a/9ExAW52n_ky4ZiS_jhpJIQ/<unique-identifier>` |
| Audience | `api://AzureADTokenExchange` |
| Name | `bot-token-store` |

Generate and preserve `<unique-identifier>` (for example a new GUID). The same value must appear in the OAuth connection. `9ExAW52n_ky4ZiS_jhpJIQ` is Microsoft's documented Bot Service Token Store identifier, not a secret.

Encode the tenant GUID's **byte array**, not its text:

```powershell
$tenant = [guid]'<tenant-id>'
$encoded = [Convert]::ToBase64String($tenant.ToByteArray()).TrimEnd('=').Replace('+', '-').Replace('/', '_')
```

The deployment script creates the credential and the SSO application's service principal. It does not create client secrets.

## 3. Configure Azure Bot and its OAuth connection

Create a **User-Assigned Managed Identity** Azure Bot. Assign that same identity to the App Service.

| Azure Bot setting | Value |
|---|---|
| Microsoft App ID (`msaAppId`) | `<bot-id>` |
| App type (`msaAppType`) | `UserAssignedMSI` |
| Tenant (`msaAppTenantId`) | `<tenant-id>` |
| MSI resource (`msaAppMSIResourceId`) | Full resource ID of the user-assigned managed identity |
| Messaging endpoint | `https://<app-service-name>.azurewebsites.net/api/messages` |
| Channel | Microsoft Teams enabled |

In **Configuration > OAuth Connection Settings**, add:

| OAuth setting | Value |
|---|---|
| Name | `SsoConnection` (or your chosen name, aligned with runtime handler settings) |
| Service provider | **AAD v2 with Federated Credentials** |
| Client ID | `<sso-app-id>` |
| Unique Identifier | `<unique-identifier>` from the federated subject |
| Token Exchange URL | `api://botid-<bot-id>` |
| Tenant ID | `<tenant-id>` (not `common`) |
| Scopes | `openid profile offline_access api://botid-<bot-id>/agent_access` |

The REST provider ID used by the script is `c00b44ab-5e16-c44c-af26-2fd5bc55eb18`, a platform provider identifier. Select the named provider in the portal when checking configuration.

The connection requests a token for the sample's own API. Do not mix Graph resource scopes such as `User.Read` into that request. Use the Agents SDK OBO configuration or a separate OAuth connection for downstream APIs, and grant the necessary delegated permissions/consent. Never paste tokens into third-party decoders; inspect only approved, local diagnostics if necessary.

The portal's **Test Connection** checks the OAuth provider and may prompt for consent. It does **not** prove Teams silent token exchange.

## 4. Configure the running agent

| App Service setting | Value |
|---|---|
| Assigned identity | The same user-assigned managed identity as Azure Bot |
| `connections__serviceConnection__settings__authType` | `UserManagedIdentity` |
| `connections__serviceConnection__settings__clientId` | `<bot-id>` |
| `connections__serviceConnection__settings__tenantId` | `<tenant-id>` |
| `connectionsMap__0__connection` | `serviceConnection` |
| `connectionsMap__0__serviceUrl` | `*` |
| `AgentApplication__UserAuthorization__Handlers__sso__Settings__azureBotOAuthConnectionName` | `SsoConnection` |
| `AgentApplication__UserAuthorization__Handlers__sso__Settings__title` | `Sign in` |
| `AgentApplication__UserAuthorization__Handlers__sso__Settings__text` | `Sign in to the SSO test agent` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |
| Startup command | `npm start` |

### Why these runtime settings are needed

These long environment-variable names are **configuration conventions for this Agents SDK and sample**, not universal Teams SSO requirements. Configuring the manifest, Entra app and Azure Bot does not automatically wire the running JavaScript application to them.

- **Bot service identity:** attaching the user-assigned managed identity makes it available to App Service. The SDK's `authType`, `clientId` and `tenantId` settings select/configure that identity to authenticate outbound bot service calls, such as channel replies. They describe the **bot**, not the signed-in user's identity; use `<bot-id>` and `<tenant-id>` from the mapping above.
- **Outbound connection mapping:** `connectionsMap__0__connection` selects the named `serviceConnection`, while `connectionsMap__0__serviceUrl=*` makes it the fallback mapping for outbound channel service URLs. The wildcard is a connection-routing rule, **not an inbound authorization bypass**. Keep `/api/messages` protected by SDK authentication; `/health` is intentionally public and returns only service status.
- **User authorization wiring:** the application attaches the named `sso` SDK handler to `whoami`. Its `azureBotOAuthConnectionName` must exactly match the Azure Bot OAuth connection name (`SsoConnection` here). The SDK uses that connection to obtain the user's token through the configured Entra/Teams flow, handling OAuth cards, `signin/tokenExchange` and `signin/verifyState`. `logout` calls SDK sign-out. The handler's `title` and `text` customize the fallback sign-in card; those presentation strings are not prerequisites for silent SSO.

The **Teams manifest** identifies the SSO app/resource for the client; the **Entra app** defines the exposed scope, client pre-authorization, applicable consent and federated trust; the **Azure Bot OAuth connection** selects that app/provider, scopes and token-exchange resource. The **runtime SDK settings** connect the executing app's bot identity and `sso` handler to those services. All four surfaces must be aligned, but each has a different responsibility.

`SCM_DO_BUILD_DURING_DEPLOYMENT=true` enables the build used by this App Service deployment, and `npm start` launches the Node.js app. They are **build/start controls, not SSO-specific settings**; their necessity depends on the deployment method (for example, a prebuilt deployment can use different build controls).

Azure exposes App Service application settings as process environment variables, so this deployment does **not** require a `.env` file. `.env.example` is only a placeholder onboarding template and is not loaded at runtime. For local use, copy it to an ignored `.env`, replace the placeholders, and run `npm run dev`, which explicitly loads `.env` through Node's `--env-file=.env` option. `npm start` does not load either file. A local `.env` still does not make Azure managed identity available on a developer laptop.

Do not enable `DEBUG=agents:*` by default: verbose dependency logs may contain identities or authentication context. Application flow markers omit invoke bodies, tokens, user claims and sign-in URLs.

### Native sign-in presentation versus reply cards

The `title` and `text` settings above belong to the **SDK OAuth prompt**. Use concise, public presentation text such as `Sign in` and `Sign in to the SSO test agent`; changing these settings is a deployment configuration update, not part of rendering the reply cards. The sample does not create its own login URL or rewrite OAuth cards.

Application status replies use card-only Adaptive Cards 1.2 with complete card `fallbackText`, not duplicate activity text. The demo success reply intentionally shows the complete JWT and all decoded payload claims as escaped text, plus readable UTC dates. This is local diagnostic decoding, **not JWT signature validation**. No live credentials, claim captures or screenshots belong in this repository. See the [card UX guide](../README.md#card-based-conversation) and [validation matrix](TEST-RESULTS.md).

`WHOAMI_TOKEN_DISPLAY` is an **application display convention**, not a Teams SSO prerequisite. `raw` is the demo default when unset and exposes bearer access and potentially personal claims in retained chat. Set `masked` in local `.env` or Azure App Service environment settings for a constant redacted schematic and selected non-identifying metadata; restart the app to apply it. Other values fail startup with a static configuration error. For production, mask or remove the diagnostic route entirely. Neither mode changes Entra/OAuth settings or removes old messages. Native OAuth and invoke payloads remain SDK-managed; avoid verbose dependency logs that may contain authentication data.

## 5. Configure the Teams / Microsoft 365 manifest

The placeholder template uses manifest schema `1.24` and personal/Copilot bot scopes:

```json
{
  "id": "<teams-app-id>",
  "bots": [{ "botId": "<bot-id>", "scopes": ["copilot", "personal"] }],
  "copilotAgents": {
    "customEngineAgents": [{ "type": "bot", "id": "<bot-id>" }]
  },
  "validDomains": ["token.botframework.com"],
  "webApplicationInfo": {
    "id": "<sso-app-id>",
    "resource": "api://botid-<bot-id>"
  }
}
```

This is an explanatory excerpt, not a complete installable manifest. Use `scripts\build-package.ps1` to fill the full template. Keep the token host in `validDomains` as a domain, not an `https://` URL. `customEngineAgents[].id` must equal the corresponding bot ID. The root Teams ID is independent of both Entra identities. Replace sample developer/website/privacy/terms metadata with real, public information for distribution. Package `manifest.json`, `color.png` (192 x 192) and `outline.png` (32 x 32, transparent) at the zip root.

When updating an installed app, preserve the generated local Teams app ID and increase the manifest version. Upload the new package and allow policy/installation propagation. A source change alone does not update an installed manifest.

## 6. Expected runtime flow

See the [successful SSO sequence and failure-path diagrams](ARCHITECTURE.md#2-successful-whoami-with-no-cached-user-token) for the identity and service boundaries.

1. `whoami` requires authorization. If no cached user token exists, the SDK emits an OAuth card with a token-exchange resource.
2. Teams/Copilot obtains a token for the exposed API as a pre-authorized client. Errors here can appear in Entra sign-in logs without reaching the bot.
3. The client sends `signin/tokenExchange`; the SDK exchanges it with the Token Service using the configured connection and FIC trust.
4. On success, the handler receives a token. The sample reports only signed-in status, version and expiry.
5. `logout` clears the Token Service cache. The next `whoami` tests a new exchange, but Teams' own Entra session can remain cached.

Consent, Conditional Access, tenant policy and client support can require interaction. Silent SSO is an outcome to verify, not a guarantee.

## Public Microsoft references

Reviewed against public Microsoft Learn documentation for this sample:

- [User-assigned managed identity SSO ID mapping](https://learn.microsoft.com/microsoftteams/platform/teams-sdk/teams/user-authentication/sso-setup#sso-with-user-assigned-managed-identity)
- [Federated credentials, subject encoding, client IDs and OAuth connection](https://learn.microsoft.com/microsoft-365/agents-sdk/azure-bot-user-authorization-federated-credentials)
- [Bot SSO Entra configuration and Office client pre-authorization](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/authentication/bot-sso-register-aad)
- [Agent Store client compatibility and Office pre-authorization](https://learn.microsoft.com/microsoftteams/platform/concepts/deploy-and-publish/appsource/prepare/review-copilot-validation-guidelines)
- [Teams SSO manifest and custom upload](https://learn.microsoft.com/microsoftteams/platform/bots/how-to/authentication/bot-sso-manifest)
- [Identifier URI restrictions](https://learn.microsoft.com/entra/identity-platform/identifier-uri-restrictions)
- [Agents SDK OAuth and OBO](https://learn.microsoft.com/microsoft-365/agents-sdk/agent-oauth-configuration)
- [Agent authentication settings](https://learn.microsoft.com/microsoft-365/agents-sdk/microsoft-authentication-library-configuration-options)
- [Custom engine agent manifest schema](https://learn.microsoft.com/microsoft-365/extensibility/schema/root-copilot-agents-custom-engine-agents)
