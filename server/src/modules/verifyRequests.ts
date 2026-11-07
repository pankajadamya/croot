import { Router } from 'express'
import { audit } from '../lib/audit.js'
import { sendOrgMail, suppressedAmong } from '../lib/emailGuard.js'
import { HttpError, route, uuidParam } from '../lib/http.js'
import { verificationRequestEmail } from '../lib/mailer.js'
import { prisma } from '../lib/prisma.js'
import { tenantResponse } from '../lib/tenant.js'
import { hashToken, looksLikeToken, newToken } from '../lib/tokens.js'
import { emailHash, emailProven } from '../lib/verification.js'
import { tenantOf } from '../middleware/auth.js'
import { tokenLimiter } from '../middleware/rateLimits.js'
import { firstName } from '../../../shared/slug.js'
import { siteOrigin } from './admin/attendees.js'

/**
 * Point 5: an organiser asks Croot to email an unverified guest a one-click "confirm it's yours" link.
 * At most MAX_REQUESTS per review, never to an address that bounced or complained, counted against the
 * organisation's daily email limit. The link verifies only that one review, only while the guest still
 * has the address it went to, and only by a click on the page (a GET never confirms: email scanners
 * open links on their own).
 */
const MAX_REQUESTS = 2
const LINK_DAYS = 14

export const verifyRequestAdminRouter = Router({ mergeParams: true })

verifyRequestAdminRouter.post(
  '/responses/:responseId/request-verification',
  route(async (req, res) => {
    const t = tenantOf(req)
    const response = await tenantResponse(t.org.id, uuidParam(req, 'responseId'))
    const r = await prisma.response.findUniqueOrThrow({
      where: { id: response.id },
      select: {
        id: true,
        submittedAt: true,
        verifiedAt: true,
        verifyRequestsSent: true,
        attendee: { select: { name: true, email: true } },
        retreat: { select: { title: true, organiserName: true } },
      },
    })
    if (!r.submittedAt) throw new HttpError(409, 'This guest hasn’t sent their review yet.')
    if (r.verifiedAt) throw new HttpError(409, 'This review is already verified.')
    if (!r.attendee.email) throw new HttpError(400, `There’s no email address for ${r.attendee.name}. Add one on the Invitations tab first.`)
    if (r.verifyRequestsSent >= MAX_REQUESTS) throw new HttpError(429, `You’ve already asked ${r.attendee.name} twice. Croot won’t email them about it again.`)
    if ((await suppressedAmong([r.attendee.email])).size) throw new HttpError(409, 'Email isn’t reaching this address. Correct it on the Invitations tab first.')

    const token = newToken()
    await prisma.verificationRequest.create({
      data: { responseId: r.id, tokenHash: hashToken(token), emailHash: emailHash(r.attendee.email), expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000) },
    })
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: t.org.id }, select: { name: true, legalName: true, legalAddress: true } })
    await sendOrgMail(
      t.org.id,
      verificationRequestEmail({
        to: r.attendee.email,
        firstName: firstName(r.attendee.name),
        retreatTitle: r.retreat.title,
        from: r.retreat.organiserName || org.name,
        url: `${await siteOrigin(t.org.id)}/verify/${token}`,
        controller: org.legalName ? [org.legalName, org.legalAddress].filter(Boolean).join(', ') : org.name,
      }),
    )
    const updated = await prisma.response.update({ where: { id: r.id }, data: { verifyRequestsSent: { increment: 1 } }, select: { verifyRequestsSent: true } })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'response.verification_requested', entityType: 'response', entityId: r.id })
    res.json({ sent: true, remaining: MAX_REQUESTS - updated.verifyRequestsSent })
  }),
)

export const verifyRequestRouter = Router()

async function openRequest(token: string) {
  if (!looksLikeToken(token)) throw new HttpError(404, 'This link isn’t valid.')
  const vr = await prisma.verificationRequest.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { response: { select: { id: true, verifiedAt: true, attendee: { select: { id: true, name: true, email: true } }, retreat: { select: { title: true } } } } },
  })
  if (!vr || vr.expiresAt < new Date()) throw new HttpError(404, 'This link has expired. Ask the organiser to send a new one.')
  return vr
}

/** What the confirm page shows. Opening it changes nothing. */
verifyRequestRouter.get(
  '/:token',
  tokenLimiter,
  route(async (req, res) => {
    const vr = await openRequest(String(req.params.token))
    res.json({ firstName: firstName(vr.response.attendee.name), retreatTitle: vr.response.retreat.title, verified: Boolean(vr.response.verifiedAt) })
  }),
)

verifyRequestRouter.post(
  '/:token',
  tokenLimiter,
  route(async (req, res) => {
    const vr = await openRequest(String(req.params.token))
    const email = vr.response.attendee.email
    // Only while the guest still has the address the email went to.
    if (!email || emailHash(email) !== vr.emailHash) throw new HttpError(409, 'This link is for an email address that has since changed. Ask the organiser to send a new one.')
    if (!vr.usedAt) {
      await prisma.verificationRequest.update({ where: { id: vr.id }, data: { usedAt: new Date() } })
      await emailProven(vr.response.attendee.id, 'organiser_request')
    }
    res.json({ verified: true })
  }),
)

