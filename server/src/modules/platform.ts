import { Router } from 'express'
import { z } from 'zod'
import { RESERVED_ORG_SLUGS, slugify } from '../../../shared/slug.js'
import { audit } from '../lib/audit.js'
import { eraseOrganisation } from '../lib/gdpr.js'
import { env } from '../lib/env.js'
import { HttpError, parseBody, route, text, uuidParam } from '../lib/http.js'
import { grantOrganiser, organiserMails, sendQuietly } from '../lib/organisers.js'
import { prisma } from '../lib/prisma.js'
import { hashToken, newToken } from '../lib/tokens.js'
import { requireCsrf, requirePlatformAdmin } from '../middleware/auth.js'
import { issueSetupToken } from './auth.js'

/** Platform operators: approve retreat owners as tenants, suspend them, map custom domains. */
export const platformRouter = Router()
platformRouter.use(requirePlatformAdmin, requireCsrf)

platformRouter.get(
  '/tenant-requests',
  route(async (_req, res) => {
    const rows = await prisma.tenantRequest.findMany({ orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200 })
    res.json({ requests: rows })
  }),
)

const approveSchema = z.object({ slug: z.string().max(48).optional() })

async function availableSlug(wanted: string) {
  const base = slugify(wanted) || 'retreats'
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`
    if (RESERVED_ORG_SLUGS.has(candidate)) continue
    if (!(await prisma.organisation.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate
  }
  throw new HttpError(409, 'Choose a different slug')
}

/**
 * Approving an organiser request: by default creates the organisation named in it, with the person as
 * owner. Alternatively adds them to an existing organisation. They are emailed and simply sign in (email
 * code or Google): no setup link or password is needed.
 */
const approveRequestSchema = approveSchema.extend({
  organisationId: z.uuid().optional(),
  role: z.enum(['owner', 'organiser']).optional(),
})

platformRouter.post(
  '/tenant-requests/:id/approve',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const body = parseBody(approveRequestSchema, req.body)
    const request = await prisma.tenantRequest.findUnique({ where: { id } })
    if (!request) throw new HttpError(404, 'Request not found')
    if (request.status !== 'pending') throw new HttpError(409, 'This request has already been handled')
    if (body.organisationId && !(await prisma.organisation.findUnique({ where: { id: body.organisationId }, select: { id: true } }))) {
      throw new HttpError(404, 'Organisation not found')
    }
    const newSlug = body.organisationId ? undefined : await availableSlug(body.slug || request.orgName)
    const actor = req.auth!.user.id

    const { orgId, user } = await prisma.$transaction(async (tx) => {
      // Legacy anonymous requests have no account yet: create it for their email.
      const user =
        (request.userId && (await tx.user.findUnique({ where: { id: request.userId } }))) ||
        (await tx.user.findUnique({ where: { email: request.email } })) ||
        (await tx.user.create({ data: { email: request.email, name: request.contactName, phone: request.phone } }))
      const orgId = await grantOrganiser(tx, {
        userId: user.id,
        actorUserId: actor,
        actorKind: 'platform',
        details: { orgName: request.orgName, websiteUrl: request.websiteUrl, email: request.email },
        newSlug,
        organisationId: body.organisationId,
        role: body.role,
      })
      await tx.tenantRequest.update({ where: { id }, data: { status: 'approved', reviewedById: actor, reviewedAt: new Date(), organisationId: orgId } })
      await audit({ organisationId: orgId, actorUserId: actor, actorKind: 'platform', action: 'organiser_request.approved', entityType: 'tenant_request', entityId: id }, tx)
      return { orgId, user }
    })
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, slug: true, name: true } })
    sendQuietly(organiserMails.approved(user.email, request.contactName, org.name))
    res.json({ organisation: org, setupUrl: null })
  }),
)

platformRouter.post(
  '/tenant-requests/:id/decline',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    // A reason is required: it goes into the email to the person.
    const body = parseBody(z.object({ reason: text(500).refine((v) => v.length > 0, 'Give a reason for declining'), notify: z.boolean().default(true) }), req.body ?? {})
    const request = await prisma.tenantRequest.findUnique({ where: { id } })
    const updated = await prisma.tenantRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'declined', reviewedById: req.auth!.user.id, reviewedAt: new Date(), declineReason: body.reason || null },
    })
    if (!updated.count || !request) throw new HttpError(409, 'This request has already been handled')
    await audit({ actorUserId: req.auth!.user.id, actorKind: 'platform', action: 'tenant_request.declined', entityType: 'tenant_request', entityId: id })
    if (body.notify) sendQuietly(organiserMails.declined(request.email, request.contactName, body.reason))
    res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------------------------
// Organiser invite links: an admin names an email; that person signs in, adds details and is in.

const INVITE_TTL_DAYS = 14

platformRouter.get(
  '/organiser-invites',
  route(async (_req, res) => {
    const invites = await prisma.organiserInvite.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
    const orgIds = [...new Set(invites.map((i) => i.organisationId).filter((x): x is string => Boolean(x)))]
    const orgRows = await prisma.organisation.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, name: true, memberships: { where: { role: 'owner' }, select: { user: { select: { email: true } } } } },
    })
    // Shown with the owner's email: organisation names can repeat.
    const orgs = new Map(orgRows.map((o) => [o.id, `${o.name} (owner: ${o.memberships[0]?.user.email ?? 'none'})`]))
    const now = new Date()
    res.json({
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        organisationName: i.organisationId ? (orgs.get(i.organisationId) ?? 'Deleted organisation') : null,
        role: i.role,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        state: i.usedAt ? 'accepted' : i.revokedAt ? 'revoked' : i.expiresAt < now ? 'expired' : 'open',
      })),
    })
  }),
)

platformRouter.post(
  '/organiser-invites',
  route(async (req, res) => {
    const body = parseBody(
      z.object({ email: z.email().max(200), organisationId: z.uuid().optional(), role: z.enum(['owner', 'organiser']).default('owner'), sendEmail: z.boolean().default(true) }),
      req.body,
    )
    const email = body.email.toLowerCase()
    const org = body.organisationId ? await prisma.organisation.findUnique({ where: { id: body.organisationId }, select: { id: true, name: true } }) : null
    if (body.organisationId && !org) throw new HttpError(404, 'Organisation not found')
    const token = newToken()
    // A new invite replaces any open one for the same address.
    await prisma.organiserInvite.updateMany({ where: { email, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } })
    const invite = await prisma.organiserInvite.create({
      data: {
        tokenHash: hashToken(token),
        email,
        organisationId: org?.id ?? null,
        role: org ? body.role : 'owner',
        createdById: req.auth!.user.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      },
    })
    await audit({ organisationId: org?.id ?? null, actorUserId: req.auth!.user.id, actorKind: 'platform', action: 'organiser_invite.created', entityType: 'organiser_invite', entityId: invite.id })
    const url = `${env.WEB_ORIGIN}/organiser/invite/${token}`
    if (body.sendEmail) sendQuietly(organiserMails.invite(email, url, org?.name ?? null, INVITE_TTL_DAYS))
    // The link is shown once: only its hash is stored.
    res.status(201).json({ url, emailed: body.sendEmail, expiresAt: invite.expiresAt })
  }),
)

platformRouter.post(
  '/organiser-invites/:id/revoke',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const updated = await prisma.organiserInvite.updateMany({ where: { id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } })
    if (!updated.count) throw new HttpError(409, 'This invitation is no longer open')
    await audit({ actorUserId: req.auth!.user.id, actorKind: 'platform', action: 'organiser_invite.revoked', entityType: 'organiser_invite', entityId: id })
    res.json({ ok: true })
  }),
)

platformRouter.get(
  '/orgs',
  route(async (_req, res) => {
    const orgs = await prisma.organisation.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        domains: true,
        _count: { select: { retreats: true, memberships: true } },
        // Names are not unique: owners' emails tell organisations apart wherever an admin picks one.
        memberships: { where: { role: 'owner' }, select: { user: { select: { email: true } } }, orderBy: { createdAt: 'asc' } },
      },
    })
    res.json({
      orgs: orgs.map((o) => ({
        id: o.id,
        slug: o.slug,
        name: o.name,
        status: o.status,
        createdAt: o.createdAt,
        domains: o.domains.map((d) => ({ id: d.id, hostname: d.hostname })),
        retreatCount: o._count.retreats,
        memberCount: o._count.memberships,
        ownerEmails: o.memberships.map((m) => m.user.email),
      })),
    })
  }),
)

platformRouter.post(
  '/orgs',
  route(async (req, res) => {
    const body = parseBody(z.object({ name: text(120), slug: z.string().max(48).optional(), ownerEmail: z.email(), ownerName: text(120) }), req.body)
    const slug = await availableSlug(body.slug || body.name)
    const email = body.ownerEmail.toLowerCase()
    const { org, user } = await prisma.$transaction(async (tx) => {
      const org = await tx.organisation.create({ data: { slug, name: body.name, contactEmail: email } })
      const user = (await tx.user.findUnique({ where: { email } })) ?? (await tx.user.create({ data: { email, name: body.ownerName } }))
      await tx.membership.create({ data: { userId: user.id, organisationId: org.id, role: 'owner' } })
      await audit({ organisationId: org.id, actorUserId: req.auth!.user.id, actorKind: 'platform', action: 'tenant.created', entityType: 'organisation', entityId: org.id }, tx)
      return { org, user }
    })
    const setupUrl = user.passwordHash ? null : `${env.WEB_ORIGIN}/admin/setup/${await issueSetupToken(user.id)}`
    res.status(201).json({ organisation: { id: org.id, slug: org.slug, name: org.name }, setupUrl })
  }),
)

platformRouter.post(
  '/orgs/:id/status',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const body = parseBody(z.object({ status: z.enum(['active', 'suspended']) }), req.body)
    await prisma.organisation.update({ where: { id }, data: { status: body.status } })
    await audit({ organisationId: id, actorUserId: req.auth!.user.id, actorKind: 'platform', action: `tenant.${body.status}`, entityType: 'organisation', entityId: id })
    res.json({ ok: true })
  }),
)

/**
 * End of service: deletes the organisation, all guest data and files (Art. 28(3)(g)). The owner
 * should be offered their export first. The confirmation must repeat the organisation's slug.
 */
platformRouter.post(
  '/orgs/:id/erase',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const body = parseBody(z.object({ confirmSlug: z.string() }), req.body)
    const org = await prisma.organisation.findUnique({ where: { id }, select: { slug: true } })
    if (!org) throw new HttpError(404, 'Not found')
    if (body.confirmSlug !== org.slug) throw new HttpError(400, 'Type the organisation’s slug exactly to confirm')
    await eraseOrganisation(id, req.auth!.user.id)
    res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------------------------
// People: one sign-in for everyone; what a person sees depends on their account's permissions.
//   admin  → isPlatformAdmin (this console)
//   organiser    → a membership of an organisation (owner or organiser) → the organiser workspace
//   everyone else → a guest, who sees My reviews

async function personView(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { memberships: { include: { organisation: { select: { id: true, slug: true, name: true } } }, orderBy: { createdAt: 'asc' } } },
  })
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isPlatformAdmin: u.isPlatformAdmin,
    active: u.active,
    emailVerified: Boolean(u.emailVerifiedAt),
    signInMethods: { google: Boolean(u.googleSub), password: Boolean(u.passwordHash), emailCode: true },
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    memberships: u.memberships.map((m) => ({ id: m.id, role: m.role, organisation: m.organisation })),
  }
}

platformRouter.get(
  '/users',
  route(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : ''
    const filter = typeof req.query.filter === 'string' ? req.query.filter : 'all'
    const users = await prisma.user.findMany({
      where: {
        ...(q ? { OR: [{ email: { contains: q.toLowerCase() } }, { name: { contains: q, mode: 'insensitive' } }] } : {}),
        ...(filter === 'organisers' ? { memberships: { some: {} } } : filter === 'admins' ? { isPlatformAdmin: true } : {}),
      },
      orderBy: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 100,
      select: { id: true },
    })
    res.json({ users: await Promise.all(users.map((u) => personView(u.id))) })
  }),
)

/** Adds an account by email so it can be given permissions before the person first signs in. */
platformRouter.post(
  '/users',
  route(async (req, res) => {
    const body = parseBody(z.object({ email: z.email().max(200), name: text(120).optional() }), req.body)
    const email = body.email.toLowerCase()
    const existing = await prisma.user.findUnique({ where: { email } })
    const user = existing ?? (await prisma.user.create({ data: { email, name: body.name?.trim() || email.split('@')[0] } }))
    if (!existing) {
      await audit({ actorUserId: req.auth!.user.id, actorKind: 'platform', action: 'user.created', entityType: 'user', entityId: user.id })
    }
    res.status(existing ? 200 : 201).json({ user: await personView(user.id), existed: Boolean(existing) })
  }),
)

platformRouter.patch(
  '/users/:id',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const body = parseBody(z.object({ isPlatformAdmin: z.boolean().optional(), active: z.boolean().optional(), name: text(120).optional() }), req.body)
    const me = req.auth!.user.id
    const target = await prisma.user.findUnique({ where: { id } })
    if (!target) throw new HttpError(404, 'Person not found')
    if (id === me && (body.isPlatformAdmin === false || body.active === false)) {
      throw new HttpError(409, 'You can’t remove your own admin access or disable your own account')
    }
    if (target.isPlatformAdmin && (body.isPlatformAdmin === false || body.active === false)) {
      const admins = await prisma.user.count({ where: { isPlatformAdmin: true, active: true } })
      if (admins <= 1) throw new HttpError(409, 'There must always be at least one active admin')
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id }, data: body }),
      // Disabling an account signs it out everywhere.
      ...(body.active === false ? [prisma.session.deleteMany({ where: { userId: id } })] : []),
    ])
    for (const [field, value] of Object.entries(body)) {
      if (field === 'name') continue
      await audit({ actorUserId: me, actorKind: 'platform', action: `user.${field === 'isPlatformAdmin' ? 'platform_admin' : 'active'}.${value ? 'granted' : 'revoked'}`, entityType: 'user', entityId: id })
    }
    res.json({ user: await personView(id) })
  }),
)

const grantSchema = z.union([
  z.object({ organisationId: z.uuid(), role: z.enum(['owner', 'organiser']) }),
  z.object({ newOrganisationName: text(120).refine((v) => v.length >= 2, 'Enter the organisation’s name'), role: z.literal('owner').default('owner') }),
])

/** Makes someone an organiser (or owner) of an organisation, existing or new. */
platformRouter.post(
  '/users/:id/memberships',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const body = parseBody(grantSchema, req.body)
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) throw new HttpError(404, 'Person not found')
    const actor = req.auth!.user.id
    // Looked up before the transaction: it reads through the shared client, not the transaction's connection.
    const newSlug = 'newOrganisationName' in body ? await availableSlug(body.newOrganisationName) : null
    await prisma.$transaction(async (tx) => {
      let organisationId: string
      if ('organisationId' in body) {
        const org = await tx.organisation.findUnique({ where: { id: body.organisationId } })
        if (!org) throw new HttpError(404, 'Organisation not found')
        organisationId = org.id
      } else {
        const org = await tx.organisation.create({ data: { slug: newSlug!, name: body.newOrganisationName, contactEmail: user.email } })
        organisationId = org.id
        await audit({ organisationId, actorUserId: actor, actorKind: 'platform', action: 'tenant.created', entityType: 'organisation', entityId: organisationId }, tx)
      }
      const existing = await tx.membership.findUnique({ where: { userId_organisationId: { userId: id, organisationId } } })
      if (existing) {
        await tx.membership.update({ where: { id: existing.id }, data: { role: body.role } })
      } else {
        await tx.membership.create({ data: { userId: id, organisationId, role: body.role } })
      }
      await audit({ organisationId, actorUserId: actor, actorKind: 'platform', action: `member.${existing ? 'role_changed' : 'added'}`, entityType: 'user', entityId: id, metadata: { role: body.role } }, tx)
    })
    res.status(201).json({ user: await personView(id) })
  }),
)

platformRouter.delete(
  '/users/:id/memberships/:membershipId',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const membershipId = uuidParam(req, 'membershipId')
    const m = await prisma.membership.findFirst({ where: { id: membershipId, userId: id } })
    if (!m) throw new HttpError(404, 'Membership not found')
    if (m.role === 'owner') {
      const owners = await prisma.membership.count({ where: { organisationId: m.organisationId, role: 'owner' } })
      if (owners <= 1) throw new HttpError(409, 'This is the organisation’s only owner. Make someone else an owner first.')
    }
    await prisma.membership.delete({ where: { id: membershipId } })
    await audit({ organisationId: m.organisationId, actorUserId: req.auth!.user.id, actorKind: 'platform', action: 'member.removed', entityType: 'user', entityId: id })
    res.json({ user: await personView(id) })
  }),
)

const hostnameSchema = z.object({
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, 'Enter a hostname like reviews.example.com'),
})

platformRouter.post(
  '/orgs/:id/domains',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const body = parseBody(hostnameSchema, req.body)
    const exists = await prisma.orgDomain.findUnique({ where: { hostname: body.hostname } })
    if (exists) throw new HttpError(409, 'That hostname is already mapped')
    const domain = await prisma.orgDomain.create({ data: { organisationId: id, hostname: body.hostname } })
    await audit({ organisationId: id, actorUserId: req.auth!.user.id, actorKind: 'platform', action: 'domain.added', entityType: 'organisation', entityId: id, metadata: { hostname: body.hostname } })
    res.status(201).json({ id: domain.id, hostname: domain.hostname })
  }),
)

platformRouter.delete(
  '/orgs/:id/domains/:domainId',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const domainId = uuidParam(req, 'domainId')
    await prisma.orgDomain.deleteMany({ where: { id: domainId, organisationId: id } })
    await audit({ organisationId: id, actorUserId: req.auth!.user.id, actorKind: 'platform', action: 'domain.removed', entityType: 'organisation', entityId: id })
    res.status(204).end()
  }),
)
