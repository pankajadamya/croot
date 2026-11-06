import { Router } from 'express'
import { z } from 'zod'
import { PROCESSING_TERMS_VERSION } from '../../../shared/legal.js'
import { RESERVED_ORG_SLUGS, slugify } from '../../../shared/slug.js'
import { audit } from '../lib/audit.js'
import { env } from '../lib/env.js'
import { HttpError, parseBody, route, text } from '../lib/http.js'
import { prisma } from '../lib/prisma.js'
import { requireCsrf, requireUser, SESSION_COOKIE } from '../middleware/auth.js'
import { publicFormLimiter } from '../middleware/rateLimits.js'
import { notifyAdmins, organiserDetailsSchema } from '../lib/organisers.js'

/**
 * Self-service onboarding: a signed-in user creates an organisation and becomes its owner.
 * Unless SIGNUP_AUTO_APPROVE is set, it starts as `pending`: the owner can set everything up, but
 * invitations and public pages stay off (they require an active organisation) until a platform
 * admin approves it.
 */
export const accountRouter = Router()
accountRouter.use(requireUser, requireCsrf)

const MAX_OWNED = 5

// ---------------------------------------------------------------------------------------------
// "Become an organiser": a signed-in person sends their details; an admin approves or declines.

function requestView(r: Awaited<ReturnType<typeof prisma.tenantRequest.findFirst>>) {
  return (
    r && {
      id: r.id,
      status: r.status,
      orgName: r.orgName,
      contactName: r.contactName,
      phone: r.phone,
      country: r.country,
      websiteUrl: r.websiteUrl,
      reviewKinds: r.reviewKinds,
      volume: r.volume,
      message: r.message,
      declineReason: r.declineReason,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt,
    }
  )
}

accountRouter.get(
  '/organiser-request',
  route(async (req, res) => {
    const latest = await prisma.tenantRequest.findFirst({ where: { userId: req.auth!.user.id, source: 'request' }, orderBy: { createdAt: 'desc' } })
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.user.id }, select: { name: true, phone: true } })
    res.json({ request: requestView(latest), prefill: { contactName: me.name, phone: me.phone ?? '' } })
  }),
)

accountRouter.post(
  '/organiser-request',
  publicFormLimiter,
  route(async (req, res) => {
    const user = req.auth!.user
    if (!req.auth!.emailVerified) throw new HttpError(403, 'Sign in with an email code or Google first, so we know this address is yours')
    const body = parseBody(organiserDetailsSchema, req.body)
    if (await prisma.membership.count({ where: { userId: user.id } })) throw new HttpError(409, 'You’re already an organiser')
    if (await prisma.tenantRequest.count({ where: { userId: user.id, status: 'pending' } })) {
      throw new HttpError(409, 'Your request is already with the Croot team')
    }
    const { acceptTerms: _a, contactName, phone, ...rest } = body
    const created = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { name: contactName, phone: phone || null } })
      const r = await tx.tenantRequest.create({
        data: { ...rest, contactName, phone: phone || null, email: user.email, userId: user.id, source: 'request', termsVersion: PROCESSING_TERMS_VERSION },
      })
      await audit({ actorUserId: user.id, actorKind: 'user', action: 'organiser_request.created', entityType: 'tenant_request', entityId: r.id }, tx)
      return r
    })
    await notifyAdmins(contactName, created.orgName)
    res.status(201).json({ request: requestView(created) })
  }),
)

async function availableSlug(wanted: string) {
  const base = slugify(wanted) || 'retreats'
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    if (RESERVED_ORG_SLUGS.has(candidate)) continue
    if (!(await prisma.organisation.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate
  }
  throw new HttpError(409, 'Choose a different name')
}

const createSchema = z.object({
  name: text(120).refine((v) => v.length >= 2, 'Enter your organisation’s name'),
  websiteUrl: z.url({ protocol: /^https?$/ }).max(300).optional().or(z.literal('').transform(() => undefined)),
  acceptTerms: z.literal(true, { error: 'Please accept the data processing terms' }),
})

accountRouter.post(
  '/organisations',
  route(async (req, res) => {
    if (!env.ORG_SIGNUP_ENABLED) throw new HttpError(403, 'New organisations can’t be created at the moment')
    const user = req.auth!.user
    const body = parseBody(createSchema, req.body)
    const owned = await prisma.membership.findMany({ where: { userId: user.id, role: 'owner' }, include: { organisation: { select: { status: true } } } })
    if (owned.length >= MAX_OWNED) throw new HttpError(409, `You can own up to ${MAX_OWNED} organisations`)
    if (owned.some((m) => m.organisation.status === 'pending')) throw new HttpError(409, 'You already have an organisation awaiting approval')

    const slug = await availableSlug(body.name)
    const status = env.SIGNUP_AUTO_APPROVE ? 'active' : 'pending'
    const org = await prisma.$transaction(async (tx) => {
      const org = await tx.organisation.create({
        data: { slug, name: body.name, status, contactEmail: user.email, websiteUrl: body.websiteUrl, dpaVersion: PROCESSING_TERMS_VERSION, dpaAcceptedAt: new Date() },
      })
      await tx.membership.create({ data: { userId: user.id, organisationId: org.id, role: 'owner' } })
      await audit({ organisationId: org.id, actorUserId: user.id, actorKind: 'user', action: 'organisation.signed_up', entityType: 'organisation', entityId: org.id, metadata: { status, termsVersion: PROCESSING_TERMS_VERSION } }, tx)
      return org
    })
    res.status(201).json({ organisation: { slug: org.slug, name: org.name, status: org.status } })
  }),
)

// ---------------------------------------------------------------------------------------------
// Delete my account. Removes the person's sign-in identity: their account, sessions, codes and team
// memberships. Reviews they wrote as a guest belong to the organiser who invited them (the
// controller), so they stay; the guest withdraws or erases those from their private response page.

accountRouter.delete(
  '/',
  route(async (req, res) => {
    const me = req.auth!.user
    const body = parseBody(z.object({ confirmEmail: z.string().max(200) }), req.body)
    if (body.confirmEmail.trim().toLowerCase() !== me.email) throw new HttpError(400, 'Type your email address exactly to confirm', { confirmEmail: ['Doesn’t match your email address'] })
    if (me.isPlatformAdmin) throw new HttpError(409, 'Admin accounts can’t be deleted here. Ask another admin to remove you from the admin list first.')
    // Never leave an organisation without an owner.
    const owned = await prisma.membership.findMany({ where: { userId: me.id, role: 'owner' }, include: { organisation: { select: { name: true } } } })
    for (const m of owned) {
      const owners = await prisma.membership.count({ where: { organisationId: m.organisationId, role: 'owner' } })
      if (owners <= 1) {
        throw new HttpError(409, `You’re the only owner of ${m.organisation.name}. Make someone else an owner, or ask us to close the organisation, before deleting your account.`)
      }
    }
    await prisma.$transaction([
      prisma.loginCode.deleteMany({ where: { email: me.email } }),
      prisma.tenantRequest.updateMany({ where: { userId: me.id }, data: { userId: null } }),
      // Memberships, sessions and setup links go with the account (cascade).
      prisma.user.delete({ where: { id: me.id } }),
    ])
    await audit({ actorKind: 'user', action: 'account.deleted', entityType: 'user', entityId: me.id })
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    res.json({ ok: true })
  }),
)
