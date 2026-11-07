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
  const getToken = t.mock.method(agent.authorization, 'getToken', async () => ({ token }))
  await agent.whoami(f.context)
  assert.equal(getToken.mock.calls[0].arguments[1], 'sso')
  assert.match(f.activities[0].text, /Signed in/)
  assert.equal(f.activities[0].attachments[0].content.type, 'AdaptiveCard')
  assert.ok(!JSON.stringify(f.activities).includes(token))
  assert.doesNotMatch(JSON.stringify(f.activities), /synthetic-private-claim/)
  getToken.mock.mockImplementation(async () => undefined)
  await agent.whoami(f.context)
  assert.match(f.activities[1].text, /Sign-in required/)
  const signOut = t.mock.method(agent.authorization, 'signOut', async () => {})
  await agent.logout(f.context, {})
  assert.equal(signOut.mock.callCount(), 1)
  assert.match(f.activities[2].text, /Signed out/)
  await agent.echo({ ...f.context, activity: { text: 'hello' } })
  assert.match(f.activities[3].text, /Echo: hello/)
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
  assert.match(f.activities[0].text, /SDK -120510, HTTP 500, ServiceError/)
  assert.equal(f.activities[0].attachments[0].content.type, 'AdaptiveCard')
  assert.doesNotMatch(JSON.stringify(f.activities), /synthetic-private-provider-error/)
  const nonAuth = new Error('synthetic unrelated error')
  run.mock.mockImplementation(async () => { throw nonAuth })
  await assert.rejects(agent.run(f.context), actual => actual === nonAuth)
  assert.equal(f.activities.length, 1)
})

test('failed token diagnostics or signout never produce a success card', async t => {
  const agent = new SsoTestAgent()
  const f = fixture()
  t.mock.method(agent.authorization, 'getToken', async () => ({ token: 'malformed-synthetic-token' }))
  await assert.rejects(agent.whoami(f.context))
  const signoutError = new Error('synthetic signout failure')
  t.mock.method(agent.authorization, 'signOut', async () => { throw signoutError })
  await assert.rejects(agent.logout(f.context, {}), actual => actual === signoutError)
  assert.equal(f.activities.length, 0)
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
