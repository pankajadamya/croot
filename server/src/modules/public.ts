import { Router } from 'express'
import { z } from 'zod'
import type { PublicationRevision } from '@prisma/client'
import { PROCESSING_TERMS_VERSION } from '../../../shared/legal.js'
import { audit } from '../lib/audit.js'
import { HttpError, param, parseBody, route, text, uuidParam } from '../lib/http.js'
import { prisma } from '../lib/prisma.js'
import { livePublication } from '../lib/publication.js'
import { activeOrgBySlug, publicRetreat, publishedContent, publishedTheme, retreatFacts, tenantForHost } from '../lib/site.js'
import { storage } from '../lib/storage.js'
import { anonymousLimiter, publicFormLimiter } from '../middleware/rateLimits.js'

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
      select: { slug: true, kind: true, title: true, startDate: true, endDate: true, locationSummary: true },
    })
    res.json({ org: { slug: org.slug, name: org.name }, retreats })
  }),
)

async function liveStories(retreatId: string): Promise<Array<PublicationRevision & { publicSlug: string; pinned: boolean }>> {
  const responses = await prisma.response.findMany({
    where: { retreatId, publicationStatus: 'published', publicSlug: { not: null } },
    select: { id: true, publicSlug: true, pinned: true },
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
    // Pinned first, then oldest publication first: deterministic, and never ordered by rating.
    .sort((a, b) => Number(b.meta.pinned) - Number(a.meta.pinned) || (firstPublished.get(a.meta.id) ?? 0) - (firstPublished.get(b.meta.id) ?? 0))
    .map(({ meta, rev }) => ({ ...rev, publicSlug: meta.publicSlug!, pinned: meta.pinned }))
}

async function heroImages(retreatId: string) {
  const media = await prisma.mediaAsset.findMany({
    where: { retreatId, kind: 'organiser', inHeroSlideshow: true, moderation: 'approved', publishConsent: true, removedAt: null },
    orderBy: { displayOrder: 'asc' },
  })
  return media.map((m) => ({ url: `/media/${m.id}`, alt: m.altText, caption: m.caption, credit: m.credit, focalX: m.focalX, focalY: m.focalY }))
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
    res.set('Cache-Control', 'public, max-age=30')
    res.json({
      org: { slug: org.slug, name: org.name },
      retreat: retreatFacts(retreat),
      theme,
      content,
      hero,
      stories: stories.map((s) => ({
        slug: s.publicSlug,
        excerpt: s.excerpt,
        excerptIsFull: s.excerpt.length === s.storyText.length,
        displayName: s.displayName,
        photo: s.photoIds[0] ? { url: `/media/${s.photoIds[0]}` } : null,
      })),
    })
  }),
)

publicRouter.get(
  '/stories/:slug',
  route(async (req, res) => {
    const slug = param(req, 'slug')
    res.set('Cache-Control', 'public, max-age=30')
    const response = await prisma.response.findUnique({
      where: { publicSlug: slug },
      select: { id: true, retreatId: true, retreat: { include: { organisation: { select: { slug: true, name: true, status: true } } } } },
    })
    const live = response ? await livePublication(response.id) : null
    const retreat = response?.retreat
    if (!response || !retreat || !live || !retreat.publicReviewsEnabled || retreat.organisation.status !== 'active' || retreat.status === 'draft') {
      // A withdrawn or unpublished story is gone, not "hidden": 410 tells caches and crawlers to drop it.
      return res.status(410).json({ error: 'This story is no longer available.' })
    }
    const photos = await prisma.mediaAsset.findMany({ where: { id: { in: live.photoIds }, publishConsent: true, moderation: 'approved', removedAt: null } })
    const byId = new Map(photos.map((p) => [p.id, p]))
    res.json({
      org: { slug: retreat.organisation.slug, name: retreat.organisation.name },
      retreat: retreatFacts(retreat),
      theme: await publishedTheme(retreat.id),
      story: {
        slug,
        text: live.storyText,
        excerpt: live.excerpt,
        displayName: live.displayName,
        overallRating: live.overallRating,
        photos: live.photoIds
          .map((id) => byId.get(id))
          .filter((p) => p !== undefined)
          .map((p) => ({ url: `/media/${p.id}`, alt: p.altText, caption: p.caption, width: p.width, height: p.height })),
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
// Anonymous notes: a separate path with no invite token, cookie, session or attendee key.

publicRouter.get(
  '/orgs/:orgSlug/retreats/:retreatSlug/anonymous',
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    const retreat = await publicRetreat(org.id, param(req, 'retreatSlug'))
    res.json({ org: { name: org.name }, retreat: { title: retreat.title, organiserName: retreat.organiserName, privacyUrl: retreat.privacyUrl }, open: retreat.status === 'collecting' })
  }),
)

const noteSchema = z.object({
  message: text(4000).refine((v) => v.length >= 3, 'Please write a little more'),
  category: z.enum(['instruction', 'accommodation', 'food', 'travel', 'safety', 'people', 'other']).optional(),
})

function weekStart(d = new Date()): Date {
  const day = (d.getUTCDay() + 6) % 7 // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day))
}

publicRouter.post(
  '/orgs/:orgSlug/retreats/:retreatSlug/anonymous',
  anonymousLimiter,
  route(async (req, res) => {
    const org = await activeOrgBySlug(param(req, 'orgSlug'))
    const retreat = await publicRetreat(org.id, param(req, 'retreatSlug'))
    if (retreat.status !== 'collecting') throw new HttpError(409, 'Notes for this retreat are closed.')
    const body = parseBody(noteSchema, req.body)
    // Only the week is stored. No IP, user agent, cookie, referrer or request id is recorded, and no
    // audit event is written (an audit timestamp would re-introduce precise timing).
    await prisma.anonymousNote.create({
      data: { organisationId: org.id, retreatId: retreat.id, message: body.message, category: body.category ?? null, receivedWeek: weekStart() },
    })
    res.set('Cache-Control', 'no-store')
    res.status(201).json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------------------------
// Retreat owners asking to join the platform.

const tenantRequestSchema = z.object({
  orgName: text(120).refine((v) => v.length >= 2, 'Required'),
  contactName: text(120).refine((v) => v.length >= 2, 'Required'),
  email: z.email().max(200),
  websiteUrl: z.url().max(300).optional().or(z.literal('').transform(() => undefined)),
  message: text(2000).optional(),
  reviewKinds: z.array(z.enum(['itinerary', 'property'])).min(1, 'Choose at least one').max(2).default(['itinerary']),
  acceptTerms: z.literal(true, { error: 'Please confirm you have read the privacy notice and processing terms' }),
})

publicRouter.post(
  '/tenant-requests',
  publicFormLimiter,
  route(async (req, res) => {
    const { acceptTerms: _accepted, ...body } = parseBody(tenantRequestSchema, req.body)
    const created = await prisma.tenantRequest.create({
      data: { ...body, reviewKinds: [...new Set(body.reviewKinds)], email: body.email.toLowerCase(), termsVersion: PROCESSING_TERMS_VERSION },
    })
    await audit({ actorKind: 'system', action: 'tenant_request.created', entityType: 'tenant_request', entityId: created.id })
    res.status(201).json({ ok: true })
  }),
)

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
