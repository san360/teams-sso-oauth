export class TokenDiagnosticError extends TypeError {}

// Decode locally with static errors: parser exceptions can otherwise quote private payload text.
export function tokenPayload (token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    throw new TokenDiagnosticError('Invalid JWT diagnostic format')
  }
  let payload
  try {
    const encoded = token.split('.')[1]
    const bytes = Buffer.from(encoded, 'base64url')
    if (bytes.toString('base64url') !== encoded) throw new TokenDiagnosticError('Invalid JWT diagnostic payload')
    payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof TypeError)) throw error
    throw new TokenDiagnosticError('Invalid JWT diagnostic payload')
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TokenDiagnosticError('Invalid JWT diagnostic payload')
  }
  const pending = [[payload, 0]]
  while (pending.length) {
    const [value, depth] = pending.pop()
    if (depth > 32) throw new TokenDiagnosticError('Unsupported JWT diagnostic nesting')
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object') pending.push([child, depth + 1])
    }
  }
  return payload
}

// NumericDate claims are optional for decoding, but invalid supplied values are never echoed.
export function tokenDate (value) {
  if (value === undefined) return 'Not present'
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value * 1000) > 8640000000000000) {
    throw new TokenDiagnosticError('Invalid token date diagnostic')
  }
  return new Date(value * 1000).toISOString()
}

// Select non-identifying JWT metadata; decoding does not validate the token or grant access.
export function tokenSummary (token) {
  const payload = tokenPayload(token)
  if (payload.exp === undefined) throw new TokenDiagnosticError('Invalid token expiry diagnostic')
  return {
    signedIn: true,
    tokenVersion: ['1.0', '2.0'].includes(payload.ver) ? payload.ver : undefined,
    expiresAt: tokenDate(payload.exp)
  }
}

// Normalize HTML, nonbreaking spaces and slash prefixes emitted by Teams/Copilot clients.
export function commandText (text = '') {
  return text.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().replace(/^[/\\]+/, '').toLowerCase()
}
