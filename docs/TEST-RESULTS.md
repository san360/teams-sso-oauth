# Repeatable validation procedure

This public file is a **test procedure**, not a record of a live deployment. It deliberately contains no tenant IDs, user names, deployment names, private timestamps or captured tokens. Keep actual results in approved private storage. Live Teams/Copilot SSO must be verified in your own tenant after deploying.

## Offline checks

Run `npm ci` and `npm test`. Tests cover formatted command matching, non-identifying token summaries, explicit failure for malformed diagnostic token payloads, exact index scanning, historic identifiers, private commit metadata and PNG trailing content. These tests do not validate JWT signatures or prove Azure authentication.

Run `node scripts\check-publication.js --staged` before a commit, and `node scripts\check-publication.js --history` before public publication. See [scan limitations](PUBLICATION.md).

## Live baseline

1. Build the package and run `scripts\verify-config.ps1`. Every rule must pass, including the three matching API resource URI values and separate bot/auth app IDs.
2. Confirm `/health` returns 200. POST an unsigned activity to `/api/messages` and confirm rejection.
3. Install/open the app in Teams personal chat. Repeat in supported Microsoft 365 Copilot clients if needed.
4. Record only pass/fail, host type and sanitized error categories privately.

| Test | Expected outcome |
|---|---|
| `hello` | Echo; proves bidirectional channel delivery |
| `whoami` with empty Token Service cache | Sign-in completes; a successful silent flow needs no sign-in button click |
| Reply contents | `signedIn`, token version and expiry only; no raw JWT, UPN, tenant, object ID or name |
| Logs | `outgoingOAuthCard` with resource-present flag when a card is emitted, `incomingInvoke` for token exchange, successful invoke status, `whoami` signed-in marker |
| `logout`, then `whoami` | New Token Service authorization cycle; the client may reuse its own Entra session |
| Unsupported/blocked silent flow | Interactive sign-in/consent or a clear failure; do not label it silent SSO success |
| After reviewed optional admin consent | Repeat the same matrix; compare without assuming consent fixes URI/FIC mismatches |

Pre-authorized clients can acquire the sample API scope without an interactive consent prompt in some configurations. That does not prove all tenants, users, scopes or downstream APIs will behave identically. Conditional Access and tenant consent restrictions still apply.

Direct Line/Web Chat message delivery or an OAuth card is useful for baseline delivery only. It is not evidence that Teams/Copilot `signin/tokenExchange` succeeds.

## Troubleshooting

| Symptom | Check |
|---|---|
| No echo | App Service build/startup, messaging endpoint, Teams channel, managed-identity assignment, SDK identity settings, app installation/policy |
| Card has no token-exchange resource | OAuth provider configuration and exact Token Exchange URL |
| No `signin/tokenExchange` at the bot | All three resource URIs, client pre-authorization, tenant/Conditional Access, client support and Entra sign-in error code |
| Exchange fails or invoke returns 412 | Connection name, FIC issuer/subject/audience, matching unique identifier, requested resource scope and applicable consent |
| Interactive sign-in only | Verify silent exchange separately; interactive OAuth success alone is insufficient |
| App installation fails | Manifest schema/version, separate SSO app ID in `webApplicationInfo.id`, bot/custom-engine ID alignment, valid metadata/icons and tenant policy |
| Configuration command fails | Required Azure/Graph permissions, native CLI error, app-name collisions or replication delay |

Entra sign-in logs may be delayed. Diagnostic scripts require separate reporting permissions and can return restricted data. Never copy raw tokens into web tools or public issue reports.
