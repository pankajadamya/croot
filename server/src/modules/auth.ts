import { Router, type Response } from 'express'
import { z } from 'zod'
import { landingFor } from '../../../shared/landing.js'
import { audit } from '../lib/audit.js'
import { env, googleCallbackUrl, googleEnabled, isProduction } from '../lib/env.js'
import { authorisationUrl, exchangeCode, OAUTH_COOKIE, openState, safeNext } from '../lib/google.js'
import { HttpError, parseBody, route, text } from '../lib/http.js'
import { mayCreateAccount, requestCode, verifyCode } from '../lib/loginCodes.js'
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from '../lib/password.js'
import { prisma } from '../lib/prisma.js'
import { hashToken, looksLikeToken, newToken, safeEqual } from '../lib/tokens.js'
import { createSession, destroySession, requireCsrf, requireUser } from '../middleware/auth.js'
import { codeLimiter, loginLimiter, tokenLimiter } from '../middleware/rateLimits.js'

export const authRouter = Router()

async function membershipsOf(userId: string) {
  const rows = await prisma.membership.findMany({
    where: { userId },
    include: { organisation: { select: { slug: true, name: true, status: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((m) => ({ slug: m.organisation.slug, name: m.organisation.name, status: m.organisation.status, role: m.role }))
}

async function signedIn(res: Response, userId: string, method: 'code' | 'google' | 'password', created = false) {
  const user = await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } })
  const { csrfToken } = await createSession(res, user.id)
  await audit({ actorUserId: user.id, actorKind: 'user', action: created ? `auth.signup.${method}` : `auth.login.${method}`, entityType: 'user', entityId: user.id })
  return {
    user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin },
    csrfToken,
    memberships: await membershipsOf(user.id),
    created,
  }
}

/** Which sign-in methods this deployment offers. */
authRouter.get(
  '/providers',
  route(async (_req, res) => {
    res.json({ google: googleEnabled, emailCode: true, password: true, organiserSignup: env.ORG_SIGNUP_ENABLED })
  }),
)

const codeRequestSchema = z.object({
  email: z.email().max(200),
  purpose: z.enum(['signin', 'signup']).default('signin'),
  name: text(120).optional(),
})

/** Always answers the same way, whether or not the address has an account. */
authRouter.post(
  '/code/request',
  codeLimiter,
  route(async (req, res) => {
    const body = parseBody(codeRequestSchema, req.body)
    await requestCode(body.email, body.purpose, body.name)
    res.json({ ok: true, message: 'If that address can sign in here, a code is on its way.' })
  }),
)

authRouter.post(
  '/code/verify',
  loginLimiter,
  route(async (req, res) => {
    const body = parseBody(z.object({ email: z.email().max(200), code: z.string().trim().max(12) }), req.body)
    const result = await verifyCode(body.email, body.code.replace(/\s+/g, ''))
    if (!result.ok) throw new HttpError(401, 'That code is not valid or has expired. Request a new one.')
    res.json(await signedIn(res, result.userId, 'code', result.created))
  }),
)

// ---------------------------------------------------------------------------------------------
// Google sign-in / sign-up

authRouter.get(
  '/google/start',
  loginLimiter,
  route(async (req, res) => {
    if (!googleEnabled) throw new HttpError(404, 'Google sign-in is not configured')
    // The state cookie must be set on the host Google redirects back to. On a tenant's custom
    // domain, hop to the callback's host first (only that one redirect URI is registered with Google).
    const callbackHost = new URL(googleCallbackUrl)
    if (req.hostname !== callbackHost.hostname) {
      const hop = new URL('/api/auth/google/start', callbackHost.origin)
      hop.searchParams.set('next', safeNext(req.query.next))
      return res.redirect(302, hop.toString())
    }
    const { url, cookie, maxAge } = authorisationUrl(safeNext(req.query.next))
    res.cookie(OAUTH_COOKIE, cookie, { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/api/auth/google', maxAge })
    res.redirect(302, url)
  }),
)

authRouter.get(
  '/google/callback',
  route(async (req, res) => {
    const fail = (reason: string) => res.redirect(302, `/admin/login?error=${encodeURIComponent(reason)}`)
    const saved = openState(req.cookies?.[OAUTH_COOKIE])
    res.clearCookie(OAUTH_COOKIE, { path: '/api/auth/google' })
    if (!googleEnabled) return fail('google_unavailable')
    if (typeof req.query.error === 'string') return fail('google_cancelled')
    if (!saved || typeof req.query.state !== 'string' || !safeEqual(req.query.state, saved.state) || typeof req.query.code !== 'string') {
      return fail('google_state')
    }
    let profile
    try {
      profile = await exchangeCode(req.query.code, saved)
    } catch (e) {
      console.error('google sign-in failed:', (e as Error).message)
      return fail('google_failed')
    }
    if (!profile) return fail('google_unverified')

    // Match by Google account first, then link a verified email to an existing account.
    let user = await prisma.user.findUnique({ where: { googleSub: profile.sub } })
    let created = false
    if (!user) {
      const byEmail = await prisma.user.findUnique({ where: { email: profile.email } })
      if (byEmail) {
        user = await prisma.user.update({ where: { id: byEmail.id }, data: { googleSub: profile.sub, emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date() } })
      } else {
        if (!(await mayCreateAccount(profile.email))) return fail('no_account')
        user = await prisma.user.create({ data: { email: profile.email, name: profile.name, googleSub: profile.sub, emailVerifiedAt: new Date() } })
        created = true
      }
    }
    if (!user.active) return fail('account_disabled')
    const session = await signedIn(res, user.id, 'google', created)
    // The page asked for, if this person can open it; otherwise their own home (shared/landing.ts).
    res.redirect(302, landingFor(saved.next === '/' ? null : saved.next, { isPlatformAdmin: session.user.isPlatformAdmin, memberships: session.memberships }))
  }),
)

authRouter.get(
  '/me',
  route(async (req, res) => {
    if (!req.auth) throw new HttpError(401, 'Please sign in')
    res.set('Cache-Control', 'no-store')
    res.json({ user: req.auth.user, csrfToken: req.auth.csrfToken, memberships: await membershipsOf(req.auth.user.id) })
  }),
)

const loginSchema = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) })

authRouter.post(
  '/login',
  loginLimiter,
  route(async (req, res) => {
    const body = parseBody(loginSchema, req.body)
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } })
    // Always run the hash comparison so response time does not reveal whether the account exists.
    const ok = await verifyPassword(body.password, user?.passwordHash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')
    if (!user || !ok || !user.active) throw new HttpError(401, 'Email or password is incorrect')
    res.json(await signedIn(res, user.id, 'password'))
  }),
)

authRouter.post(
  '/logout',
  requireUser,
  requireCsrf,
  route(async (req, res) => {
    await destroySession(req, res)
    res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------------------------
// One-time setup links (new owners, new organisers, password resets issued by an owner/admin).

export async function issueSetupToken(userId: string, ttlHours = 72) {
  const token = newToken()
  await prisma.setupToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } })
  await prisma.setupToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlHours * 3600_000) } })
  return token
}

async function resolveSetup(token: unknown) {
  if (!looksLikeToken(token)) throw new HttpError(404, 'This setup link is not valid or has expired.')
  const row = await prisma.setupToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } })
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.active) throw new HttpError(404, 'This setup link is not valid or has expired.')
  return row
}

authRouter.get(
  '/setup/:token',
  tokenLimiter,
  route(async (req, res) => {
    const row = await resolveSetup(req.params.token)
    res.set('Cache-Control', 'no-store')
    res.json({ email: row.user.email, name: row.user.name })
  }),
)

const setupSchema = z.object({ password: z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`).max(200) })

authRouter.post(
  '/setup/:token',
  tokenLimiter,
  route(async (req, res) => {
    const row = await resolveSetup(req.params.token)
    const body = parseBody(setupSchema, req.body)
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(body.password) } }),
      prisma.setupToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      // A new password signs out every other session.
      prisma.session.deleteMany({ where: { userId: row.userId } }),
    ])
    const { csrfToken } = await createSession(res, row.userId)
    await audit({ actorUserId: row.userId, actorKind: 'user', action: 'auth.password_set', entityType: 'user', entityId: row.userId })
    res.json({
      user: { id: row.user.id, email: row.user.email, name: row.user.name, isPlatformAdmin: row.user.isPlatformAdmin },
      csrfToken,
      memberships: await membershipsOf(row.userId),
    })
  }),
)
