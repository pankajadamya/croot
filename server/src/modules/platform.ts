import { Router } from 'express'
import { z } from 'zod'
import { RESERVED_ORG_SLUGS, slugify } from '../../../shared/slug.js'
import { audit } from '../lib/audit.js'
import { eraseOrganisation } from '../lib/gdpr.js'
import { env } from '../lib/env.js'
import { HttpError, parseBody, route, text, uuidParam } from '../lib/http.js'
import { prisma } from '../lib/prisma.js'
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
 * Approval creates the tenant and its owner, and returns a one-time setup link for the operator to
 * share manually. No password is ever chosen for, or sent to, the owner by the platform.
 */
platformRouter.post(
  '/tenant-requests/:id/approve',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const body = parseBody(approveSchema, req.body)
    const request = await prisma.tenantRequest.findUnique({ where: { id } })
    if (!request) throw new HttpError(404, 'Request not found')
    if (request.status !== 'pending') throw new HttpError(409, 'This request has already been handled')
    const slug = await availableSlug(body.slug || request.orgName)
    const actor = req.auth!.user.id

    const { org, user } = await prisma.$transaction(async (tx) => {
      const org = await tx.organisation.create({
        // The requester's acknowledgement of the processing terms carries over; the owner confirms it again in their workspace.
        data: { slug, name: request.orgName, contactEmail: request.email, websiteUrl: request.websiteUrl, dpaVersion: request.termsVersion, dpaAcceptedAt: request.termsVersion ? request.createdAt : null },
      })
      const user =
        (await tx.user.findUnique({ where: { email: request.email } })) ??
        (await tx.user.create({ data: { email: request.email, name: request.contactName } }))
      await tx.membership.create({ data: { userId: user.id, organisationId: org.id, role: 'owner' } })
      await tx.tenantRequest.update({ where: { id }, data: { status: 'approved', reviewedById: actor, reviewedAt: new Date(), organisationId: org.id } })
      await audit({ organisationId: org.id, actorUserId: actor, actorKind: 'platform', action: 'tenant.approved', entityType: 'organisation', entityId: org.id }, tx)
      return { org, user }
    })
    const needsSetup = !user.passwordHash
    const setupUrl = needsSetup ? `${env.WEB_ORIGIN}/admin/setup/${await issueSetupToken(user.id)}` : null
    res.json({ organisation: { id: org.id, slug: org.slug, name: org.name }, setupUrl })
  }),
)

platformRouter.post(
  '/tenant-requests/:id/decline',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const updated = await prisma.tenantRequest.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'declined', reviewedById: req.auth!.user.id, reviewedAt: new Date() },
    })
    if (!updated.count) throw new HttpError(409, 'This request has already been handled')
    await audit({ actorUserId: req.auth!.user.id, actorKind: 'platform', action: 'tenant_request.declined', entityType: 'tenant_request', entityId: id })
    res.json({ ok: true })
  }),
)

platformRouter.get(
  '/orgs',
  route(async (_req, res) => {
    const orgs = await prisma.organisation.findMany({
      orderBy: { createdAt: 'desc' },
      include: { domains: true, _count: { select: { retreats: true, memberships: true } } },
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
