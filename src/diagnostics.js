// Select non-identifying JWT metadata; decoding does not validate the token or grant access.
export function tokenSummary (token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new TypeError('Invalid JWT diagnostic format')
  }
  let payload
  try {
    payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    throw new TypeError('Invalid JWT diagnostic payload')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new TypeError('Invalid token expiry diagnostic')
  }
  return {
    signedIn: true,
    tokenVersion: ['1.0', '2.0'].includes(payload.ver) ? payload.ver : undefined,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  }
}

// Normalize HTML, nonbreaking spaces and slash prefixes emitted by Teams/Copilot clients.
export function commandText (text = '') {
  return text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().replace(/^[/\\]+/, '').toLowerCase()
}
