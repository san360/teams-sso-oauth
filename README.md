# Teams and Microsoft 365 Copilot bot SSO

A minimal JavaScript custom engine agent using Microsoft 365 Agents SDK. It demonstrates **bot SSO** with a **user-assigned managed identity** for channel authentication and a **separate, single-tenant Entra app** with **federated credentials** for user authorization. No client secret is needed.

| Command | Behavior |
|---|---|
| `hello` (or any other text) | Echo without sign-in; confirms message delivery |
| `whoami` | Triggers the `sso` authorization handler; shows sign-in status, token version and expiry, not user identity or the token |
| `logout` | Clears the Bot Framework Token Service cache for this user; does not sign out Teams or revoke Entra consent |

This is a diagnostic sample, not a production identity service. It uses in-memory storage and echoes user input. Do not send sensitive messages. SDK authentication protects the bot endpoint; decoded token metadata is diagnostic only and must never be used for access-control decisions.

## Documentation

| Start here | What it explains |
|---|---|
| [Architecture and flow diagrams](docs/ARCHITECTURE.md) | Bot vs user identity, successful `whoami` sequence and safe failure path |
| [SSO configuration](docs/CONFIGURATION.md) | Exact ID mapping, Entra/FIC, OAuth connection, runtime settings and manifest |
| [Deployment runbook](docs/DEPLOYMENT.md) | Prerequisites, deployment flow, Teams installation, updates and cleanup |
| [Validation and troubleshooting](docs/TEST-RESULTS.md) | Repeatable checks, error interpretation and log references |
| [Publication hygiene](docs/PUBLICATION.md) | Scan scope, clean history and private generated settings/logs |

**Two independent concerns:** the managed identity authenticates the **bot's service calls**; the separate Entra SSO app and named OAuth connection obtain the **user's token**. A working echo proves channel delivery, not user SSO.

When sign-in token retrieval fails on `whoami`, the bot reports a safe diagnostic code/status and a generated reference instead of the SDK's generic agent-error reply. Administrators can match that reference to the application's `signInFailure` log marker. Raw provider error text is deliberately not displayed.

## Quick start

Use Node.js 22 LTS, PowerShell 7.3 or later and Azure CLI. Sign in to your own tenant, then run from the repository root:

```powershell
npm ci
npm test
az login --tenant '<tenant-id>'
az account set --subscription '<subscription-id>'
.\infra\deploy.ps1 -SubscriptionId '<subscription-id>' -TenantId '<tenant-id>' -Name '<unique-sample-name>'
.\scripts\build-package.ps1
.\scripts\verify-config.ps1
```

Replace placeholders before running commands. Deployment creates billable Azure resources and modifies Entra configuration; read the [prerequisites and permissions](docs/DEPLOYMENT.md) first. Use a dedicated test resource group, name and app registration. The script reuses resources by name and configures the SSO app's permissions, scopes and pre-authorizations; do not point it at a shared application.

Upload the locally generated `appPackage\build\sso-test-agent.zip` through Teams **Apps > Manage your apps > Upload an app > Upload a custom app**, or have a Teams administrator upload it. Tenant policies must allow the app. Open its personal chat and send `hello`, `whoami`, `logout`, then `whoami` again. Copilot availability also depends on tenant policy, app support and user entitlement.

## Local checks

```powershell
npm ci
npm test
Copy-Item .env.example .env
npm run dev
```

Replace the IDs in your ignored `.env`. User-assigned managed identity authentication is available on the configured Azure host, not on an ordinary developer laptop. Local startup is not proof of channel authentication or Teams SSO.

## Repository layout

```text
src/                         agent and non-identifying token diagnostics
test/                        offline diagnostic tests
infra/deploy.ps1             Azure/Entra provisioning and code deployment
appPackage/                  placeholder manifest template and sample icons
scripts/build-package.ps1    ignored Teams package and stable local app ID
scripts/verify-config.ps1    read-only live alignment checks; fails on mismatch
scripts/get-logs.ps1         local App Service log inspection
scripts/get-signins.ps1      local Entra sign-in diagnostics
scripts/grant-admin-consent.ps1  optional tenant-wide consent
scripts/reset-consent.ps1    confirmed removal of sample consent grants
scripts/check-publication.js staged/history publication hygiene checks
```

Never commit `.env`, deployment state, generated manifests/packages, app IDs, logs or diagnostic exports. Avoid verbose SDK logging on shared hosts. Public Microsoft platform IDs in the source are documented constants, not deployment identifiers.
