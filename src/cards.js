// Keep reply cards informational: OAuth prompts and sign-in invokes belong to the SDK.
export function replyCard ({ title, description, facts = [], next, color = 'Default' }) {
  const text = [
    title,
    description,
    ...facts.map(({ title, value }) => `${title}: ${value}`),
    next
  ].filter(Boolean).join('\n\n')
  const body = [
    { type: 'TextBlock', text: 'SSO DIAGNOSTICS', size: 'Small', weight: 'Bolder', color: 'Accent', wrap: true },
    { type: 'TextBlock', text: title, size: 'Large', weight: 'Bolder', color, spacing: 'Small', wrap: true },
    { type: 'TextBlock', text: description, wrap: true }
  ]
  if (facts.length) body.push({ type: 'FactSet', facts, spacing: 'Medium' })
  if (next) body.push({ type: 'TextBlock', text: next, separator: true, spacing: 'Medium', wrap: true })
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.2',
        lang: 'en',
        fallbackText: text,
        body
      }
    }]
  }
}

// Select diagnostic fields explicitly; never spread a token response or decoded claims into a card.
export function signedInCard (summary) {
  const version = ['1.0', '2.0'].includes(summary.tokenVersion) ? summary.tokenVersion : 'Not available'
  if (typeof summary.expiresAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(summary.expiresAt) ||
      new Date(summary.expiresAt).toISOString() !== summary.expiresAt) {
    throw new TypeError('Invalid token expiry diagnostic')
  }
  return replyCard({
    title: 'Signed in',
    color: 'Good',
    description: 'The SSO handler returned a user token. These decoded details are diagnostic only, not token validation or an access-control decision.',
    facts: [
      { title: 'Status', value: 'signedIn: true' },
      { title: 'JWT (fully masked)', value: '[header redacted].[payload redacted].[signature redacted]' },
      { title: 'Token version', value: version },
      { title: 'Expires at (UTC)', value: summary.expiresAt }
    ],
    next: 'The bearer token is deliberately hidden, including every prefix and suffix. Type logout to clear the Token Service cache, then whoami to test a fresh sign-in. No identity claims or raw token are shown.'
  })
}

export function signInRequiredCard () {
  return replyCard({
    title: 'Sign-in required',
    color: 'Attention',
    description: 'No user token is available yet. Complete the native sign-in prompt if your client offers one.',
    next: 'Type whoami to retry. If no sign-in prompt appears, ask the deployment administrator to check the SSO configuration.'
  })
}

export function signedOutCard () {
  return replyCard({
    title: 'Signed out',
    description: 'The Token Service cache was cleared. Your Teams session and Entra consent are unchanged.',
    next: 'Type whoami to start a fresh sign-in cycle. Your client may reuse its existing Entra session.'
  })
}

export function helpCard () {
  return replyCard({
    title: 'Test your SSO connection',
    description: 'Start with a channel check, then test user authorization. Do not send sensitive messages to this diagnostic sample.',
    facts: [
      { title: 'hello / other text', value: 'Echo without sign-in: checks channel delivery' },
      { title: 'whoami', value: 'Test SSO and view non-identifying token status' },
      { title: 'logout', value: 'Clear the Token Service cache for a fresh sign-in' },
      { title: 'help', value: 'Show these commands' }
    ],
    next: 'A successful echo is not proof of user SSO. Use the native OAuth prompt if interaction is required.'
  })
}

// TextBlock supports Markdown; escape user-controlled formatting rather than turning it into links.
export function echoCard (text) {
  const escaped = text.replace(/[\\`*_{}\[\]()#+.!<>]/g, '\\$&')
  const activity = replyCard({
    title: 'Channel connected',
    description: `Echo: ${escaped}`,
    next: 'This reply does not require sign-in. Type whoami to test SSO, or help for commands.'
  })
  activity.attachments[0].content.fallbackText = [
    'Channel connected', `Echo: ${text}`, 'This reply does not require sign-in. Type whoami to test SSO, or help for commands.'
  ].join('\n\n')
  return activity
}
