import type { NextFunction, Request, Response } from 'express'
import type { MemberRole, Organisation, User } from '@prisma/client'
import { audit } from '../lib/audit.js'
import { env, isProduction } from '../lib/env.js'
import { redactPath } from '../lib/logger.js'
import { HttpError } from '../lib/http.js'
import { prisma } from '../lib/prisma.js'
import { hashToken, newToken, safeEqual } from '../lib/tokens.js'

export const SESSION_COOKIE = isProduction ? '__Host-croot_session' : 'croot_session'

export interface AuthContext {
  user: Pick<User, 'id' | 'email' | 'name' | 'isPlatformAdmin'>
  sessionId: string
  csrfToken: string
}

export interface TenantContext {
  org: Pick<Organisation, 'id' | 'slug' | 'name' | 'status'>
  role: MemberRole | 'platform'
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext
      tenant?: TenantContext
    }
  }
}

const SESSION_TOUCH_MS = 5 * 60 * 1000

export async function createSession(res: Response, userId: string) {
  const token = newToken()
  const csrfToken = newToken(24)
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000)
  await prisma.session.create({ data: { tokenHash: hashToken(token), userId, csrfToken, expiresAt } })
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  })
  return { csrfToken }
}

export async function destroySession(req: Request, res: Response) {
  if (req.auth) await prisma.session.deleteMany({ where: { id: req.auth.sessionId } })
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

/** Loads the session if present. Never throws: routes decide whether auth is required. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (typeof token !== 'string' || !token) return next()
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, email: true, name: true, isPlatformAdmin: true, active: true } } },
  })
  if (!session || session.expiresAt < new Date() || !session.user.active) return next()
  // Sliding expiry, written at most every few minutes to keep reads cheap.
  if (Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3600_000) },
    })
  }
  const { active: _active, ...user } = session.user
  req.auth = { user, sessionId: session.id, csrfToken: session.csrfToken }
  next()
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new HttpError(401, 'Please sign in'))
  next()
}

export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new HttpError(401, 'Please sign in'))
  if (!req.auth.user.isPlatformAdmin) return next(new HttpError(403, 'Platform administrators only'))
  next()
}

/**
 * CSRF for cookie-authenticated, state-changing requests: the session's CSRF token must be echoed
 * in a header (which a cross-site form cannot set), on top of SameSite=Lax cookies.
 */
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const header = req.get('x-csrf-token')
  if (!req.auth || !header || !safeEqual(header, req.auth.csrfToken)) {
    return next(new HttpError(403, 'Your session has expired. Please refresh the page.'))
  }
  next()
}

/**
 * Resolves `:orgSlug` to an organisation the signed-in user belongs to. Every admin query below
 * this middleware filters by `req.tenant.org.id`, which is the tenant isolation boundary.
 * Platform admins can enter any tenant for support, and that access is audited by the caller.
 */
export async function requireOrgMember(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(new HttpError(401, 'Please sign in'))
  const slug = req.params.orgSlug
  if (typeof slug !== 'string') return next(new HttpError(404, 'Not found'))
  const org = await prisma.organisation.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, status: true },
  })
  if (!org) return next(new HttpError(404, 'Not found'))
  const membership = await prisma.membership.findUnique({
    where: { userId_organisationId: { userId: req.auth.user.id, organisationId: org.id } },
  })
  if (!membership && !req.auth.user.isPlatformAdmin) return next(new HttpError(404, 'Not found'))
  if (org.status === 'suspended' && !req.auth.user.isPlatformAdmin) {
    return next(new HttpError(403, 'This organisation is suspended'))
  }
  req.tenant = { org, role: membership?.role ?? 'platform' }
  if (!membership) {
    // Processor access to a controller's data is always recorded (GDPR Art. 28(3)(h) accountability).
    await audit({
      organisationId: org.id,
      actorUserId: req.auth.user.id,
      actorKind: 'platform',
      action: 'platform.tenant_access',
      entityType: 'organisation',
      entityId: org.id,
      metadata: { method: req.method, path: redactPath(req.originalUrl) },
    })
  }
  next()
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (req.tenant?.role !== 'owner' && req.tenant?.role !== 'platform') {
    return next(new HttpError(403, 'Only organisation owners can do this'))
  }
  next()
}

export function tenantOf(req: Request): TenantContext & { userId: string } {
  if (!req.tenant || !req.auth) throw new HttpError(401, 'Please sign in')
  return { ...req.tenant, userId: req.auth.user.id }
}
