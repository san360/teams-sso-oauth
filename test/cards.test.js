import test from 'node:test'
import assert from 'node:assert/strict'
import { echoCard, helpCard, signedInCard, signedOutCard, signInRequiredCard, replyCard, tokenDetailsCard, TOKEN_CARD_UTF8_LIMIT, TOKEN_CARD_UTF16_LIMIT } from '../src/cards.js'
import { tokenSummary } from '../src/diagnostics.js'

const summary = { signedIn: true, tokenVersion: '2.0', expiresAt: '2033-05-18T03:33:20.000Z' }

test('reply cards use a portable informational schema with complete text fallback', () => {
  const activities = [
    signedInCard(summary), signedOutCard(), signInRequiredCard(), helpCard(), echoCard('hello'),
    replyCard({ title: 'Sign-in failed', description: 'Verify configuration.', facts: [{ title: 'Reference', value: 'synthetic-reference' }], color: 'Attention' })
  ]
  for (const activity of activities) {
    assert.equal(activity.type, 'message')
    assert.equal(Object.hasOwn(activity, 'text'), false)
    assert.equal(Object.hasOwn(activity, 'textFormat'), false)
    assert.equal(activity.attachments.length, 1)
    assert.equal(activity.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive')
    const card = activity.attachments[0].content
    assert.equal(card.type, 'AdaptiveCard')
    assert.equal(card.version, '1.2')
    assert.equal(card.lang, 'en')
    assert.equal(typeof card.fallbackText, 'string')
    assert.ok(card.fallbackText.length > 0)
    assert.deepEqual(Object.keys(card).sort(), ['$schema', 'body', 'fallbackText', 'lang', 'type', 'version'])
    for (const element of card.body) {
      assert.ok(['TextBlock', 'FactSet'].includes(element.type))
      if (element.type === 'TextBlock') {
        assert.equal(typeof element.text, 'string')
        assert.equal(element.wrap, true)
        assert.ok(card.fallbackText.includes(element.text) || element.text === 'SSO DIAGNOSTICS')
      } else {
        for (const fact of element.facts) {
          assert.equal(typeof fact.title, 'string')
          assert.equal(typeof fact.value, 'string')
          assert.ok(card.fallbackText.includes(fact.value))
        }
      }
    }
    assert.doesNotMatch(JSON.stringify(card), /Action\.|Input\.|authentication|refresh|tokenExchangeResource|signin\/|https:\/\/token/)
  }
})

test('demo token card contains the complete synthetic JWT, readable dates and all decoded claims as text', () => {
  const claims = {
    exp: 2000000000, iat: 1900000000, nbf: 1900000010,
    iss: 'synthetic-issuer', aud: ['synthetic-audience'], sub: 'synthetic-subject',
    name: 'Synthetic Demo User', scp: 'synthetic-scope', roles: ['synthetic-role'],
    custom: { flag: true, missing: null, count: 7 }
  }
  const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
  const activity = tokenDetailsCard(token)
  const card = activity.attachments[0].content
  assert.equal(Object.hasOwn(activity, 'text'), false)
  assert.equal(activity.attachments.length, 1)
  assert.ok(card.fallbackText.includes(token))
  assert.ok(card.fallbackText.includes(JSON.stringify(claims, null, 2)))
  assert.match(card.fallbackText, /DEMO ONLY[\s\S]*bearer credential[\s\S]*retained in chat/)
  assert.match(card.fallbackText, /NOT signature validation/)
  assert.match(card.fallbackText, /Expires at \(exp, UTC\): 2033-05-18T03:33:20.000Z/)
  assert.match(card.fallbackText, /Issued at \(iat, UTC\): 2030-03-17T17:46:40.000Z/)
  assert.equal(card.body.filter(item => item.fontType === 'Monospace').length, 2)
  const rawText = card.body.find(item => item.fontType === 'Monospace').text
  assert.equal(rawText.replace(/\\(.)/g, '$1'), token)
  assert.doesNotMatch(JSON.stringify(card), /"actions"|"url"|"authentication"|"refresh"/)
  const size = JSON.stringify(activity)
  assert.ok(Buffer.byteLength(size, 'utf8') <= TOKEN_CARD_UTF8_LIMIT)
  assert.ok(Buffer.byteLength(size, 'utf16le') <= TOKEN_CARD_UTF16_LIMIT)
})

test('arbitrary claim keys and values cannot inject card actions, Markdown links or markup', () => {
  const claims = {
    custom: '[synthetic link](https://example.com) <script>synthetic</script> **test**',
    'https://example.com/claim': { type: 'Action.OpenUrl', value: 'synthetic-value' }
  }
  Object.defineProperty(claims, '__proto__', { value: { type: 'Action.OpenUrl', value: 'synthetic-prototype' }, enumerable: true })
  const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
  const activity = tokenDetailsCard(token)
  const card = activity.attachments[0].content
  const decoded = card.body.filter(item => item.fontType === 'Monospace')[1].text
  assert.ok(decoded.includes('\\[synthetic link\\]\\(https\\:\\/\\/example\\.com\\)'))
  assert.ok(decoded.includes('\\<script\\>'))
  assert.ok(decoded.includes('\\*\\*test\\*\\*'))
  assert.ok(card.fallbackText.includes(JSON.stringify(claims, null, 2)))
  assert.ok(card.body.every(item => ['TextBlock', 'FactSet'].includes(item.type)))
  assert.equal(card.actions, undefined)
})

test('malformed demo tokens and invalid dates return safe explicit status without token fragments', () => {
  for (const token of [
    'synthetic-sensitive-token',
    `header.${Buffer.from('synthetic-sensitive-payload').toString('base64url')}.signature`,
    `header.${Buffer.from(JSON.stringify({ exp: 'synthetic-sensitive-date' })).toString('base64url')}.signature`,
    `header.${Buffer.from(JSON.stringify({ exp: 1e300 })).toString('base64url')}.signature`,
    `header.${Buffer.from('[]').toString('base64url')}.signature`
  ]) {
    const output = JSON.stringify(tokenDetailsCard(token))
    assert.match(output, /token cannot be decoded/)
    assert.doesNotMatch(output, /synthetic-sensitive/)
    assert.ok(!output.includes(token))
  }
  const optionalDates = tokenDetailsCard(`header.${Buffer.from('{}').toString('base64url')}.signature`)
  assert.match(optionalDates.attachments[0].content.fallbackText, /Expires at \(exp, UTC\): Not present/)
})

test('serialized display budget counts fallback, escaping and Unicode without silent truncation', () => {
  const makeToken = size => `header.${Buffer.from(JSON.stringify({ custom: '界'.repeat(size) })).toString('base64url')}.signature`
  let low = 0, high = 10000
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2)
    if (tokenDetailsCard(makeToken(middle)).attachments[0].content.fallbackText.includes('token display limit')) high = middle
    else low = middle
  }
  const fittingToken = makeToken(low)
  const fitting = tokenDetailsCard(fittingToken)
  assert.ok(fitting.attachments[0].content.fallbackText.includes(fittingToken))
  assert.ok(Buffer.byteLength(JSON.stringify(fitting), 'utf8') <= TOKEN_CARD_UTF8_LIMIT)
  assert.ok(Buffer.byteLength(JSON.stringify(fitting), 'utf16le') <= TOKEN_CARD_UTF16_LIMIT)
  const rejectedToken = makeToken(high)
  const rejected = JSON.stringify(tokenDetailsCard(rejectedToken))
  assert.match(rejected, /token display limit/)
  assert.match(rejected, /not truncated/)
  assert.ok(!rejected.includes(rejectedToken))
  assert.ok(!rejected.includes('界'))
  const huge = `header.${'a'.repeat(TOKEN_CARD_UTF8_LIMIT + 1)}.signature`
  assert.match(JSON.stringify(tokenDetailsCard(huge)), /token display limit/)
})

test('success selects only metadata and does not leak extra claims or arbitrary version strings', () => {
  const privateValue = 'synthetic-private-claim'
  const card = signedInCard({ ...summary, name: privateValue, token: privateValue, tid: privateValue })
  assert.ok(!JSON.stringify(card).includes(privateValue))
  assert.match(card.attachments[0].content.fallbackText, /signedIn: true/)
  assert.match(card.attachments[0].content.fallbackText, /not token validation/)
  assert.match(card.attachments[0].content.fallbackText, /UTC/)
  assert.match(card.attachments[0].content.fallbackText, /2\.0/)
  const unknownVersion = signedInCard({ ...summary, tokenVersion: privateValue })
  assert.ok(!JSON.stringify(unknownVersion).includes(privateValue))
  assert.match(unknownVersion.attachments[0].content.fallbackText, /Not available/)
  assert.throws(() => signedInCard({ ...summary, expiresAt: privateValue }), TypeError)
})

test('help, sign-in-required and logout describe existing command and session semantics', () => {
  assert.match(helpCard().attachments[0].content.fallbackText, /hello \/ other text[\s\S]*whoami[\s\S]*logout[\s\S]*help/)
  assert.match(signInRequiredCard().attachments[0].content.fallbackText, /native sign-in prompt/)
  assert.match(signedOutCard().attachments[0].content.fallbackText, /Teams session and Entra consent are unchanged/)
})

test('echo preserves normalized text in fallback and escapes card Markdown formatting', () => {
  const activity = echoCard('[synthetic link](https://example.com) *test*')
  assert.match(activity.attachments[0].content.fallbackText, /Echo: \[synthetic link\]\(https:\/\/example.com\) \*test\*/)
  const description = activity.attachments[0].content.body[2].text
  assert.ok(description.includes('\\[synthetic link\\]\\(https://example\\.com\\) \\*test\\*'))
  assert.match(activity.attachments[0].content.fallbackText, /does not require sign-in/)
})

test('recognizable synthetic JWT is completely masked in card and all fallback text', () => {
  const claims = { ver: '2.0', exp: 2000000000, name: 'synthetic-private-name', tid: 'synthetic-private-directory' }
  const parts = [
    Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    Buffer.from('synthetic-private-signature').toString('base64url')
  ]
  const token = parts.join('.')
  const activity = signedInCard(tokenSummary(token))
  const output = JSON.stringify(activity)
  assert.match(activity.attachments[0].content.fallbackText, /JWT \(fully masked\): \[header redacted\]\.\[payload redacted\]\.\[signature redacted\]/)
  assert.match(activity.attachments[0].content.fallbackText, /bearer token is deliberately hidden/)
  assert.equal(Object.hasOwn(activity, 'text'), false)
  for (const part of parts) {
    assert.ok(!output.includes(part))
    assert.ok(!output.includes(part.slice(0, 12)))
    assert.ok(!output.includes(part.slice(-12)))
  }
  assert.ok(!output.includes(token))
  assert.doesNotMatch(output, /synthetic-private/)
})
