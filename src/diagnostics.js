// Select non-identifying JWT metadata; decoding does not validate the token or grant access.
export function tokenSummary (token) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  return {
    signedIn: true,
    tokenVersion: payload.ver,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  }
}

// Normalize HTML, nonbreaking spaces and slash prefixes emitted by Teams/Copilot clients.
export function commandText (text = '') {
  return text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().replace(/^[/\\]+/, '').toLowerCase()
}
