# Teams and Microsoft 365 Copilot bot SSO

A minimal JavaScript custom engine agent using Microsoft 365 Agents SDK. It demonstrates **bot SSO** with a **user-assigned managed identity** for channel authentication and a **separate, single-tenant Entra app** with **federated credentials** for user authorization. No client secret is needed.

| Command | Behavior |
|---|---|
| `hello` (or any other text) | Echo without sign-in; confirms message delivery |
| `whoami` | Triggers `sso`; demo default shows the complete bearer JWT, decoded payload and readable UTC dates in one card |
| `logout` | Clears the Bot Framework Token Service cache for this user; does not sign out Teams or revoke Entra consent |
| `help` | Shows the command guide without sign-in |

**Demo-only disclosure:** `whoami` intentionally reveals the user's bearer credential and potentially personal claims in retained chat. The credential can grant access; do not forward or screenshot the reply. Sanitized GitHub source does not sanitize runtime conversations. Use only dedicated demo accounts and an approved isolated chat. This is not a production identity service; it uses in-memory storage and echoes user input. SDK authentication protects the bot endpoint; local JWT decoding is **not signature validation** and must never be used for access-control decisions.

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

## Card-based conversation

Replies use compact Adaptive Cards with status headings, readable diagnostic facts and a clear next step. Success, sign-in failure, sign-in-required status, logout, help and echo each send one card-only activity, with complete `fallbackText` inside the card. Activity `text` is omitted so card-capable clients do not display a duplicate prose reply. Status is expressed in words, not color alone.

By default, successful `whoami` shows **Raw JWT (complete)** in wrapped monospace text, **Decoded payload (all claims)** as formatted JSON, a standard-claim guide, and readable `exp`/`iat`/`nbf` UTC dates when present. Decoding happens locally; no external decoder, upload or custom action is used. Claim values are escaped text, not executable card properties or links. The card's complete fallback also contains the credential and claims, so the same disclosure warning applies to fallback hosts.

For metadata-only replies, set the application setting **`WHOAMI_TOKEN_DISPLAY=masked`** before starting/restarting the app. That mode retains a fixed fully redacted schematic plus allowlisted version and expiry, with no real token fragments or identity claims. Only `raw` and `masked` are accepted; an omitted setting means `raw`. Production deployments should use masked mode or remove the diagnostic `whoami` route entirely, not merely hide its help entry. Changing modes cannot remove previously retained messages or revoke issued tokens.

The complete serialized token activity, including fallback and Markdown escaping, is capped at **24 KiB UTF-8 / 48 KiB UTF-16**. An oversized result produces one explicit limit card with no token/claims, never a silently truncated credential. Malformed compact JWTs, invalid supplied date claims and excessive nesting produce a safe format-status card. App flow markers and surfaced errors do not contain the token or claims; avoid verbose dependency/transport logging.

**Sign-in remains native:** the SDK-generated OAuth card, its sign-in button and token-exchange resource are unchanged. The informational reply cards contain no custom login links, input fields or submit actions. They use schema **1.2** with basic `TextBlock`/`FactSet` elements for conservative Teams/Copilot compatibility; verify rendering in your actual clients after deployment. These source changes do not update the live service automatically.

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
src/                         agent, demo token display and masked diagnostics
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
