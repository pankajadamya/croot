import { createHash, createHmac, randomBytes } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { authSecret, env, googleCallbackUrl } from './env.js'
import { safeEqual } from './tokens.js'

/**
 * Google sign-in: OAuth 2.0 authorisation-code flow with PKCE, `state` (CSRF) and `nonce`
 * (replay), carried in a short-lived signed, httpOnly cookie. Only Google-verified emails are accepted.
 */
export const OAUTH_COOKIE = 'croot_oauth'
const TTL_MS = 10 * 60_000

export interface OAuthState {
  state: string
  nonce: string
  verifier: string
  next: string
  exp: number
}

const b64 = (b: Buffer) => b.toString('base64url')
const sign = (payload: string) => createHmac('sha256', authSecret).update(payload).digest('base64url')

export function sealState(s: OAuthState): string {
  const payload = b64(Buffer.from(JSON.stringify(s)))
  return `${payload}.${sign(payload)}`
}

export function openState(cookie: unknown): OAuthState | null {
  if (typeof cookie !== 'string') return null
  const [payload, mac] = cookie.split('.')
  if (!payload || !mac || !safeEqual(sign(payload), mac)) return null
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as OAuthState
    return s.exp > Date.now() ? s : null
  } catch {
    return null
  }
}

/** Only same-site relative paths, so the flow can never be turned into an open redirect. */
export function safeNext(next: unknown): string {
  return typeof next === 'string' && /^\/(?!\/)[\w\-./?=&%]*$/.test(next) ? next : '/admin'
}

export function authorisationUrl(next: string) {
  const s: OAuthState = { state: b64(randomBytes(24)), nonce: b64(randomBytes(24)), verifier: b64(randomBytes(48)), next: safeNext(next), exp: Date.now() + TTL_MS }
  const challenge = b64(createHash('sha256').update(s.verifier).digest())
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleCallbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state: s.state,
    nonce: s.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return { url: url.toString(), cookie: sealState(s), maxAge: TTL_MS }
}

export interface GoogleProfile {
  sub: string
  email: string
  name: string
}

/** Exchanges the code and verifies the ID token's signature, audience, issuer, expiry and nonce. */
export async function exchangeCode(code: string, s: OAuthState): Promise<GoogleProfile | null> {
  const client = new OAuth2Client({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: googleCallbackUrl })
  const { tokens } = await client.getToken({ code, codeVerifier: s.verifier })
  if (!tokens.id_token) return null
  const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.GOOGLE_CLIENT_ID })
  const p = ticket.getPayload()
  if (!p || p.nonce !== s.nonce || !p.sub || !p.email || p.email_verified !== true) return null
  return { sub: p.sub, email: p.email.toLowerCase(), name: p.name || p.email.split('@')[0] }
}
