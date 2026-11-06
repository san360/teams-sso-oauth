// Minimal Teams / Microsoft 365 Copilot agent for testing Bot SSO (signin/tokenExchange).
//
//   any text  -> echo (no sign-in required, proves message delivery)
//   whoami    -> requires sign-in via the "sso" handler, replies with non-identifying status
//   logout    -> clears the cached user token from the Bot Framework Token Service
//
// All configuration comes from environment variables (see .env.example).

import { startServer } from '@microsoft/agents-hosting-express'
import { AgentApplication, MemoryStorage, MessageFactory } from '@microsoft/agents-hosting'
import { ActivityTypes } from '@microsoft/agents-activity'
import { commandText, tokenSummary } from './diagnostics.js'

const SSO_HANDLER = 'sso'

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

    this.authorization.onSignInFailure(async (context, state, handlerId) => {
      log('signInFailure', { handlerId })
      await context.sendActivity('Sign-in failed. Ask the deployment administrator to check the OAuth connection and Entra sign-in logs.')
    })

    this.onMessage(isCommand('whoami'), this.whoami, [SSO_HANDLER])
    this.onMessage(isCommand('logout'), this.logout)
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

    return super.run(context)
  }

  // Confirm channel delivery without initiating user authorization.
  echo = async (context) => {
    await context.sendActivity(`Echo: ${commandText(context.activity.text)}\n\nType **whoami** to test SSO.`)
  }

  // Read the token after the route's SSO handler completes; return diagnostic metadata only.
  whoami = async (context) => {
    const tokenResponse = await this.authorization.getToken(context, SSO_HANDLER)
    if (!tokenResponse?.token) {
      await context.sendActivity('No token available yet.')
      return
    }
    const summary = tokenSummary(tokenResponse.token)
    log('whoami', { signedIn: true })
    await context.sendActivity(MessageFactory.text(
      'Signed in. Non-identifying token status (not a token validation result):\n\n```json\n' +
      JSON.stringify(summary, null, 2) + '\n```'
    ))
  }

  // Clear the user's Token Service cache, not their Teams session or Entra consent.
  logout = async (context, state) => {
    await this.authorization.signOut(context, state)
    await context.sendActivity('Signed out. The next **whoami** starts a fresh sign-in.')
  }
}

startServer(new SsoTestAgent(), {
  beforeListen: (app) => app.get('/health', (req, res) => res.json({ status: 'ok' }))
})
