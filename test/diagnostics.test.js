import test from 'node:test'
import assert from 'node:assert/strict'
import { commandText, tokenSummary } from '../src/diagnostics.js'

test('commands accept Teams and Copilot formatting', () => {
  for (const text of ['whoami', ' WHOAMI ', '/whoami', '\\whoami', '<strong>whoami</strong>', '&nbsp;whoami&nbsp;']) {
    assert.equal(commandText(text), 'whoami')
  }
  assert.equal(commandText(), '')
  assert.equal(commandText('hello'), 'hello')
})

test('token status excludes raw token and all identifying claims', () => {
  const claims = {
    ver: '2.0',
    exp: 2000000000,
    sub: 'synthetic-subject',
    oid: 'synthetic-object',
    tid: 'synthetic-directory',
    aud: 'synthetic-audience',
    name: 'Synthetic User',
    preferred_username: 'synthetic-user',
    custom: 'must-not-be-disclosed'
  }
  const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
  assert.deepEqual(tokenSummary(token), {
    signedIn: true,
    tokenVersion: '2.0',
    expiresAt: '2033-05-18T03:33:20.000Z'
  })
})

test('malformed token diagnostics fail explicitly', () => {
  assert.throws(() => tokenSummary('not-a-token'))
  assert.throws(() => tokenSummary(`header.${Buffer.from('{}').toString('base64url')}.signature`))
})
