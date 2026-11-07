import test from 'node:test'
import assert from 'node:assert/strict'
import { reportSignInFailure, runWithSignInErrors } from '../src/signInErrors.js'

function fixture (text = 'whoami', type = 'message') {
  const messages = []
  const events = []
  return {
    context: { activity: { type, text }, sendActivity: async text => { messages.push(text) } },
    log: (event, data) => events.push({ event, ...data }),
    messages,
    events
  }
}

function retrievalError (status = 500) {
  return Object.assign(new Error('synthetic private provider message'), {
    code: -120510,
    innerException: {
      status,
      message: 'synthetic private provider detail',
      config: { data: { token: 'synthetic-private-token', connectionName: 'synthetic-wrong-connection' } },
      response: { data: { error: { code: 'ServiceError', message: 'synthetic private provider response' } } }
    }
  })
}

test('wrong connection surfaces failed token retrieval safely with matching reference', async () => {
  const f = fixture('<strong>whoami</strong>')
  await runWithSignInErrors(f.context, async () => { throw retrievalError() }, f.log)
  assert.equal(f.messages.length, 1)
  assert.match(f.messages[0].attachments[0].content.fallbackText, /SDK -120510, HTTP 500, ServiceError/)
  assert.match(f.messages[0].attachments[0].content.fallbackText, /exact Azure Bot OAuth connection name/)
  assert.match(f.events[0].reference, /^[0-9a-f]{16}$/)
  assert.ok(f.messages[0].attachments[0].content.fallbackText.includes(f.events[0].reference))
  const card = f.messages[0].attachments[0].content
  assert.equal(Object.hasOwn(f.messages[0], 'text'), false)
  assert.equal(card.body.find(item => item.type === 'FactSet').facts.find(fact => fact.title === 'Reference').value, f.events[0].reference)
  assert.deepEqual(Object.keys(f.events[0]).sort(), ['event', 'httpStatus', 'providerCode', 'reference', 'sdkCode'])
  assert.doesNotMatch(JSON.stringify([f.messages, f.events]), /synthetic|stack|connectionName/)
})

test('missing connection preserves observed status without claiming provider said not found', async () => {
  const f = fixture()
  await runWithSignInErrors(f.context, async () => { throw retrievalError(404) }, f.log)
  assert.match(f.messages[0].attachments[0].content.fallbackText, /HTTP 404/)
  assert.doesNotMatch(JSON.stringify(f.messages[0]), /connection not found/i)
})

test('missing connection configuration code is handled if raised during whoami', async () => {
  const f = fixture()
  await runWithSignInErrors(f.context, async () => { throw { code: -120591 } }, f.log)
  assert.match(f.messages[0].attachments[0].content.fallbackText, /SDK -120591/)
})

test('non-auth errors and failures on other routes or invokes retain SDK handling', async () => {
  for (const [text, type, error] of [
    ['whoami', 'message', new Error('non-auth failure')],
    ['hello', 'message', retrievalError()],
    ['logout', 'message', retrievalError()],
    ['', 'invoke', retrievalError()],
    ['whoami', 'message', { code: '-120510' }]
  ]) {
    const f = fixture(text, type)
    await assert.rejects(runWithSignInErrors(f.context, async () => { throw error }, f.log), actual => actual === error)
    assert.equal(f.messages.length, 0)
    assert.equal(f.events.length, 0)
  }
})

test('sign-in callback reasons are not echoed and unapproved diagnostic values are omitted', async () => {
  const f = fixture()
  const privateText = ['synthetic-person', 'example.invalid'].join('@')
  await reportSignInFailure(f.context, {
    message: privateText,
    status: '500',
    code: privateText,
    response: { data: { error: { code: privateText } } }
  }, f.log)
  assert.equal(f.events[0].httpStatus, undefined)
  assert.equal(f.events[0].sdkCode, undefined)
  assert.equal(f.events[0].providerCode, undefined)
  assert.ok(!JSON.stringify([f.messages, f.events]).includes(privateText))
  await reportSignInFailure(f.context, privateText, f.log)
  assert.ok(!JSON.stringify([f.messages, f.events]).includes(privateText))
})

test('successful turns return normally, and reporting failures are not swallowed', async () => {
  const f = fixture()
  assert.equal(await runWithSignInErrors(f.context, async () => 'result', f.log), 'result')
  assert.equal(f.events.length, 0)
  const sendError = new Error('send failed')
  f.context.sendActivity = async () => { throw sendError }
  await assert.rejects(runWithSignInErrors(f.context, async () => { throw retrievalError() }, f.log), actual => actual === sendError)
})
