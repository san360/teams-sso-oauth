// Decoding is diagnostic only; authentication remains the Agents SDK's responsibility.
export function tokenSummary (token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  return {
    signedIn: true,
    tokenVersion: payload.ver,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  }
}

export function commandText (text = '') {
  return text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().replace(/^[/\\]+/, '').toLowerCase()
}
