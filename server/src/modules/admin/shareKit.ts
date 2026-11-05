import { Router } from 'express'
import { firstName } from '../../../../shared/slug.js'
import { altFor } from '../../lib/altText.js'
import { audit } from '../../lib/audit.js'
import { parseBody, route, text, uuidParam } from '../../lib/http.js'
import { prisma } from '../../lib/prisma.js'
import { tenantRetreat } from '../../lib/tenant.js'
import { tenantOf } from '../../middleware/auth.js'
import { z } from 'zod'

/**
 * Share kit: social-media images made from guest reviews and photos, drawn in the organiser's browser.
 *
 * Only guests who agreed to their story being reused "in social media or advertising" are offered,
 * on top of agreeing to publish it. Their first name only with first-name consent. Their photos only
 * where they allowed that photo to be published and the organiser approved it. The organiser's own
 * images (with publishing rights confirmed) and album uploads can be used too.
 */
export const shareKitRouter = Router({ mergeParams: true })

/** The guest's words split into sentences, so a quote is always their exact words. */
function sentences(story: string) {
  return (story.match(/[^.!?\n]+[.!?]+["”’)]*|[^.!?\n]+$/gm) ?? []).map((s) => s.trim()).filter((s) => s.length >= 12)
}

shareKitRouter.get(
  '/retreats/:retreatId/share-kit',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const responses = await prisma.response.findMany({
      where: {
        organisationId: t.org.id,
        retreatId: retreat.id,
        status: 'submitted',
        consentMarketing: true,
        consentPublicText: true,
        storyText: { not: '' },
      },
      include: {
        attendee: { select: { name: true } },
        media: { where: { kind: 'guest', publishConsent: true, moderation: 'approved', removedAt: null, videoKey: null }, orderBy: { displayOrder: 'asc' } },
      },
      orderBy: { submittedAt: 'desc' },
    })
    const retreatImages = await prisma.mediaAsset.findMany({
      where: {
        organisationId: t.org.id,
        retreatId: retreat.id,
        removedAt: null,
        videoKey: null,
        OR: [{ kind: 'organiser', publishConsent: true, moderation: 'approved' }, { kind: 'album' }],
      },
      orderBy: [{ albumOrder: 'asc' }, { displayOrder: 'asc' }],
      take: 60,
    })
    const preview = (id: string) => `/api/admin/orgs/${t.org.slug}/media/${id}/preview`
    const published = await prisma.response.findMany({
      where: { retreatId: retreat.id, publicationStatus: 'published', overallRating: { not: null } },
      select: { overallRating: true },
    })
    const ratings = published.map((r) => r.overallRating!).filter(Boolean)
    const brandTheme = await prisma.themeRevision.findFirst({ where: { retreatId: retreat.id, status: 'published' }, orderBy: { createdAt: 'desc' }, select: { presetKey: true } })

    res.set('Cache-Control', 'no-store')
    res.json({
      retreat: { title: retreat.title, organiserName: retreat.organiserName || t.org.name, slug: retreat.slug, startDate: retreat.startDate, endDate: retreat.endDate },
      orgName: t.org.name,
      brandThemeKey: brandTheme?.presetKey ?? 'forest-linen',
      publicPath: `/o/${t.org.slug}/r/${retreat.slug}`,
      rating: retreat.showPublicRating && ratings.length ? { average: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10, count: ratings.length } : null,
      stories: responses.map((r) => ({
        id: r.id,
        name: r.consentFirstName ? firstName(r.attendee.name) : null,
        title: r.storyTitle.trim() || null,
        rating: retreat.showPublicRating ? r.overallRating : null,
        sentences: sentences(r.storyText),
        photos: r.media.map((m) => ({ id: m.id, url: preview(m.id), alt: altFor(m, 'Photo shared by the guest') })),
      })),
      retreatPhotos: retreatImages.map((m) => ({ id: m.id, url: preview(m.id), alt: altFor(m) })),
    })
  }),
)

/** Recorded when an organiser shares or downloads a kit, so reuse of guests' words is traceable. */
shareKitRouter.post(
  '/retreats/:retreatId/share-kit/used',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const body = parseBody(z.object({ storyIds: z.array(z.uuid()).max(20), format: text(20) }), req.body)
    await audit({
      organisationId: t.org.id,
      actorUserId: t.userId,
      actorKind: 'user',
      action: 'share_kit.used',
      entityType: 'retreat',
      entityId: retreat.id,
      metadata: { responseIds: body.storyIds, format: body.format },
    })
    res.json({ ok: true })
  }),
)
