import { Router } from 'express'
import { z } from 'zod'
import { PROCESSING_TERMS_VERSION } from '../../../shared/legal.js'
import { RESERVED_ORG_SLUGS, slugify } from '../../../shared/slug.js'
import { audit } from '../lib/audit.js'
import { env } from '../lib/env.js'
import { HttpError, parseBody, route, text } from '../lib/http.js'
import { prisma } from '../lib/prisma.js'
import { requireCsrf, requireUser } from '../middleware/auth.js'

/**
 * Self-service onboarding: a signed-in user creates an organisation and becomes its owner.
 * Unless SIGNUP_AUTO_APPROVE is set, it starts as `pending`: the owner can set everything up, but
 * invitations and public pages stay off (they require an active organisation) until a platform
 * admin approves it.
 */
export const accountRouter = Router()
accountRouter.use(requireUser, requireCsrf)

const MAX_OWNED = 5

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
  websiteUrl: z.url().max(300).optional().or(z.literal('').transform(() => undefined)),
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
