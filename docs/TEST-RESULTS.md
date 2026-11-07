# Repeatable validation procedure

[Overview](../README.md) | [Architecture](ARCHITECTURE.md) | [Configure](CONFIGURATION.md) | [Deploy](DEPLOYMENT.md)

This public file is a **test procedure**, not a record of a live deployment. It deliberately contains no tenant IDs, user names, deployment names, private timestamps or captured tokens. Keep actual results in approved private storage. Live Teams/Copilot SSO must be verified in your own tenant after deploying.

## Offline checks

Run `npm ci` and `npm test`. Tests cover formatted command matching, non-identifying token summaries, explicit failure for malformed diagnostic token payloads, reply-card structure and fallbacks, card privacy, safe sign-in error reporting and reference matching, real agent-method wiring, unchanged OAuth attachments/invoke responses, unrelated-error propagation, exact index scanning, historic identifiers, private commit metadata and PNG trailing content. These tests do not validate JWT signatures or prove Azure authentication or visual rendering in a live client.

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
| `help` / echo / logout | Informational cards with clear headings and next steps; no extra sign-in requirement |
| Sign-in success card | Fixed fully masked JWT schematic, selected status/version/UTC expiry, explicit diagnostic-not-validation warning; no token fragments |
| Sign-in failure card | Safe details, configuration guidance and reference matching `signInFailure` log; no provider message |
| Native OAuth prompt | SDK-generated sign-in button/resource unchanged; silent exchange still works where supported |
| Card fallback and accessibility | Complete text fallback, wrapped text, readable labels and status words independent of color |

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

### Token retrieval fails before the sign-in callback

A wrong runtime OAuth connection name can make `GetTokenOrSignInResource` fail before the SDK invokes `onSignInFailure`. In Agents SDK 1.10.1, the authorization manager wraps a thrown sign-in error as SDK code `-120510` and passes it toward the adapter's turn-error handling. Without application handling, the user sees a generic agent-error message rather than the sign-in callback's response.

The sample intercepts known sign-in errors (`-120510`, or missing-connection configuration code `-120591` if raised during the turn) only on `whoami` message turns. It reports a failed sign-in, an available numeric HTTP status, an allowlisted provider code and a generated reference. For example, an HTTP 500 `ServiceError` remains a generic token-retrieval failure: it does **not** prove the provider explicitly reported "connection not found." Compare the runtime handler's connection name with the connections actually configured on Azure Bot.

The matching `signInFailure` log marker contains only that reference and allowlisted diagnostic fields, never provider messages, tokens, claims, connection values, URLs or stacks. The existing sign-in-failure callback uses the same safe reporting. Unrelated errors, other commands and invoke turns retain SDK error handling; startup configuration errors still fail startup. A failure while sending the error response is not swallowed. Verbose SDK/service logs remain a separate privacy concern.

After deploying updated source, repeat `logout` and `whoami`. Code published to GitHub does not automatically update the running Azure service.

### Reply-card compatibility

The application sends informational Adaptive Cards 1.2 (`TextBlock` and `FactSet`) with the same full fallback in activity `text` and card `fallbackText`. There are no custom authentication actions, inputs, refreshes or remote images. In clients that display both activity text and attachments, the fallback may appear alongside the card. Check desktop, mobile and your supported Copilot host; actual rendering is host-controlled.

The echo card preserves the existing normalized echo behavior and escapes Markdown formatting in its card body. Echo still repeats user input; it is not anonymization. Help explains commands without requiring authorization. Logout is shown only after SDK sign-out succeeds; the sign-in-required status does not pretend authorization completed.

`whoami` deliberately displays `[header redacted].[payload redacted].[signature redacted]` instead of the JWT. Tests use a recognizable synthetic JWT and assert that its complete value, segments, prefixes/suffixes and identity claims are absent from the card and fallback. Diagnostic parsing rejects malformed compact-token shapes and non-numeric expiry values; this structural check is not signature validation. Only known version values are retained. Never paste a real bearer token into chat to compare it with the schematic.

Public schema references: [AdaptiveCard fallback](https://learn.microsoft.com/adaptive-cards/schema-explorer/adaptive-card#properties), [TextBlock](https://learn.microsoft.com/adaptive-cards/schema-explorer/text-block), [FactSet](https://learn.microsoft.com/adaptive-cards/schema-explorer/fact-set).

Entra sign-in logs may be delayed. Diagnostic scripts require separate reporting permissions and can return restricted data. Never copy raw tokens into web tools or public issue reports.
