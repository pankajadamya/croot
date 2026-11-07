import { Router } from 'express'
import { z } from 'zod'
import { audit } from '../lib/audit.js'
import { env } from '../lib/env.js'
import { HttpError, parseBody, route, text, uuidParam } from '../lib/http.js'
import { issueInvitation } from '../lib/invites.js'
import { groupLinkWarningEmail, sendMail } from '../lib/mailer.js'
import { prisma } from '../lib/prisma.js'
import { tenantAttendee, tenantRetreat } from '../lib/tenant.js'
import { hashToken, looksLikeToken, newToken } from '../lib/tokens.js'
import { tenantOf } from '../middleware/auth.js'
import { groupJoinLimiter, linkGuessLimiter, tokenLimiter } from '../middleware/rateLimits.js'
import { siteOrigin } from './admin/attendees.js'

/**
 * The group link: one link an organiser can share with the whole group. Joining asks only for a name,
 * so people get to writing straight away; like every guest, they're asked on the thank-you page to
 * confirm an email (optional), which makes the review "Verified email" and lets them manage it later.
 *
 * Safeguards, because anyone the link reaches can use it:
 *   - at most MAX_JOINS people per link, and it lasts as long as the organiser chose (1 hour to 7 days); after that it explains itself and
 *     points to the organiser for a new one. It can be stopped at any time; a new one replaces it;
 *   - someone who joins is "Joined by group link", and their review can't be published until the
 *     organiser confirms they were a guest;
 *   - joining is rate-limited per device, and a device that already joined is taken back to its own
 *     review (the page remembers it) rather than adding someone new;
 *   - making one needs the organiser to acknowledge that reviews must be genuine, and emails the
 *     owners the same, including that organisations posting reviews that aren't can be suspended.
 */
export const MAX_JOINS = 20
/** How long a group link lasts: the organiser chooses, from 1 hour to 7 days (the default). */
export const MAX_LINK_HOURS = 7 * 24

// ---------------------------------------------------------------------------------------------
// Organiser side (mounted under /api/admin/orgs/:orgSlug)

export const groupLinkAdminRouter = Router({ mergeParams: true })

/** People who joined through the link that's live now (an older, replaced link's joiners don't count). */
const joinsOn = (retreat: { id: string; groupLinkCreatedAt: Date | null }) =>
  retreat.groupLinkCreatedAt ? prisma.attendee.count({ where: { retreatId: retreat.id, source: 'group_link', createdAt: { gte: retreat.groupLinkCreatedAt } } }) : Promise.resolve(0)

groupLinkAdminRouter.get(
  '/retreats/:retreatId/group-link',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const active = Boolean(retreat.groupLinkTokenHash && retreat.groupLinkExpiresAt && retreat.groupLinkExpiresAt > new Date())
    const joined = await prisma.attendee.count({ where: { retreatId: retreat.id, source: 'group_link' } })
    res.json({
      active,
      createdAt: active ? retreat.groupLinkCreatedAt : null,
      expiresAt: active ? retreat.groupLinkExpiresAt : null,
      joinedOnLink: active ? await joinsOn(retreat) : 0,
      maxJoins: MAX_JOINS,
      joined,
    })
  }),
)

/** Makes (or replaces) the group link. The organiser must acknowledge the rules; the owners are emailed. */
groupLinkAdminRouter.post(
  '/retreats/:retreatId/group-link',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const body = parseBody(
      z.object({
        acknowledge: z.literal(true, { error: 'Confirm you’ll share it only with people who were there' }),
        hours: z.number().int().min(1).max(MAX_LINK_HOURS).default(MAX_LINK_HOURS),
      }),
      req.body,
    )
    if (retreat.status !== 'collecting') throw new HttpError(409, 'Start collecting reviews first, so the link works.')
    const token = newToken()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + body.hours * 3_600_000)
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
          maxJoins: MAX_JOINS,
          manageUrl: `${env.WEB_ORIGIN}/admin/${t.org.slug}/retreats/${retreat.id}/invitations`,
        }),
      ).catch((e) => console.error('group link warning email failed:', (e as Error).message))
    }
    res.json({ url: `${origin}/join/${token}`, expiresAt, maxJoins: MAX_JOINS })
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
  const gone = new HttpError(404, 'This link is no longer valid. Please contact the organiser for a new link.')
  if (!looksLikeToken(token)) throw gone
  const retreat = await prisma.retreat.findUnique({
    where: { groupLinkTokenHash: hashToken(token) },
    include: { organisation: { select: { id: true, name: true, slug: true, status: true } } },
  })
  if (!retreat || retreat.organisation.status !== 'active') throw gone
  const organiser = retreat.organiserName || retreat.organisation.name
  const contact = retreat.contactEmail ? ` at ${retreat.contactEmail}` : ''
  if (!retreat.groupLinkExpiresAt || retreat.groupLinkExpiresAt < new Date()) {
    throw new HttpError(410, `This link has expired. Please contact ${organiser}${contact} for a new link.`)
  }
  if (retreat.status !== 'collecting') throw new HttpError(409, 'Reviews for this retreat aren’t being collected at the moment.')
  return { retreat, organiser, contact }
}

groupLinkRouter.get(
  '/:token',
  tokenLimiter,
  route(async (req, res) => {
    const { retreat, organiser } = await openGroupLink(String(req.params.token))
    res.json({
      retreatTitle: retreat.title,
      organiser,
      kind: retreat.kind,
      privacyNoticePath: `/o/${retreat.organisation.slug}/privacy?programme=${retreat.slug}`,
      full: (await joinsOn(retreat)) >= MAX_JOINS,
    })
  }),
)

/** Joining: just a name. The person gets their own review link straight away. */
groupLinkRouter.post(
  '/:token/join',
  linkGuessLimiter,
  groupJoinLimiter,
  route(async (req, res) => {
    const { retreat, organiser, contact } = await openGroupLink(String(req.params.token))
    const { name } = parseBody(z.object({ name: text(120).refine((v) => v.length > 0, 'Required') }), req.body)
    if ((await joinsOn(retreat)) >= MAX_JOINS) {
      throw new HttpError(409, `This link has been used by ${MAX_JOINS} people already. Please contact ${organiser}${contact} for your own link.`)
    }
    const attendee = await prisma.attendee.create({ data: { organisationId: retreat.organisationId, retreatId: retreat.id, name, source: 'group_link' } })
    const { token } = await prisma.$transaction((tx) => issueInvitation(tx, { organisationId: retreat.organisationId, attendeeId: attendee.id, ttlDays: retreat.inviteTtlDays }))
    await audit({ organisationId: retreat.organisationId, actorKind: 'attendee', action: 'group_link.joined', entityType: 'attendee', entityId: attendee.id })
    res.status(201).json({ reviewPath: `/invite/${token}?via=group` })
  }),
)
