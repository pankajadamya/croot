import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { defaultCategoriesFor, reconcileCategories, type FeedbackCategory, type RemovedFeedbackCategory } from '../../../../shared/categories.js'
import { FILM_MUSIC_IDS, FILM_STYLE_IDS } from '../../../../shared/film.js'
import { slugify } from '../../../../shared/slug.js'
import { audit } from '../../lib/audit.js'
import { HttpError, parseBody, route, text, uuidParam } from '../../lib/http.js'
import { sendMail } from '../../lib/mailer.js'
import { organiserMails } from '../../lib/organisers.js'
import { prisma } from '../../lib/prisma.js'
import { tenantRetreat } from '../../lib/tenant.js'
import { requireCsrf, requireOrgMember, requireOwner, tenantOf } from '../../middleware/auth.js'
import { attendeesRouter } from './attendees.js'
import { privacyRouter } from './privacy.js'
import { recycleBinRouter } from './recycleBin.js'
import { responsesRouter } from './responses.js'
import { verifyRequestAdminRouter } from '../verifyRequests.js'
import { groupLinkAdminRouter } from '../groupLink.js'
import { interestRouter } from './interest.js'
import { shareKitRouter } from './shareKit.js'
import { siteRouter } from './site.js'

/**
 * Organiser workspace: everything under /api/admin/orgs/:orgSlug. `requireOrgMember` resolves the
 * tenant from the URL and checks membership; every query below filters by that organisation id.
 */
export const adminRouter = Router({ mergeParams: true })
adminRouter.use(requireOrgMember, requireCsrf)
adminRouter.use(attendeesRouter, responsesRouter, siteRouter, privacyRouter, recycleBinRouter, shareKitRouter, interestRouter, verifyRequestAdminRouter, groupLinkAdminRouter)

adminRouter.get(
  '/',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreats = await prisma.retreat.findMany({ where: { organisationId: t.org.id }, orderBy: [{ startDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }] })
    const ids = retreats.map((r) => r.id)
    const [attendees, opened, byStatus, published, notes, openRequests, guests] = await Promise.all([
      prisma.attendee.groupBy({ by: ['retreatId'], where: { organisationId: t.org.id, retreatId: { in: ids } }, _count: true }),
      prisma.invitation.findMany({
        where: { organisationId: t.org.id, revokedAt: null, openedAt: { not: null } },
        select: { attendee: { select: { retreatId: true } } },
      }),
      prisma.response.groupBy({ by: ['retreatId', 'status'], where: { organisationId: t.org.id }, _count: true }),
      prisma.response.groupBy({ by: ['retreatId'], where: { organisationId: t.org.id, publicationStatus: 'published' }, _count: true }),
      prisma.anonymousNote.groupBy({ by: ['retreatId'], where: { organisationId: t.org.id }, _count: true }),
      prisma.changeRequest.findMany({ where: { organisationId: t.org.id, status: 'open' }, select: { response: { select: { retreatId: true } } } }),
      prisma.attendee.findMany({ where: { organisationId: t.org.id, retreatId: { in: ids } }, select: { id: true, retreatId: true, partyId: true, response: { select: { submittedAt: true } } } }),
    ])
    // Guests who came together count once: a party has responded when any of them has sent a review.
    const partiesOf = (retreatId: string) => {
      const groups = new Map<string, boolean>()
      for (const g of guests) {
        if (g.retreatId !== retreatId) continue
        const key = g.partyId ?? g.id
        groups.set(key, (groups.get(key) ?? false) || Boolean(g.response?.submittedAt))
      }
      return { parties: groups.size, partiesResponded: [...groups.values()].filter(Boolean).length }
    }
    const count = <T extends { retreatId: string; _count: number }>(rows: T[], id: string, pred: (r: T) => boolean = () => true) =>
      rows.filter((r) => r.retreatId === id && pred(r)).reduce((n, r) => n + r._count, 0)
    res.json({
      org: { ...t.org, role: t.role },
      openChangeRequests: openRequests.length,
      retreats: retreats.map((r) => ({
        id: r.id,
        slug: r.slug,
        kind: r.kind,
        title: r.title,
        status: r.status,
        startDate: r.startDate,
        endDate: r.endDate,
        stats: {
          attendees: count(attendees, r.id),
          opened: opened.filter((o) => o.attendee.retreatId === r.id).length,
          drafts: count(byStatus, r.id, (x) => x.status === 'draft'),
          submitted: count(byStatus, r.id, (x) => x.status === 'submitted' || x.status === 'changes_requested'),
          published: count(published, r.id),
          anonymousNotes: count(notes, r.id),
          openRequests: openRequests.filter((o) => o.response.retreatId === r.id).length,
          ...partiesOf(r.id),
        },
      })),
    })
  }),
)

/** Itinerary retreats need their dates; properties are reviewed across many individual stays. */
function checkDates(kind: 'itinerary' | 'property', start: Date | null, end: Date | null) {
  if (kind === 'itinerary' && (!start || !end)) throw new HttpError(400, 'An itinerary retreat needs a start and end date')
  if (start && end && end < start) throw new HttpError(400, 'The end date is before the start date')
}

const categorySchema = z.object({ key: z.string().regex(/^[a-z0-9_-]{1,40}$/), label: text(120) })

const retreatSchema = z.object({
  title: text(160).refine((v) => v.length >= 2, 'Required'),
  slug: z.string().max(60).optional(),
  kind: z.enum(['itinerary', 'property']).default('itinerary'),
  startDate: z.coerce.date().nullable().optional(),
  endDate: z.coerce.date().nullable().optional(),
  propertyAddress: text(300).nullable().optional(),
  amenities: z.array(text(80)).max(6).optional(),
  locationSummary: text(200).default(''),
  routeSummary: z.array(text(160)).max(4).default([]),
  itineraryUrl: z.url({ protocol: /^https?$/ }).nullable().optional(),
  retreatPageUrl: z.url({ protocol: /^https?$/ }).nullable().optional(),
  organiserName: text(120).default(''),
  contactEmail: z.email().nullable().optional(),
  contactPhone: text(40).nullable().optional(),
  contactPublic: z.boolean().optional(),
  privacyUrl: z.url({ protocol: /^https?$/ }).nullable().optional(),
  status: z.enum(['draft', 'collecting', 'closed', 'archived']).optional(),
  inviteOpensAt: z.coerce.date().nullable().optional(),
  inviteClosesAt: z.coerce.date().nullable().optional(),
  inviteTtlDays: z.number().int().min(1).max(365).optional(),
  draftEditingEnabled: z.boolean().optional(),
  publicReviewsEnabled: z.boolean().optional(),
  writingSlideshowEnabled: z.boolean().optional(),
  heroSlideshowEnabled: z.boolean().optional(),
  showPublicRating: z.boolean().optional(),
  rewardAlbumEnabled: z.boolean().optional(),
  rewardAlbumUrl: z.url({ protocol: /^https?$/ }).max(500).nullable().optional().or(z.literal('').transform(() => null)),
  rewardAlbumNote: text(600).optional(),
  aggregateThreshold: z.number().int().min(3).max(50).optional(),
  feedbackCategories: z.array(categorySchema).max(20).optional(),
  filmMusic: z.enum(FILM_MUSIC_IDS).optional(),
  filmStyle: z.enum(FILM_STYLE_IDS).optional(),
})

adminRouter.get(
  '/retreats/:retreatId',
  route(async (req, res) => {
    const t = tenantOf(req)
    res.json({ retreat: await tenantRetreat(t.org.id, uuidParam(req, 'retreatId')) })
  }),
)

adminRouter.post(
  '/retreats',
  route(async (req, res) => {
    const t = tenantOf(req)
    const body = parseBody(retreatSchema, req.body)
    checkDates(body.kind, body.startDate ?? null, body.endDate ?? null)
    const slug = slugify(body.slug || body.title)
    if (!slug) throw new HttpError(400, 'Choose a slug')
    if (await prisma.retreat.findUnique({ where: { organisationId_slug: { organisationId: t.org.id, slug } } })) {
      throw new HttpError(409, 'Another retreat already uses that slug')
    }
    const retreat = await prisma.retreat.create({
      data: {
        ...body,
        slug,
        organisationId: t.org.id,
        feedbackCategories: (body.feedbackCategories ?? defaultCategoriesFor(body.kind)) as unknown as Prisma.InputJsonValue,
      },
    })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'retreat.created', entityType: 'retreat', entityId: retreat.id })
    res.status(201).json({ retreat })
  }),
)

adminRouter.patch(
  '/retreats/:retreatId',
  route(async (req, res) => {
    const t = tenantOf(req)
    const current = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    // Only the fields sent are changed. partial() keeps the schema's defaults, so without this filter
    // a save of one setting (the album note, say) reset the others to them: the organiser name,
    // location and route went blank and a property's type went back to "itinerary".
    const parsed = parseBody(retreatSchema.partial(), req.body)
    const sent = new Set(Object.keys(req.body ?? {}))
    const body = Object.fromEntries(Object.entries(parsed).filter(([key]) => sent.has(key))) as typeof parsed
    checkDates(
      body.kind ?? current.kind,
      body.startDate !== undefined ? body.startDate : current.startDate,
      body.endDate !== undefined ? body.endDate : current.endDate,
    )
    let slug: string | undefined
    if (body.slug !== undefined) {
      slug = slugify(body.slug)
      if (!slug) throw new HttpError(400, 'Choose a slug')
      const clash = await prisma.retreat.findUnique({ where: { organisationId_slug: { organisationId: t.org.id, slug } } })
      if (clash && clash.id !== current.id) throw new HttpError(409, 'Another retreat already uses that slug')
    }
    const { feedbackCategories: requested, ...rest } = body
    let feedbackCategories = requested
    if (body.kind && body.kind !== current.kind) {
      // Changing type swaps in that type's default questions, but only before anyone has answered.
      const answered = await prisma.response.count({ where: { retreatId: current.id, status: { not: 'draft' } } })
      if (answered > 0) throw new HttpError(409, 'Guests have already responded, so the review type can no longer change')
      feedbackCategories ??= defaultCategoriesFor(body.kind)
    }
    let removedFeedbackCategories: RemovedFeedbackCategory[] | undefined
    if (feedbackCategories) {
      const result = reconcileCategories(
        current.feedbackCategories as unknown as FeedbackCategory[],
        current.removedFeedbackCategories as unknown as RemovedFeedbackCategory[],
        feedbackCategories,
      )
      if (result.reusedKey) throw new HttpError(409, 'That category was removed earlier. Reload the page and add it again.')
      removedFeedbackCategories = result.removed
    }
    const retreat = await prisma.retreat.update({
      where: { id: current.id },
      data: {
        ...rest,
        ...(slug ? { slug } : {}),
        ...(feedbackCategories ? { feedbackCategories: feedbackCategories as unknown as Prisma.InputJsonValue } : {}),
        ...(removedFeedbackCategories ? { removedFeedbackCategories: removedFeedbackCategories as unknown as Prisma.InputJsonValue } : {}),
      },
    })
    await audit({
      organisationId: t.org.id,
      actorUserId: t.userId,
      actorKind: 'user',
      action: 'retreat.updated',
      entityType: 'retreat',
      entityId: retreat.id,
      metadata: { fields: Object.keys(body) },
    })
    res.json({ retreat })
  }),
)

// ---------------------------------------------------------------------------------------------
// Team

adminRouter.get(
  '/members',
  route(async (req, res) => {
    const t = tenantOf(req)
    const rows = await prisma.membership.findMany({ where: { organisationId: t.org.id }, include: { user: true }, orderBy: { createdAt: 'asc' } })
    res.json({
      members: rows.map((m) => ({ id: m.id, role: m.role, name: m.user.name, email: m.user.email, active: m.user.active, hasPassword: Boolean(m.user.passwordHash), lastLoginAt: m.user.lastLoginAt })),
    })
  }),
)

adminRouter.post(
  '/members',
  requireOwner,
  route(async (req, res) => {
    const t = tenantOf(req)
    const body = parseBody(z.object({ email: z.email(), name: text(120), role: z.enum(['owner', 'organiser']) }), req.body)
    const email = body.email.toLowerCase()
    const user = (await prisma.user.findUnique({ where: { email } })) ?? (await prisma.user.create({ data: { email, name: body.name } }))
    const existing = await prisma.membership.findUnique({ where: { userId_organisationId: { userId: user.id, organisationId: t.org.id } } })
    if (existing) throw new HttpError(409, 'That person is already a member')
    await prisma.membership.create({ data: { userId: user.id, organisationId: t.org.id, role: body.role } })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'member.added', entityType: 'user', entityId: user.id, metadata: { role: body.role } })
    // No setup (password) link: it would let an owner take over any existing account by adding its
    // address. They're emailed, and sign in with their own email (a one-time code or Google).
    let emailed = true
    try {
      const by = (await prisma.user.findUnique({ where: { id: t.userId }, select: { name: true } }))?.name || 'Your team'
      await sendMail(organiserMails.addedToTeam(email, { name: user.name || body.name, orgName: t.org.name, orgSlug: t.org.slug, by, role: body.role }))
    } catch (e) {
      emailed = false
      console.error('team member email failed:', (e as Error).message)
    }
    res.status(201).json({ setupUrl: null, emailed })
  }),
)

adminRouter.delete(
  '/members/:membershipId',
  requireOwner,
  route(async (req, res) => {
    const t = tenantOf(req)
    const id = uuidParam(req, 'membershipId')
    const m = await prisma.membership.findFirst({ where: { id, organisationId: t.org.id } })
    if (!m) throw new HttpError(404, 'Member not found')
    if (m.role === 'owner') {
      const owners = await prisma.membership.count({ where: { organisationId: t.org.id, role: 'owner' } })
      if (owners <= 1) throw new HttpError(409, 'An organisation needs at least one owner')
    }
    await prisma.membership.delete({ where: { id } })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'member.removed', entityType: 'user', entityId: m.userId })
    res.status(204).end()
  }),
)

adminRouter.get(
  '/audit',
  route(async (req, res) => {
    const t = tenantOf(req)
    const events = await prisma.auditEvent.findMany({ where: { organisationId: t.org.id }, orderBy: { createdAt: 'desc' }, take: 200 })
    const userIds = [...new Set(events.map((e) => e.actorUserId).filter((x): x is string => Boolean(x)))]
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
    const names = new Map(users.map((u) => [u.id, u.name]))
    res.json({
      events: events.map((e) => ({ ...e, actorName: e.actorUserId ? names.get(e.actorUserId) ?? 'Unknown' : e.actorKind })),
    })
  }),
)
