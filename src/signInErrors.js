import { randomBytes } from 'node:crypto'
import { commandText } from './diagnostics.js'

const signInCodes = new Set([-120510, -120591])
const providerCodes = new Set(['ServiceError', 'invalid_grant', 'invalid_client', 'access_denied', 'interaction_required', 'consent_required'])

// Project allowlisted diagnostics only; provider messages, requests and stacks can contain secrets.
export async function reportSignInFailure (context, error, log) {
  const reference = randomBytes(8).toString('hex')
  const sdkCode = signInCodes.has(error?.code) ? error.code : undefined
  const cause = error?.innerException ?? error
  const status = cause?.status
  const httpStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined
  const rawCode = cause?.response?.data?.error?.code
  const providerCode = providerCodes.has(rawCode) ? rawCode : undefined
  log('signInFailure', { reference, sdkCode, httpStatus, providerCode })

  const details = [
    sdkCode === undefined ? undefined : `SDK ${sdkCode}`,
    httpStatus === undefined ? undefined : `HTTP ${httpStatus}`,
    providerCode
  ].filter(Boolean).join(', ')
  await context.sendActivity(
    '**Sign-in failed**\n\n' +
    (details ? `**Details:** ${details}\n\n` : '') +
    'Ask the deployment administrator to verify that the sso handler uses the exact Azure Bot OAuth connection name, ' +
    'then check its Entra configuration and consent. ' +
    `\n\n**Reference:** \`${reference}\``
  )
}

// Token retrieval can throw before onSignInFailure; only intercept known whoami message failures.
export async function runWithSignInErrors (context, run, log) {
  try {
    return await run()
  } catch (error) {
    if (context.activity.type !== 'message' ||
        commandText(context.activity.text) !== 'whoami' ||
        !signInCodes.has(error?.code)) {
      throw error
    }
    await reportSignInFailure(context, error, log)
  }
}
