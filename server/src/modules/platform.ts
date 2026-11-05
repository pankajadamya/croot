import { Router } from 'express'
import { z } from 'zod'
import { RESERVED_ORG_SLUGS, slugify } from '../../../shared/slug.js'
import { audit } from '../lib/audit.js'
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
        data: { slug, name: request.orgName, contactEmail: request.email, websiteUrl: request.websiteUrl },
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
