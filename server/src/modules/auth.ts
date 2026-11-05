import { Router } from 'express'
import { z } from 'zod'
import { audit } from '../lib/audit.js'
import { HttpError, parseBody, route } from '../lib/http.js'
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from '../lib/password.js'
import { prisma } from '../lib/prisma.js'
import { hashToken, looksLikeToken, newToken } from '../lib/tokens.js'
import { createSession, destroySession, requireCsrf, requireUser } from '../middleware/auth.js'
import { loginLimiter, tokenLimiter } from '../middleware/rateLimits.js'

export const authRouter = Router()

async function membershipsOf(userId: string) {
  const rows = await prisma.membership.findMany({
    where: { userId },
    include: { organisation: { select: { slug: true, name: true, status: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((m) => ({ slug: m.organisation.slug, name: m.organisation.name, status: m.organisation.status, role: m.role }))
}

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
    const { csrfToken } = await createSession(res, user.id)
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await audit({ actorUserId: user.id, actorKind: 'user', action: 'auth.login', entityType: 'user', entityId: user.id })
    res.json({
      user: { id: user.id, email: user.email, name: user.name, isPlatformAdmin: user.isPlatformAdmin },
      csrfToken,
      memberships: await membershipsOf(user.id),
    })
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
