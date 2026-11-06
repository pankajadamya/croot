import { Router } from 'express'
import { z } from 'zod'
import type { PublicationRevision } from '@prisma/client'
import { altFor } from '../lib/altText.js'
import { HttpError, param, parseBody, route, text, uuidParam } from '../lib/http.js'
import { prisma } from '../lib/prisma.js'
import { hashToken } from '../lib/tokens.js'
import { livePublication } from '../lib/publication.js'
import { activeOrgBySlug, publicRetreat, publishedContent, publishedTheme, retreatFacts, tenantForHost } from '../lib/site.js'
import { storage } from '../lib/storage.js'
import { anonymousLimiter, heartLimiter, publicFormLimiter } from '../middleware/rateLimits.js'
import { confirmInterest, interestWording, registerInterest, unsubscribeInterest } from '../lib/interest.js'
import { heartCounts, heartedBy, setHeart, voterSchema } from '../lib/hearts.js'
import { publicAlbumLink } from '../lib/album.js'
import { helpfulBy, helpfulCounts, setHelpful } from '../lib/helpful.js'

/**
 * Public projections only. Every response here is built from PublicationRevision snapshots and
 * public retreat fields — never from Response rows — so private feedback, emails, consent records
 * and drafts cannot leak by a forgotten field.
 */
export const publicRouter = Router()

/** Which site this hostname serves: the platform, or a tenant's custom domain. */
publicRouter.get(
  '/site',
  route(async (req, res) => {
    const org = await tenantForHost(req)
    res.json(org ? { mode: 'tenant', org: { slug: org.slug, name: org.name } } : { mode: 'platform' })
  }),
)

publicRouter.get(
  '/orgs/:orgSlug',
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    const retreats = await prisma.retreat.findMany({
      where: { organisationId: org.id, status: { in: ['collecting', 'closed'] } },
      orderBy: [{ startDate: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      select: { id: true, slug: true, kind: true, title: true, startDate: true, endDate: true, locationSummary: true, publicReviewsEnabled: true },
    })
    const cards = await Promise.all(
      retreats.map(async ({ id, publicReviewsEnabled, ...r }) => {
        // The card's title image: the first slideshow photo, else the first of the organiser's public images.
        const [image, stories] = await Promise.all([
          prisma.mediaAsset.findFirst({
            where: { retreatId: id, kind: 'organiser', moderation: 'approved', publishConsent: true, removedAt: null },
            orderBy: [{ inHeroSlideshow: 'desc' }, { displayOrder: 'asc' }, { createdAt: 'asc' }],
          }),
          publicReviewsEnabled ? prisma.response.count({ where: { retreatId: id, publicationStatus: 'published', publicSlug: { not: null } } }) : 0,
        ])
        return {
          ...r,
          image: image ? { url: `/media/${image.id}`, alt: altFor(image), focalX: image.focalX, focalY: image.focalY } : null,
          storyCount: stories,
        }
      }),
    )
    res.json({ org: { slug: org.slug, name: org.name, websiteUrl: org.websiteUrl }, retreats: cards })
  }),
)

async function liveStories(retreatId: string): Promise<Array<PublicationRevision & { publicSlug: string; pinned: boolean; postedAt: Date }>> {
  const responses = await prisma.response.findMany({
    where: { retreatId, publicationStatus: 'published', publicSlug: { not: null } },
    select: { id: true, publicSlug: true, pinned: true, submittedAt: true },
  })
  if (!responses.length) return []
  const revisions = await prisma.publicationRevision.findMany({
    where: { responseId: { in: responses.map((r) => r.id) } },
    orderBy: { createdAt: 'desc' },
  })
  const latest = new Map<string, PublicationRevision>()
  for (const rev of revisions) if (!latest.has(rev.responseId)) latest.set(rev.responseId, rev)
  const firstPublished = new Map<string, number>()
  for (const rev of revisions) if (rev.status === 'published') firstPublished.set(rev.responseId, rev.createdAt.getTime())
  return responses
    .map((r) => ({ meta: r, rev: latest.get(r.id) }))
    .filter((x): x is { meta: typeof x.meta; rev: PublicationRevision } => x.rev?.status === 'published')
    // Newest first (by when the guest sent it), never ordered by rating.
    .sort(
      (a, b) =>
        (b.meta.submittedAt?.getTime() ?? firstPublished.get(b.meta.id) ?? 0) - (a.meta.submittedAt?.getTime() ?? firstPublished.get(a.meta.id) ?? 0),
    )
    .map(({ meta, rev }) => ({ ...rev, publicSlug: meta.publicSlug!, pinned: meta.pinned, postedAt: meta.submittedAt ?? rev.createdAt }))
}

async function heroImages(retreatId: string) {
  const media = await prisma.mediaAsset.findMany({
    where: { retreatId, kind: 'organiser', inHeroSlideshow: true, moderation: 'approved', publishConsent: true, removedAt: null },
    orderBy: { displayOrder: 'asc' },
    take: 10, // the slideshow's limit (admin/site.ts MAX_SLIDESHOW); older retreats may have more chosen
  })
  return media.map((m) => ({ url: `/media/${m.id}`, alt: altFor(m), caption: m.caption, credit: m.credit, focalX: m.focalX, focalY: m.focalY }))
}

publicRouter.get(
  '/orgs/:orgSlug/retreats/:retreatSlug',
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    const retreat = await publicRetreat(org.id, param(req, 'retreatSlug'))
    const [theme, content, hero, stories] = await Promise.all([
      publishedTheme(retreat.id),
      publishedContent(retreat.id),
      retreat.heroSlideshowEnabled ? heroImages(retreat.id) : Promise.resolve([]),
      retreat.publicReviewsEnabled ? liveStories(retreat.id) : Promise.resolve([]),
    ])
    const allPhotoIds = stories.flatMap((s) => s.photoIds)
    const visible = new Map(
      (
        await prisma.mediaAsset.findMany({
          where: { id: { in: allPhotoIds }, retreatId: retreat.id, publishConsent: true, moderation: 'approved', removedAt: null },
        })
      ).map((m) => [m.id, m]),
    )
    const reviewHearts = await heartCounts([...visible.keys()])
    const helpful = await helpfulCounts(stories.map((s) => s.responseId))
    // The average of the overall ratings on published reviews (guests agreed to publish them with their story).
    const rated = retreat.showPublicRating ? stories.map((s) => s.overallRating).filter((n): n is number => typeof n === 'number') : []
    const rating = rated.length ? { average: Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10, count: rated.length } : null
    res.set('Cache-Control', 'public, max-age=30')
    res.json({
      org: { slug: org.slug, name: org.name, websiteUrl: org.websiteUrl },
      retreat: retreatFacts(retreat),
      album: await publicAlbumLink(retreat),
      rating,
      theme,
      content,
      hero,
      stories: stories.map((s) => ({
        slug: s.publicSlug,
        helpful: helpful.get(s.responseId) ?? 0,
        excerpt: s.excerpt,
        excerptIsFull: s.excerpt.length === s.storyText.length,
        title: s.title,
        text: s.storyText,
        postedAt: s.postedAt,
        overallRating: retreat.showPublicRating ? s.overallRating : null,
        displayName: s.displayName,
        photo: s.photoIds[0] && visible.has(s.photoIds[0]) ? { url: `/media/${s.photoIds[0]}` } : null,
        // The guest's own published photos, shown alongside their review.
        photos: s.photoIds
          .map((id) => visible.get(id))
          .filter((m): m is NonNullable<typeof m> => Boolean(m))
          .slice(0, 6)
          .map((m) => ({ id: m.id, url: `/media/${m.id}`, alt: altFor(m, 'Photo shared by the guest'), caption: m.caption, hearts: reviewHearts.get(m.id) ?? 0 })),
      })),
    })
  }),
)

// ---------------------------------------------------------------------------------------------
// "Tell me about the next retreat": double opt-in sign-ups (see lib/interest.ts).

publicRouter.get(
  '/orgs/:orgSlug/interest',
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    res.json({ wording: interestWording(org.name) })
  }),
)

publicRouter.post(
  '/orgs/:orgSlug/interest',
  publicFormLimiter,
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    const body = parseBody(
      z.object({
        email: z.email('Enter a valid email address').max(200),
        name: text(100).default(''),
        retreatSlug: z.string().max(120).optional(),
        consent: z.literal(true, 'Please tick the box to agree to updates'),
      }),
      req.body,
    )
    const retreat = body.retreatSlug ? await prisma.retreat.findUnique({ where: { organisationId_slug: { organisationId: org.id, slug: body.retreatSlug } }, select: { id: true } }) : null
    await registerInterest({ organisationId: org.id, orgName: org.name, retreatId: retreat?.id ?? null, email: body.email, name: body.name })
    res.set('Cache-Control', 'no-store')
    // The same answer whether or not the address was already signed up.
    res.status(202).json({ ok: true })
  }),
)

publicRouter.post(
  '/interest/:token/confirm',
  route(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json(await confirmInterest(String(req.params.token)))
  }),
)

publicRouter.post(
  '/interest/:token/unsubscribe',
  route(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json(await unsubscribeInterest(String(req.params.token)))
  }),
)

// "Found this review helpful": anyone can vote once per review (see lib/helpful.ts).

/** The response behind a live, public story, or null. */
async function liveStoryResponse(slug: string) {
  const response = await prisma.response.findUnique({
    where: { publicSlug: slug },
    select: { id: true, retreat: { select: { publicReviewsEnabled: true, status: true, organisation: { select: { status: true } } } } },
  })
  if (!response || !response.retreat.publicReviewsEnabled || response.retreat.status === 'draft' || response.retreat.organisation.status !== 'active') return null
  return (await livePublication(response.id)) ? response.id : null
}

publicRouter.post(
  '/stories/helpful/mine',
  heartLimiter,
  route(async (req, res) => {
    const { voter, slugs } = parseBody(z.object({ voter: voterSchema, slugs: z.array(z.string().max(120)).max(200) }), req.body)
    const rows = await prisma.response.findMany({ where: { publicSlug: { in: slugs } }, select: { id: true, publicSlug: true } })
    const voted = new Set(await helpfulBy(voter, rows.map((r) => r.id)))
    res.set('Cache-Control', 'no-store')
    res.json({ helpful: rows.filter((r) => voted.has(r.id)).map((r) => r.publicSlug) })
  }),
)

publicRouter.post(
  '/stories/:slug/helpful',
  heartLimiter,
  route(async (req, res) => {
    const responseId = await liveStoryResponse(param(req, 'slug'))
    if (!responseId) throw new HttpError(404, 'Story not found')
    const { voter, on } = parseBody(z.object({ voter: voterSchema, on: z.boolean() }), req.body)
    const count = await setHelpful(responseId, voter, on, req.ip)
    res.set('Cache-Control', 'no-store')
    res.json({ helpful: count, voted: on })
  }),
)

/** Photos visitors can heart from the retreat page: those on its published reviews. (Album photos are hearted through the album link.) */
async function heartableIds(retreat: Awaited<ReturnType<typeof publicRetreat>>) {
  const ids = new Set<string>()
  if (retreat.publicReviewsEnabled) {
    const reviewPhotoIds = (await liveStories(retreat.id)).flatMap((s) => s.photoIds)
    const shown = await prisma.mediaAsset.findMany({
      where: { id: { in: reviewPhotoIds }, retreatId: retreat.id, publishConsent: true, moderation: 'approved', removedAt: null },
      select: { id: true },
    })
    for (const m of shown) ids.add(m.id)
  }
  return ids
}

// Hearts. The visitor id travels in the body (never the URL); see lib/hearts.ts for the abuse controls.
publicRouter.post(
  '/orgs/:orgSlug/retreats/:retreatSlug/album/hearts/mine',
  heartLimiter,
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    const retreat = await publicRetreat(org.id, param(req, 'retreatSlug'))
    const { voter, photoIds } = parseBody(z.object({ voter: voterSchema, photoIds: z.array(z.uuid()).max(500) }), req.body)
    const allowed = await heartableIds(retreat)
    res.set('Cache-Control', 'no-store')
    res.json({ hearted: await heartedBy(voter, photoIds.filter((id) => allowed.has(id))) })
  }),
)

publicRouter.post(
  '/orgs/:orgSlug/retreats/:retreatSlug/album/:photoId/heart',
  heartLimiter,
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    const retreat = await publicRetreat(org.id, param(req, 'retreatSlug'))
    const photoId = uuidParam(req, 'photoId')
    const { voter, on } = parseBody(z.object({ voter: voterSchema, on: z.boolean() }), req.body)
    if (!(await heartableIds(retreat)).has(photoId)) throw new HttpError(404, 'Photo not found')
    const count = await setHeart(photoId, voter, on, req.ip)
    res.set('Cache-Control', 'no-store')
    res.json({ hearts: count, hearted: on })
  }),
)

publicRouter.get(
  '/stories/:slug',
  route(async (req, res) => {
    const slug = param(req, 'slug')
    res.set('Cache-Control', 'public, max-age=30')
    const response = await prisma.response.findUnique({
      where: { publicSlug: slug },
      select: { id: true, retreatId: true, retreat: { include: { organisation: { select: { slug: true, name: true, status: true, websiteUrl: true } } } } },
    })
    const live = response ? await livePublication(response.id) : null
    const retreat = response?.retreat
    if (!response || !retreat || !live || !retreat.publicReviewsEnabled || retreat.organisation.status !== 'active' || retreat.status === 'draft') {
      // A withdrawn or unpublished story is gone, not "hidden": 410 tells caches and crawlers to drop it.
      return res.status(410).json({ error: 'This story is no longer available.' })
    }
    const photos = await prisma.mediaAsset.findMany({ where: { id: { in: live.photoIds }, publishConsent: true, moderation: 'approved', removedAt: null } })
    const byId = new Map(photos.map((p) => [p.id, p]))
    const submitted = await prisma.response.findUnique({ where: { id: response.id }, select: { submittedAt: true } })

    // When the guest shared no photos, the viewer uses the organiser's own public retreat photos (in a
    // shuffled order). Never the thank-you album: that is private to guests who reviewed.
    const retreatPhotos = (
      await prisma.mediaAsset.findMany({
        where: { retreatId: retreat.id, kind: 'organiser', moderation: 'approved', publishConsent: true, removedAt: null },
        orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
        take: 30,
      })
    )
      .map((m) => ({ m, k: Math.random() }))
      .sort((a, b) => a.k - b.k)
      .slice(0, 8)
      .map(({ m }) => ({ url: `/media/${m.id}`, alt: altFor(m), caption: m.caption, credit: m.credit, focalX: m.focalX, focalY: m.focalY }))

    // "Up next": the retreat's other published stories, newest first.
    const others = (await liveStories(retreat.id)).filter((s) => s.publicSlug !== slug).slice(0, 6)
    const otherPhotoIds = others.map((s) => s.photoIds[0]).filter(Boolean)
    const otherPhotos = new Map(
      (await prisma.mediaAsset.findMany({ where: { id: { in: otherPhotoIds }, publishConsent: true, moderation: 'approved', removedAt: null } })).map((m) => [m.id, m]),
    )
    const more = others.map((s, i) => {
      const own = s.photoIds[0] ? otherPhotos.get(s.photoIds[0]) : undefined
      return {
        slug: s.publicSlug,
        title: s.title,
        excerpt: s.excerpt,
        displayName: s.displayName,
        postedAt: s.postedAt,
        overallRating: retreat.showPublicRating ? s.overallRating : null,
        image: own ? `/media/${own.id}` : (retreatPhotos[i % Math.max(retreatPhotos.length, 1)]?.url ?? null),
      }
    })

    res.json({
      org: { slug: retreat.organisation.slug, name: retreat.organisation.name, websiteUrl: retreat.organisation.websiteUrl },
      retreat: retreatFacts(retreat),
      theme: await publishedTheme(retreat.id),
      retreatPhotos,
      more,
      story: {
        slug,
        postedAt: submitted?.submittedAt ?? live.createdAt,
        helpful: (await helpfulCounts([response.id])).get(response.id) ?? 0,
        title: live.title,
        text: live.storyText,
        excerpt: live.excerpt,
        displayName: live.displayName,
        overallRating: retreat.showPublicRating ? live.overallRating : null,
        photos: live.photoIds
          .map((id) => byId.get(id))
          .filter((p) => p !== undefined)
          .map((p) => ({ url: `/media/${p.id}`, alt: altFor(p, 'Photo shared by the guest'), caption: p.caption, width: p.width, height: p.height })),
      },
    })
  }),
)

// ---------------------------------------------------------------------------------------------
// Privacy notice (GDPR Arts. 13/14), generated from the controller's own settings.

publicRouter.get(
  '/orgs/:orgSlug/privacy',
  route(async (req, res) => {
    const slug = param(req, 'orgSlug')
    const org = await prisma.organisation.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        status: true,
        legalName: true,
        legalAddress: true,
        privacyEmail: true,
        contactEmail: true,
        dpoContact: true,
        websiteUrl: true,
        draftRetentionDays: true,
        nonResponderRetentionDays: true,
        responseRetentionMonths: true,
        anonymousNoteRetentionMonths: true,
        updatedAt: true,
      },
    })
    if (!org || org.status !== 'active') throw new HttpError(404, 'Not found')
    const programmes = await prisma.retreat.findMany({
      where: { organisationId: org.id, status: { not: 'draft' } },
      select: { slug: true, title: true, kind: true, privacyUrl: true },
      orderBy: { createdAt: 'asc' },
    })
    const { id: _id, status: _s, ...notice } = org
    res.set('Cache-Control', 'public, max-age=300')
    res.json({ controller: notice, programmes, platformPrivacyPath: '/legal/privacy' })
  }),
)

// ---------------------------------------------------------------------------------------------
// Anonymous notes, written in the review form and sent on their own when the guest sends their review.
// This path carries no invite token, and is mounted before cookies are parsed, so it never reads a
// session either: nothing in the request says who sent it.

const noteSchema = z.object({
  message: text(4000).refine((v) => v.length >= 3, 'Please write a little more'),
  /** Random per note, made by the browser: sending the same note twice (a retry) stores it once. */
  sendKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
})

publicRouter.post(
  '/notes/:retreatId',
  anonymousLimiter,
  route(async (req, res) => {
    const retreat = await prisma.retreat.findFirst({ where: { id: uuidParam(req, 'retreatId'), organisation: { status: 'active' } } })
    if (!retreat) throw new HttpError(404, 'Not found')
    if (retreat.status !== 'collecting') throw new HttpError(409, 'Notes for this retreat are closed.')
    const body = parseBody(noteSchema, req.body)
    // Only the words and the date (for retention) are stored: no time of day, IP, user agent, cookie,
    // referrer or request id, and no audit event (its timestamp would let a note be matched to a review
    // sent at the same moment).
    const now = new Date()
    const receivedOn = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    const sendKeyHash = body.sendKey ? hashToken(`note:${body.sendKey}`) : null
    if (sendKeyHash && (await prisma.anonymousNote.findUnique({ where: { sendKeyHash }, select: { id: true } }))) {
      res.set('Cache-Control', 'no-store')
      return res.status(201).json({ ok: true, alreadySent: true })
    }
    await prisma.anonymousNote
      .create({ data: { organisationId: retreat.organisationId, retreatId: retreat.id, message: body.message, receivedOn, sendKeyHash } })
      .catch((e: { code?: string }) => {
        if (e.code !== 'P2002') throw e // a simultaneous retry already stored it
      })
    res.set('Cache-Control', 'no-store')
    res.status(201).json({ ok: true })
  }),
)

// Becoming an organiser is a signed-in request (account.ts) or an admin's invite (organiserInvites.ts):
// there is no anonymous request form any more.

// ---------------------------------------------------------------------------------------------
// Media: every byte is gated per request, so withdrawal is effective immediately.

export const mediaRouter = Router()

mediaRouter.get(
  '/:id',
  route(async (req, res) => {
    const id = uuidParam(req, 'id')
    const asset = await prisma.mediaAsset.findUnique({
      where: { id },
      include: { retreat: { select: { status: true, publicReviewsEnabled: true, organisation: { select: { status: true } } } } },
    })
    let allowed = false
    if (asset && !asset.removedAt && asset.moderation === 'approved' && asset.publishConsent && asset.retreat.organisation.status === 'active' && asset.retreat.status !== 'draft') {
      if (asset.kind === 'organiser') allowed = true
      else if (asset.responseId && asset.retreat.publicReviewsEnabled) {
        const live = await livePublication(asset.responseId)
        allowed = Boolean(live?.photoIds.includes(asset.id))
      }
    }
    if (!asset || !allowed) throw new HttpError(404, 'Not found')
    const bytes = await storage.get(asset.derivativeKey)
    if (!bytes) throw new HttpError(404, 'Not found')
    // Short cache so a withdrawal propagates quickly through browsers and any CDN.
    res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=300', 'Content-Disposition': 'inline' }).send(bytes)
  }),
)
