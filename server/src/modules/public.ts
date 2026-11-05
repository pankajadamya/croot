import { Router } from 'express'
import { z } from 'zod'
import type { PublicationRevision } from '@prisma/client'
import { altFor } from '../lib/altText.js'
import { HttpError, param, parseBody, route, text, uuidParam } from '../lib/http.js'
import { prisma } from '../lib/prisma.js'
import { livePublication } from '../lib/publication.js'
import { activeOrgBySlug, publicRetreat, publishedContent, publishedTheme, retreatFacts, tenantForHost } from '../lib/site.js'
import { storage } from '../lib/storage.js'
import { anonymousLimiter, heartLimiter } from '../middleware/rateLimits.js'
import { albumListing, albumPagePath, publicAlbumLink, sendAlbumPhoto, sendAlbumVideo } from '../lib/album.js'
import { heartCounts, heartedBy, setHeart, voterSchema } from '../lib/hearts.js'

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
    // The average of the overall ratings on published reviews (guests agreed to publish them with their story).
    const rated = retreat.showPublicRating ? stories.map((s) => s.overallRating).filter((n): n is number => typeof n === 'number') : []
    const rating = rated.length ? { average: Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10, count: rated.length } : null
    res.set('Cache-Control', 'public, max-age=30')
    res.json({
      org: { slug: org.slug, name: org.name, websiteUrl: org.websiteUrl },
      retreat: retreatFacts(retreat),
      album: await publicAlbumLink(retreat, org.slug),
      rating,
      theme,
      content,
      hero,
      stories: stories.map((s) => ({
        slug: s.publicSlug,
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

// The retreat's photo album: public, view only (adding photos is for guests who reviewed).
publicRouter.get(
  '/orgs/:orgSlug/retreats/:retreatSlug/album',
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    const retreat = await publicRetreat(org.id, param(req, 'retreatSlug'))
    res.set('Cache-Control', 'public, max-age=30')
    res.json(await albumListing(retreat, null, req.baseUrl + req.path, { pagePath: albumPagePath(org.slug, retreat.slug), publicView: true }))
  }),
)

/** Photos visitors can heart: the album's, and those on the retreat's published reviews. */
async function heartableIds(retreat: Awaited<ReturnType<typeof publicRetreat>>) {
  const ids = new Set<string>()
  if (retreat.kind === 'itinerary' && retreat.rewardAlbumEnabled) {
    for (const p of (await albumListing(retreat, null, '', { pagePath: '', publicView: true })).photos) ids.add(p.id)
  }
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
  '/orgs/:orgSlug/retreats/:retreatSlug/album/:photoId/video',
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    const retreat = await publicRetreat(org.id, param(req, 'retreatSlug'))
    await sendAlbumVideo(req, res, retreat, uuidParam(req, 'photoId'))
  }),
)

publicRouter.get(
  '/orgs/:orgSlug/retreats/:retreatSlug/album/:photoId',
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    const retreat = await publicRetreat(org.id, param(req, 'retreatSlug'))
    await sendAlbumPhoto(res, retreat, null, uuidParam(req, 'photoId'), true)
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
      album: await publicAlbumLink(retreat, retreat.organisation.slug),
      story: {
        slug,
        postedAt: submitted?.submittedAt ?? live.createdAt,
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
        originalPhotoRetentionDays: true,
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

const noteSchema = z.object({ message: text(4000).refine((v) => v.length >= 3, 'Please write a little more') })

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
    await prisma.anonymousNote.create({ data: { organisationId: retreat.organisationId, retreatId: retreat.id, message: body.message, receivedOn } })
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
