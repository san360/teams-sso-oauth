import test from 'node:test'
import assert from 'node:assert/strict'
import { echoCard, helpCard, signedInCard, signedOutCard, signInRequiredCard, replyCard } from '../src/cards.js'

const summary = { signedIn: true, tokenVersion: '2.0', expiresAt: '2033-05-18T03:33:20.000Z' }

test('reply cards use a portable informational schema with complete text fallback', () => {
  const activities = [
    signedInCard(summary), signedOutCard(), signInRequiredCard(), helpCard(), echoCard('hello'),
    replyCard({ title: 'Sign-in failed', description: 'Verify configuration.', facts: [{ title: 'Reference', value: 'synthetic-reference' }], color: 'Attention' })
  ]
  for (const activity of activities) {
    assert.equal(activity.type, 'message')
    assert.equal(activity.textFormat, 'plain')
    assert.equal(activity.attachments.length, 1)
    assert.equal(activity.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive')
    const card = activity.attachments[0].content
    assert.equal(card.type, 'AdaptiveCard')
    assert.equal(card.version, '1.2')
    assert.equal(card.lang, 'en')
    assert.equal(card.fallbackText, activity.text)
    assert.deepEqual(Object.keys(card).sort(), ['$schema', 'body', 'fallbackText', 'lang', 'type', 'version'])
    for (const element of card.body) {
      assert.ok(['TextBlock', 'FactSet'].includes(element.type))
      if (element.type === 'TextBlock') {
        assert.equal(typeof element.text, 'string')
        assert.equal(element.wrap, true)
        assert.ok(activity.text.includes(element.text) || element.text === 'SSO DIAGNOSTICS')
      } else {
        for (const fact of element.facts) {
          assert.equal(typeof fact.title, 'string')
          assert.equal(typeof fact.value, 'string')
          assert.ok(activity.text.includes(fact.value))
        }
      }
    }
    assert.doesNotMatch(JSON.stringify(card), /Action\.|Input\.|authentication|refresh|tokenExchangeResource|signin\/|https:\/\/token/)
  }
})

test('success selects only metadata and does not leak extra claims or arbitrary version strings', () => {
  const privateValue = 'synthetic-private-claim'
  const card = signedInCard({ ...summary, name: privateValue, token: privateValue, tid: privateValue })
  assert.ok(!JSON.stringify(card).includes(privateValue))
  assert.match(card.text, /signedIn: true/)
  assert.match(card.text, /not token validation/)
  assert.match(card.text, /UTC/)
  assert.match(card.text, /2\.0/)
  const unknownVersion = signedInCard({ ...summary, tokenVersion: privateValue })
  assert.ok(!JSON.stringify(unknownVersion).includes(privateValue))
  assert.match(unknownVersion.text, /Not available/)
  assert.throws(() => signedInCard({ ...summary, expiresAt: privateValue }), TypeError)
})

test('help, sign-in-required and logout describe existing command and session semantics', () => {
  assert.match(helpCard().text, /hello \/ other text[\s\S]*whoami[\s\S]*logout[\s\S]*help/)
  assert.match(signInRequiredCard().text, /native sign-in prompt/)
  assert.match(signedOutCard().text, /Teams session and Entra consent are unchanged/)
})

test('echo preserves normalized text in fallback and escapes card Markdown formatting', () => {
  const activity = echoCard('[synthetic link](https://example.com) *test*')
  assert.match(activity.text, /Echo: \[synthetic link\]\(https:\/\/example.com\) \*test\*/)
  const description = activity.attachments[0].content.body[2].text
  assert.ok(description.includes('\\[synthetic link\\]\\(https://example\\.com\\) \\*test\\*'))
  assert.match(activity.text, /does not require sign-in/)
})
