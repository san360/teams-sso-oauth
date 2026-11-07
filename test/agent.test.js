import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { AgentApplication } = require('@microsoft/agents-hosting')
const { ExceptionHelper } = require('@microsoft/agents-activity')
const root = new URL('../src/', import.meta.url)

// Load the real agent class without starting its HTTP listener or calling Azure.
const source = (await readFile(new URL('index.js', root), 'utf8')).replace(/\r\n/g, '\n')
const startup = "startServer(new SsoTestAgent(), {\n  beforeListen: (app) => app.get('/health', (req, res) => res.json({ status: 'ok' }))\n})"
assert.ok(source.includes(startup))
const isolated = source.replace(startup, 'export default SsoTestAgent').replace(
  /from '([^']+)'/g,
  (match, name) => `from '${name.startsWith('.') ? new URL(name, root).href : pathToFileURL(require.resolve(name)).href}'`
)
delete process.env.WHOAMI_TOKEN_DISPLAY
const { default: SsoTestAgent } = await import('data:text/javascript;base64,' + Buffer.from(isolated).toString('base64'))
process.env.AgentApplication__UserAuthorization__Handlers__sso__Settings__azureBotOAuthConnectionName = 'SyntheticConnection'

function fixture () {
  const activities = []
  return {
    activities,
    context: {
      activity: { type: 'message', text: 'whoami' },
      sendActivity: async activity => { activities.push(activity) },
      onSendActivities: () => {}
    }
  }
}

test('real whoami and logout methods send cards after SDK token/signout operations', async t => {
  const agent = new SsoTestAgent()
  const f = fixture()
  const token = `header.${Buffer.from(JSON.stringify({ ver: '2.0', exp: 2000000000, name: 'synthetic-private-claim' })).toString('base64url')}.signature`
  const logs = t.mock.method(console, 'log', () => {})
  const getToken = t.mock.method(agent.authorization, 'getToken', async () => ({ token }))
  await agent.whoami(f.context)
  assert.equal(f.activities.length, 1)
  assert.equal(getToken.mock.calls[0].arguments[1], 'sso')
  assert.match(f.activities[0].attachments[0].content.fallbackText, /Signed in/)
  assert.equal(f.activities[0].attachments[0].content.type, 'AdaptiveCard')
  assert.ok(f.activities[0].attachments[0].content.fallbackText.includes(token))
  assert.match(f.activities[0].attachments[0].content.fallbackText, /synthetic-private-claim/)
  assert.doesNotMatch(JSON.stringify(logs.mock.calls), /synthetic-private-claim/)
  assert.ok(!JSON.stringify(logs.mock.calls).includes(token))
  getToken.mock.mockImplementation(async () => undefined)
  await agent.whoami(f.context)
  assert.equal(f.activities.length, 2)
  assert.match(f.activities[1].attachments[0].content.fallbackText, /Sign-in required/)
  const signOut = t.mock.method(agent.authorization, 'signOut', async () => {})
  await agent.logout(f.context, {})
  assert.equal(signOut.mock.callCount(), 1)
  assert.equal(f.activities.length, 3)
  assert.match(f.activities[2].attachments[0].content.fallbackText, /Signed out/)
  await agent.echo({ ...f.context, activity: { text: 'hello' } })
  assert.equal(f.activities.length, 4)
  assert.match(f.activities[3].attachments[0].content.fallbackText, /Echo: hello/)
  for (const activity of f.activities) assert.equal(Object.hasOwn(activity, 'text'), false)
})

test('registered help handler sends one card-only reply', async t => {
  const routes = []
  t.mock.method(AgentApplication.prototype, 'onMessage', function (selector, handler) {
    routes.push({ selector, handler })
    return this
  })
  new SsoTestAgent()
  const f = fixture()
  f.context.activity.text = 'help'
  const matches = []
  for (const candidate of routes) {
    if (await candidate.selector(f.context)) matches.push(candidate)
  }
  assert.equal(matches.length, 1)
  await matches[0].handler(f.context)
  assert.equal(f.activities.length, 1)
  assert.equal(Object.hasOwn(f.activities[0], 'text'), false)
  assert.match(f.activities[0].attachments[0].content.fallbackText, /Test your SSO connection/)
})

test('real run emits safe error card for SDK sign-in exception and rethrows non-auth errors', async t => {
  const agent = new SsoTestAgent()
  const f = fixture()
  const error = ExceptionHelper.generateException(Error, { code: -120510, description: 'Failed to sign in' }, {
    status: 500,
    response: { data: { error: { code: 'ServiceError', message: 'synthetic-private-provider-error' } } }
  })
  const run = t.mock.method(AgentApplication.prototype, 'run', async () => { throw error })
  await agent.run(f.context)
  assert.equal(f.activities.length, 1)
  assert.equal(Object.hasOwn(f.activities[0], 'text'), false)
  assert.match(f.activities[0].attachments[0].content.fallbackText, /SDK -120510, HTTP 500, ServiceError/)
  assert.equal(f.activities[0].attachments[0].content.type, 'AdaptiveCard')
  assert.doesNotMatch(JSON.stringify(f.activities), /synthetic-private-provider-error/)
  const nonAuth = new Error('synthetic unrelated error')
  run.mock.mockImplementation(async () => { throw nonAuth })
  await assert.rejects(agent.run(f.context), actual => actual === nonAuth)
  assert.equal(f.activities.length, 1)
})

test('malformed diagnostics produce one explicit safe status and failed signout produces no reply', async t => {
  const agent = new SsoTestAgent()
  const f = fixture()
  t.mock.method(agent.authorization, 'getToken', async () => ({ token: 'malformed-synthetic-token' }))
  await agent.whoami(f.context)
  assert.equal(f.activities.length, 1)
  assert.match(f.activities[0].attachments[0].content.fallbackText, /token cannot be decoded/)
  assert.doesNotMatch(JSON.stringify(f.activities), /malformed-synthetic-token/)
  const signoutError = new Error('synthetic signout failure')
  t.mock.method(agent.authorization, 'signOut', async () => { throw signoutError })
  await assert.rejects(agent.logout(f.context, {}), actual => actual === signoutError)
  assert.equal(f.activities.length, 1)
})

test('token-bearing transport errors propagate without private request/message/cause', async t => {
  const agent = new SsoTestAgent()
  const f = fixture()
  const token = `header.${Buffer.from(JSON.stringify({ name: 'synthetic-sensitive-claim' })).toString('base64url')}.signature`
  const logs = t.mock.method(console, 'log', () => {})
  t.mock.method(agent.authorization, 'getToken', async () => ({ token }))
  f.context.sendActivity = async activity => {
    const error = new Error(`synthetic transport error ${token}`)
    error.config = { data: activity }
    throw error
  }
  await assert.rejects(agent.whoami(f.context), error => {
    assert.equal(error.message, 'Token diagnostic card delivery failed')
    assert.equal(error.cause, undefined)
    assert.equal(error.config, undefined)
    assert.ok(!error.stack.includes(token))
    assert.doesNotMatch(error.stack, /synthetic-sensitive-claim/)
    return true
  })
  assert.ok(!JSON.stringify(logs.mock.calls).includes(token))
  assert.doesNotMatch(JSON.stringify(logs.mock.calls), /synthetic-sensitive-claim/)
})

test('explicit masked mode retains complete redaction and invalid display mode fails safely', async t => {
  process.env.WHOAMI_TOKEN_DISPLAY = 'masked'
  const { default: MaskedAgent } = await import('data:text/javascript;base64,' + Buffer.from(isolated + '\n// masked fixture').toString('base64'))
  const agent = new MaskedAgent()
  const f = fixture()
  const token = `header.${Buffer.from(JSON.stringify({ exp: 2000000000, name: 'synthetic-masked-claim' })).toString('base64url')}.signature`
  t.mock.method(agent.authorization, 'getToken', async () => ({ token }))
  await agent.whoami(f.context)
  assert.equal(f.activities.length, 1)
  assert.match(f.activities[0].attachments[0].content.fallbackText, /JWT \(fully masked\)/)
  assert.ok(!JSON.stringify(f.activities).includes(token))
  assert.doesNotMatch(JSON.stringify(f.activities), /synthetic-masked-claim/)
  process.env.WHOAMI_TOKEN_DISPLAY = 'synthetic-invalid-setting'
  await assert.rejects(import('data:text/javascript;base64,' + Buffer.from(isolated + '\n// invalid fixture').toString('base64')), error => {
    assert.equal(error.message, 'WHOAMI_TOKEN_DISPLAY must be raw or masked')
    return true
  })
  delete process.env.WHOAMI_TOKEN_DISPLAY
})

test('send observer leaves native OAuthCard and invoke response unchanged', async t => {
  const agent = new SsoTestAgent()
  const f = fixture()
  let observer
  f.context.onSendActivities = callback => { observer = callback }
  t.mock.method(AgentApplication.prototype, 'run', async () => 'sdk-result')
  assert.equal(await agent.run(f.context), 'sdk-result')
  const native = [
    { attachments: [{ contentType: 'application/vnd.microsoft.card.oauth', content: { connectionName: 'SyntheticConnection', tokenExchangeResource: { id: 'synthetic-id' }, buttons: [{ type: 'signin', value: 'https://example.com' }] } }] },
    { type: 'invokeResponse', value: { status: 412, body: { failureDetail: 'synthetic SDK detail' } } }
  ]
  const before = structuredClone(native)
  let nextCalled = false
  assert.equal(await observer(f.context, native, async () => { nextCalled = true; return 'sent' }), 'sent')
  assert.ok(nextCalled)
  assert.deepEqual(native, before)
  assert.equal(f.activities.length, 0)
})
