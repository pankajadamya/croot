import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { authSecret } from './env.js'

/**
 * Opaque bearer tokens: 32 random bytes, base64url (the private response link is the one keyed-hash
 * exception, below). They are never derived from an email or any
 * identity, and only their SHA-256 hash is stored, so a database leak does not leak working links.
 */
/**
 * The guest's private response link. Derived (keyed hash) from the response id, so every time they ask
 * for it they get the same link and a bookmark keeps working. Only its hash is stored, as before.
 */
export function receiptTokenFor(responseId: string): string {
  return createHmac('sha256', authSecret).update(`receipt:${responseId}`).digest('base64url')
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

export function tokenHint(token: string): string {
  return token.slice(-4)
}

/** Shape check before any database lookup, so junk never reaches a query. */
export function looksLikeToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(value)
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Short random suffix for public story slugs. */
export function shortId(length = 8): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(length)
  let out = ''
  for (const b of bytes) out += alphabet[b % alphabet.length]
  return out
}
