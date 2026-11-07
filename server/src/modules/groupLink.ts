import { createHmac, randomInt } from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { audit } from '../lib/audit.js'
import { normaliseEmail, sendOrgMail } from '../lib/emailGuard.js'
import { authSecret, env } from '../lib/env.js'
import { HttpError, parseBody, route, text, uuidParam } from '../lib/http.js'
import { issueInvitation } from '../lib/invites.js'
import { groupJoinCodeEmail, groupLinkWarningEmail, sendMail } from '../lib/mailer.js'
import { prisma } from '../lib/prisma.js'
import { tenantAttendee, tenantRetreat } from '../lib/tenant.js'
import { hashToken, looksLikeToken, newToken, safeEqual } from '../lib/tokens.js'
import { maskEmail } from '../lib/verification.js'
import { tenantOf } from '../middleware/auth.js'
import { loginLimiter, tokenLimiter } from '../middleware/rateLimits.js'
import { siteOrigin } from './admin/attendees.js'
import { signedIn } from './auth.js'

/**
 * The group link (point 4): one link an organiser can share with the whole group. It never lets
 * anyone write straight away. The person gives their name and email, proves the email with a code,
 * and only then gets their own personal review link (signed in, so the review is "Verified email").
 *
 * Safeguards, because anyone the link reaches can use it:
 *   - an email code is required; one review per email per retreat (the same person gets their own
 *     review back, not a second one);
 *   - someone not on the guest list is added as "joined by group link", and their review can't be
 *     published until the organiser confirms they were a guest;
 *   - codes are rate-limited per address and per retreat, and the codes count against the
 *     organisation's daily email limit;
 *   - the link expires (the retreat's link lifetime) and can be stopped at any time;
 *   - making one emails the organisation's owners that reviews must be genuine, and that
 *     organisations found posting reviews that aren't can be suspended or removed.
 */
const CODES_PER_ADDRESS_PER_HOUR = 5
const CODES_PER_RETREAT_PER_DAY = 200
const MAX_ATTEMPTS = 5

const hmac = (retreatId: string, email: string, code: string) => createHmac('sha256', authSecret).update(`group:${retreatId}:${email}:${code}`).digest('hex')

// ---------------------------------------------------------------------------------------------
// Organiser side (mounted under /api/admin/orgs/:orgSlug)

export const groupLinkAdminRouter = Router({ mergeParams: true })

groupLinkAdminRouter.get(
  '/retreats/:retreatId/group-link',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const active = Boolean(retreat.groupLinkTokenHash && retreat.groupLinkExpiresAt && retreat.groupLinkExpiresAt > new Date())
    const joined = await prisma.attendee.count({ where: { retreatId: retreat.id, source: 'group_link' } })
    res.json({ active, createdAt: active ? retreat.groupLinkCreatedAt : null, expiresAt: active ? retreat.groupLinkExpiresAt : null, joined })
  }),
)

/** Makes (or replaces) the group link. The organiser must acknowledge the rules; the owners are emailed. */
groupLinkAdminRouter.post(
  '/retreats/:retreatId/group-link',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    parseBody(z.object({ acknowledge: z.literal(true, { error: 'Confirm you’ll share it only with people who were there' }) }), req.body)
    if (retreat.status !== 'collecting') throw new HttpError(409, 'Start collecting reviews first, so the link works.')
    const token = newToken()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + retreat.inviteTtlDays * 86_400_000)
    await prisma.retreat.update({ where: { id: retreat.id }, data: { groupLinkTokenHash: hashToken(token), groupLinkCreatedAt: now, groupLinkExpiresAt: expiresAt } })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'group_link.created', entityType: 'retreat', entityId: retreat.id })

    // Every owner (and whoever made it) hears about it, with the rules in writing.
    const origin = await siteOrigin(t.org.id)
    const [owners, creator] = await Promise.all([
      prisma.membership.findMany({ where: { organisationId: t.org.id, role: 'owner' }, select: { user: { select: { email: true } } } }),
      prisma.user.findUniqueOrThrow({ where: { id: t.userId }, select: { email: true, name: true } }),
    ])
    const to = new Set([...owners.map((o) => o.user.email), creator.email])
    for (const email of to) {
      await sendMail(
        groupLinkWarningEmail({
          to: email,
          orgName: t.org.name,
          retreatTitle: retreat.title,
          createdBy: creator.name || creator.email,
          expiresAt,
          manageUrl: `${env.WEB_ORIGIN}/admin/${t.org.slug}/retreats/${retreat.id}/invitations`,
        }),
      ).catch((e) => console.error('group link warning email failed:', (e as Error).message))
    }
    res.json({ url: `${origin}/join/${token}`, expiresAt })
  }),
)

groupLinkAdminRouter.delete(
  '/retreats/:retreatId/group-link',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    await prisma.retreat.update({ where: { id: retreat.id }, data: { groupLinkTokenHash: null, groupLinkExpiresAt: null } })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'group_link.stopped', entityType: 'retreat', entityId: retreat.id })
    res.status(204).end()
  }),
)

/** Someone who joined by the group link was really a guest: their review may now be published. */
groupLinkAdminRouter.post(
  '/attendees/:attendeeId/confirm-guest',
  route(async (req, res) => {
    const t = tenantOf(req)
    const attendee = await tenantAttendee(t.org.id, uuidParam(req, 'attendeeId'))
    if (attendee.source === 'group_link' && !attendee.guestListConfirmedAt) {
      await prisma.attendee.update({ where: { id: attendee.id }, data: { guestListConfirmedAt: new Date() } })
      await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'attendee.confirmed_guest', entityType: 'attendee', entityId: attendee.id })
    }
    res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------------------------
// Public side (/api/group/:token)

export const groupLinkRouter = Router()

async function openGroupLink(token: string) {
  if (!looksLikeToken(token)) throw new HttpError(404, 'This link isn’t valid.')
  const retreat = await prisma.retreat.findUnique({
    where: { groupLinkTokenHash: hashToken(token) },
    include: { organisation: { select: { id: true, name: true, slug: true, status: true } } },
  })
  if (!retreat || !retreat.groupLinkExpiresAt || retreat.groupLinkExpiresAt < new Date() || retreat.organisation.status !== 'active') {
    throw new HttpError(404, 'This link has expired or been stopped. Ask the organiser for your own link.')
  }
  if (retreat.status !== 'collecting') throw new HttpError(409, 'Reviews for this retreat aren’t being collected at the moment.')
  return retreat
}

groupLinkRouter.get(
  '/:token',
  tokenLimiter,
  route(async (req, res) => {
    const retreat = await openGroupLink(String(req.params.token))
    res.json({
      retreatTitle: retreat.title,
      organiser: retreat.organiserName || retreat.organisation.name,
      kind: retreat.kind,
      privacyNoticePath: `/o/${retreat.organisation.slug}/privacy?programme=${retreat.slug}`,
    })
  }),
)

const startSchema = z.object({ name: text(120).refine((v) => v.length > 0, 'Required'), email: z.email().max(200) })

/** Step 1: name and email. Emails a code; always answers the same way (never says who's on the list). */
groupLinkRouter.post(
  '/:token/start',
  loginLimiter,
  route(async (req, res) => {
    const retreat = await openGroupLink(String(req.params.token))
    const body = parseBody(startSchema, req.body)
    const email = normaliseEmail(body.email)
    const hourAgo = new Date(Date.now() - 3600_000)
    const [forAddress, forRetreat] = await Promise.all([
      prisma.groupJoinCode.count({ where: { retreatId: retreat.id, email, createdAt: { gt: hourAgo } } }),
      prisma.groupJoinCode.count({ where: { retreatId: retreat.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } } }),
    ])
    if (forRetreat >= CODES_PER_RETREAT_PER_DAY) throw new HttpError(429, 'Too many people are joining right now. Please try again tomorrow, or ask the organiser for your own link.')
    if (forAddress < CODES_PER_ADDRESS_PER_HOUR) {
      await prisma.groupJoinCode.updateMany({ where: { retreatId: retreat.id, email, consumedAt: null }, data: { consumedAt: new Date() } })
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
      await prisma.groupJoinCode.create({
        data: { retreatId: retreat.id, email, name: body.name, codeHash: hmac(retreat.id, email, code), expiresAt: new Date(Date.now() + env.LOGIN_CODE_TTL_MINUTES * 60_000) },
      })
      await sendOrgMail(retreat.organisation.id, groupJoinCodeEmail(email, code, retreat.title, env.LOGIN_CODE_TTL_MINUTES))
    }
    res.json({ sentTo: maskEmail(email) })
  }),
)

/**
 * Step 2: the code. The person becomes a guest (or is matched to their place on the guest list), is
 * signed in with their now-proven address, and gets their own personal review link.
 */
groupLinkRouter.post(
  '/:token/confirm',
  loginLimiter,
  route(async (req, res) => {
    const retreat = await openGroupLink(String(req.params.token))
    const body = parseBody(z.object({ email: z.email().max(200), code: z.string().trim().max(12) }), req.body)
    const email = normaliseEmail(body.email)
    const code = body.code.replace(/\s+/g, '')
    const invalid = new HttpError(401, 'That code is not valid or has expired. Request a new one.')
    const row = await prisma.groupJoinCode.findFirst({ where: { retreatId: retreat.id, email, consumedAt: null }, orderBy: { createdAt: 'desc' } })
    if (!row || row.expiresAt < new Date() || row.attempts >= MAX_ATTEMPTS) throw invalid
    const claimed = await prisma.groupJoinCode.updateMany({ where: { id: row.id, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } })
    if (!claimed.count || !/^\d{6}$/.test(code) || !safeEqual(hmac(retreat.id, email, code), row.codeHash)) throw invalid
    const consumed = await prisma.groupJoinCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } })
    if (!consumed.count) throw invalid

    // One review per email per retreat: someone already on the list gets their own place back.
    const attendee =
      (await prisma.attendee.findUnique({ where: { retreatId_email: { retreatId: retreat.id, email } } })) ??
      (await prisma.attendee.create({ data: { organisationId: retreat.organisationId, retreatId: retreat.id, name: row.name, email, source: 'group_link' } }))
    const { token } = await prisma.$transaction((tx) => issueInvitation(tx, { organisationId: retreat.organisationId, attendeeId: attendee.id, ttlDays: retreat.inviteTtlDays }))
    await audit({ organisationId: retreat.organisationId, actorKind: 'attendee', action: 'group_link.joined', entityType: 'attendee', entityId: attendee.id })

    // Signed in with the proven address (the same as an email code sign-in), which also marks it proven.
    const user =
      (await prisma.user.findUnique({ where: { email } })) ?? (await prisma.user.create({ data: { email, name: row.name, emailVerifiedAt: new Date() } }))
    if (!user.active) throw new HttpError(403, 'This account is not active.')
    if (!user.emailVerifiedAt) await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } })
    const session = await signedIn(res, user.id, 'code', false)
    res.json({ ...session, reviewPath: `/invite/${token}?via=group` })
  }),
)
