// Minimal Teams / Microsoft 365 Copilot agent for testing Bot SSO (signin/tokenExchange).
//
//   any text  -> echo (no sign-in required, proves message delivery)
//   whoami    -> requires sign-in via "sso"; demo default discloses token/claims in chat
//   logout    -> clears the cached user token from the Bot Framework Token Service
//   help      -> shows commands without sign-in
//
// All configuration comes from environment variables (see .env.example).

import { startServer } from '@microsoft/agents-hosting-express'
import { AgentApplication, MemoryStorage } from '@microsoft/agents-hosting'
import { ActivityTypes } from '@microsoft/agents-activity'
import { commandText, tokenSummary } from './diagnostics.js'
import { reportSignInFailure, runWithSignInErrors } from './signInErrors.js'
import { echoCard, helpCard, signedInCard, signedOutCard, signInRequiredCard, tokenDetailsCard } from './cards.js'

const SSO_HANDLER = 'sso'
const TOKEN_DISPLAY = process.env.WHOAMI_TOKEN_DISPLAY ?? 'raw'
if (!['raw', 'masked'].includes(TOKEN_DISPLAY)) throw new TypeError('WHOAMI_TOKEN_DISPLAY must be raw or masked')

// Callers supply only non-identifying flow markers, never token or activity payloads.
function log (event, data) {
  console.log(`[sso-test] ${event} ${JSON.stringify(data)}`)
}

// Build an SDK route selector that tolerates Teams/Copilot command formatting.
const isCommand = (name) => async (context) =>
  context.activity.type === ActivityTypes.Message && commandText(context.activity.text) === name

class SsoTestAgent extends AgentApplication {
  // Require the configured SSO handler only for whoami; keep echo and logout accessible.
  constructor () {
    super({ storage: new MemoryStorage() })

    this.authorization.onSignInFailure(async (context, state, handlerId, error) => {
      await reportSignInFailure(context, error, log)
    })

    this.onMessage(isCommand('whoami'), this.whoami, [SSO_HANDLER])
    this.onMessage(isCommand('logout'), this.logout)
    this.onMessage(isCommand('help'), async (context) => context.sendActivity(helpCard()))
    this.onActivity(ActivityTypes.Message, this.echo)
  }

  // Observe sign-in traffic without payloads, then let the SDK handle authentication and routing.
  async run (context) {
    const activity = context.activity
    if (activity.type === ActivityTypes.Invoke && activity.name?.startsWith('signin/')) {
      log('incomingInvoke', { name: activity.name === 'signin/tokenExchange' ? 'signin/tokenExchange' : 'signin/other' })
    }

    context.onSendActivities(async (ctx, activities, next) => {
      for (const sent of activities) {
        const card = sent.attachments?.find(a => a.contentType === 'application/vnd.microsoft.card.oauth')
        if (card) {
          log('outgoingOAuthCard', {
            connectionName: card.content.connectionName,
            hasTokenExchangeResource: Boolean(card.content.tokenExchangeResource)
          })
        }
        if (sent.type === ActivityTypes.InvokeResponse) {
          log('invokeResponse', { status: sent.value?.status })
        }
      }
      return next()
    })

    return runWithSignInErrors(context, () => super.run(context), log)
  }

  // Confirm channel delivery without initiating user authorization.
  echo = async (context) => {
    await context.sendActivity(echoCard(commandText(context.activity.text)))
  }

  // Read only after SDK authorization; demo disclosure is confined to this intentional reply.
  whoami = async (context) => {
    const tokenResponse = await this.authorization.getToken(context, SSO_HANDLER)
    if (!tokenResponse?.token) {
      await context.sendActivity(signInRequiredCard())
      return
    }
    const activity = TOKEN_DISPLAY === 'masked'
      ? signedInCard(tokenSummary(tokenResponse.token))
      : tokenDetailsCard(tokenResponse.token)
    log('whoami', { signedIn: true })
    try {
      await context.sendActivity(activity)
    } catch {
      // Transport errors can retain the token-bearing request body; propagate a static failure instead.
      throw new Error('Token diagnostic card delivery failed')
    }
  }

  // Clear the user's Token Service cache, not their Teams session or Entra consent.
  logout = async (context, state) => {
    await this.authorization.signOut(context, state)
    await context.sendActivity(signedOutCard())
  }
}

startServer(new SsoTestAgent(), {
  beforeListen: (app) => app.get('/health', (req, res) => res.json({ status: 'ok' }))
})
