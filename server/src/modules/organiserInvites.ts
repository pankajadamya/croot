import { Router } from 'express'
import { PROCESSING_TERMS_VERSION } from '../../../shared/legal.js'
import { audit } from '../lib/audit.js'
import { HttpError, parseBody, route } from '../lib/http.js'
import { availableOrgSlug, grantOrganiser, organiserDetailsSchema } from '../lib/organisers.js'
import { prisma } from '../lib/prisma.js'
import { hashToken, looksLikeToken } from '../lib/tokens.js'
import { requireCsrf, requireUser } from '../middleware/auth.js'
import { tokenLimiter } from '../middleware/rateLimits.js'

/**
 * Organiser invite links (/organiser/invite/:token). The link names one email address; only someone
 * signed in with that verified address can accept it, so a forwarded link is useless to anyone else.
 * Accepting captures the same details as a request and grants access at once.
 */
export const organiserInvitesRouter = Router()
organiserInvitesRouter.use(tokenLimiter)

const INVALID = 'This invitation link is not valid, has expired or has already been used. Ask the Croot team for a new one.'

async function resolve(token: unknown) {
  if (!looksLikeToken(token)) throw new HttpError(404, INVALID)
  const invite = await prisma.organiserInvite.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt < new Date()) throw new HttpError(404, INVALID)
  const organisation = invite.organisationId
    ? await prisma.organisation.findUnique({ where: { id: invite.organisationId }, select: { id: true, name: true, slug: true } })
    : null
  return { invite, organisation }
}

organiserInvitesRouter.get(
  '/:token',
  route(async (req, res) => {
    const { invite, organisation } = await resolve(req.params.token)
    const signedInAs = req.auth?.user.email ?? null
    res.set('Cache-Control', 'no-store')
    res.json({
      email: invite.email,
      organisation: organisation && { name: organisation.name },
      role: invite.role,
      expiresAt: invite.expiresAt,
      signedInAs,
      matches: Boolean(req.auth?.emailVerified && signedInAs === invite.email),
    })
  }),
)

organiserInvitesRouter.post(
  '/:token/accept',
  requireUser,
  requireCsrf,
  route(async (req, res) => {
    const { invite, organisation } = await resolve(req.params.token)
    const user = req.auth!.user
    if (!req.auth!.emailVerified || user.email !== invite.email) {
      throw new HttpError(403, `This invitation is for ${invite.email}. Sign in with that address to accept it.`)
    }
    const body = parseBody(organiserDetailsSchema, req.body)
    const newSlug = organisation ? undefined : await availableOrgSlug(body.orgName)

    const orgId = await prisma.$transaction(async (tx) => {
      // Single use, race-safe.
      const used = await tx.organiserInvite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: new Date(), usedByUserId: user.id } })
      if (!used.count) throw new HttpError(409, INVALID)
      await tx.user.update({ where: { id: user.id }, data: { name: body.contactName, phone: body.phone || null } })
      const orgId = await grantOrganiser(tx, {
        userId: user.id,
        actorUserId: user.id,
        actorKind: 'user',
        details: { orgName: body.orgName, websiteUrl: body.websiteUrl, email: user.email },
        newSlug,
        organisationId: organisation?.id,
        role: invite.role,
      })
      // The details are kept as an (already approved) request, so admins see every organiser's details in one place.
      const { acceptTerms: _a, ...details } = body
      await tx.tenantRequest.create({
        data: {
          ...details,
          phone: details.phone || null,
          email: user.email,
          userId: user.id,
          source: 'invite',
          status: 'approved',
          reviewedById: invite.createdById,
          reviewedAt: new Date(),
          organisationId: orgId,
          termsVersion: PROCESSING_TERMS_VERSION,
        },
      })
      await audit({ organisationId: orgId, actorUserId: user.id, actorKind: 'user', action: 'organiser_invite.accepted', entityType: 'organiser_invite', entityId: invite.id }, tx)
      return orgId
    })
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: orgId }, select: { slug: true, name: true } })
    res.json({ organisation: org })
  }),
)
