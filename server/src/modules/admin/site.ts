import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { DEFAULT_THEME, THEME_PRESETS, validateTheme } from '../../../../shared/themes.js'
import { audit } from '../../lib/audit.js'
import { env } from '../../lib/env.js'
import { HttpError, parseBody, route, text, uuidParam } from '../../lib/http.js'
import { processImage } from '../../lib/images.js'
import { prisma } from '../../lib/prisma.js'
import { storage } from '../../lib/storage.js'
import { tenantMedia, tenantRetreat } from '../../lib/tenant.js'
import { tenantOf } from '../../middleware/auth.js'
import { uploadLimiter } from '../../middleware/rateLimits.js'

export const siteRouter = Router({ mergeParams: true })

// ---------------------------------------------------------------------------------------------
// Organiser opening (headline, intro, CTA). One working draft; publishing snapshots it.

const contentSchema = z.object({
  headline: text(160),
  introParagraphs: z.array(text(800)).max(3),
  ctaLabel: text(60).default(''),
  ctaUrl: z.union([z.url(), z.literal('')]).default(''),
})

siteRouter.get(
  '/retreats/:retreatId/content',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const [draft, published] = await Promise.all([
      prisma.contentRevision.findFirst({ where: { retreatId: retreat.id, status: 'draft' }, orderBy: { createdAt: 'desc' } }),
      prisma.contentRevision.findFirst({ where: { retreatId: retreat.id, status: 'published' }, orderBy: { createdAt: 'desc' } }),
    ])
    res.json({ draft, published })
  }),
)

siteRouter.put(
  '/retreats/:retreatId/content',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const body = parseBody(contentSchema, req.body)
    const existing = await prisma.contentRevision.findFirst({ where: { retreatId: retreat.id, status: 'draft' } })
    const draft = existing
      ? await prisma.contentRevision.update({ where: { id: existing.id }, data: { ...body, actorId: t.userId } })
      : await prisma.contentRevision.create({ data: { ...body, organisationId: t.org.id, retreatId: retreat.id, status: 'draft', actorId: t.userId } })
    res.json({ draft })
  }),
)

siteRouter.post(
  '/retreats/:retreatId/content/publish',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const body = parseBody(z.object({ publishAt: z.coerce.date().nullable().optional() }), req.body)
    const draft = await prisma.contentRevision.findFirst({ where: { retreatId: retreat.id, status: 'draft' } })
    if (!draft) throw new HttpError(409, 'Save a draft first')
    if (!draft.headline.trim()) throw new HttpError(400, 'Add a headline before publishing')
    // A scheduled opening must not take the live one down early: the public page shows the newest
    // published revision whose publishAt has passed, so older ones are archived only when the new one goes live now.
    const scheduled = Boolean(body.publishAt && body.publishAt > new Date())
    await prisma.$transaction([
      prisma.contentRevision.updateMany({
        where: scheduled ? { retreatId: retreat.id, status: 'published', publishAt: { gt: new Date() } } : { retreatId: retreat.id, status: 'published' },
        data: { status: 'archived' },
      }),
      prisma.contentRevision.create({
        data: {
          organisationId: t.org.id,
          retreatId: retreat.id,
          headline: draft.headline,
          introParagraphs: draft.introParagraphs,
          ctaLabel: draft.ctaLabel,
          ctaUrl: draft.ctaUrl,
          status: 'published',
          publishAt: body.publishAt ?? null,
          actorId: t.userId,
        },
      }),
    ])
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'content.published', entityType: 'retreat', entityId: retreat.id, metadata: { scheduled: Boolean(body.publishAt) } })
    res.json({ ok: true })
  }),
)

siteRouter.post(
  '/retreats/:retreatId/content/unpublish',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    await prisma.contentRevision.updateMany({ where: { retreatId: retreat.id, status: 'published' }, data: { status: 'archived' } })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'content.unpublished', entityType: 'retreat', entityId: retreat.id })
    res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------------------------
// Themes: colour tokens only, contrast-validated on save and again on publish.

const themeSchema = z.object({ name: text(60), presetKey: z.string().max(40), tokens: z.record(z.string(), z.string()) })

siteRouter.get(
  '/retreats/:retreatId/theme',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const [draft, published] = await Promise.all([
      prisma.themeRevision.findFirst({ where: { retreatId: retreat.id, status: 'draft' }, orderBy: { createdAt: 'desc' } }),
      prisma.themeRevision.findFirst({ where: { retreatId: retreat.id, status: 'published' }, orderBy: { createdAt: 'desc' } }),
    ])
    res.json({ presets: THEME_PRESETS, draft, published, fallback: DEFAULT_THEME })
  }),
)

siteRouter.put(
  '/retreats/:retreatId/theme',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const body = parseBody(themeSchema, req.body)
    const check = validateTheme(body.tokens)
    if (!check.ok) throw new HttpError(400, 'Some colours are not legible enough', { tokens: check.errors })
    const tokens = body.tokens as Prisma.InputJsonValue
    const existing = await prisma.themeRevision.findFirst({ where: { retreatId: retreat.id, status: 'draft' } })
    const draft = existing
      ? await prisma.themeRevision.update({ where: { id: existing.id }, data: { name: body.name, presetKey: body.presetKey, tokens, actorId: t.userId } })
      : await prisma.themeRevision.create({ data: { organisationId: t.org.id, retreatId: retreat.id, name: body.name, presetKey: body.presetKey, tokens, status: 'draft', actorId: t.userId } })
    res.json({ draft })
  }),
)

siteRouter.post(
  '/retreats/:retreatId/theme/publish',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const draft = await prisma.themeRevision.findFirst({ where: { retreatId: retreat.id, status: 'draft' } })
    if (!draft) throw new HttpError(409, 'Save a draft theme first')
    const check = validateTheme(draft.tokens as Record<string, unknown>)
    if (!check.ok) throw new HttpError(400, 'Some colours are not legible enough', { tokens: check.errors })
    // Atomic swap: visitors see the old theme or the new one, never a mix.
    await prisma.$transaction([
      prisma.themeRevision.updateMany({ where: { retreatId: retreat.id, status: 'published' }, data: { status: 'archived' } }),
      prisma.themeRevision.create({
        data: { organisationId: t.org.id, retreatId: retreat.id, name: draft.name, presetKey: draft.presetKey, tokens: draft.tokens as Prisma.InputJsonValue, status: 'published', actorId: t.userId },
      }),
    ])
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'theme.published', entityType: 'retreat', entityId: retreat.id, metadata: { preset: draft.presetKey } })
    res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------------------------
// Organiser images (hero slideshow and writing-time memory prompts)

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1 } })

function organiserMediaView(orgSlug: string, m: Awaited<ReturnType<typeof tenantMedia>>) {
  return {
    id: m.id,
    previewUrl: `/api/admin/orgs/${orgSlug}/media/${m.id}/preview`,
    altText: m.altText,
    caption: m.caption,
    credit: m.credit,
    rightsConfirmed: m.publishConsent,
    approved: m.moderation === 'approved',
    displayOrder: m.displayOrder,
    focalX: m.focalX,
    focalY: m.focalY,
    inHeroSlideshow: m.inHeroSlideshow,
    inWritingSlideshow: m.inWritingSlideshow,
    kind: m.kind,
    inAlbum: m.kind === 'album' || m.inAlbum,
    albumOrder: m.albumOrder,
  }
}

siteRouter.get(
  '/retreats/:retreatId/media',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const media = await prisma.mediaAsset.findMany({
      // ?album=1 lists the thank-you album instead of the slideshow images.
      where: { organisationId: t.org.id, retreatId: retreat.id, kind: req.query.album ? 'album' : 'organiser', removedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    })
    res.json({ media: media.map((m) => organiserMediaView(t.org.slug, m)) })
  }),
)

siteRouter.post(
  '/retreats/:retreatId/media',
  uploadLimiter,
  upload.single('image'),
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    if (!req.file) throw new HttpError(400, 'Choose an image')
    const image = await processImage(req.file.buffer)
    const id = crypto.randomUUID()
    // ?album=1: a thank-you album photo (never public; only guests who sent a review can see it).
    const kind = req.query.album ? 'album' : 'organiser'
    const prefix = `org/${t.org.id}/retreat/${retreat.id}/${kind}/${id}`
    await storage.put(`${prefix}/original`, image.original, image.originalMime)
    await storage.put(`${prefix}/web.webp`, image.derivative, 'image/webp')
    const count = await prisma.mediaAsset.count({ where: { retreatId: retreat.id, kind, removedAt: null } })
    const m = await prisma.mediaAsset.create({
      data: {
        id,
        organisationId: t.org.id,
        retreatId: retreat.id,
        kind,
        originalKey: `${prefix}/original`,
        derivativeKey: `${prefix}/web.webp`,
        mime: image.originalMime,
        sizeBytes: image.original.length,
        width: image.width,
        height: image.height,
        displayOrder: count,
        // New photos go to the end of the album.
        albumOrder: (await prisma.mediaAsset.aggregate({ where: { retreatId: retreat.id, removedAt: null }, _max: { albumOrder: true } }))._max.albumOrder! + 1 || 0,
        // Slideshow images: included in both slideshows by default; shown once permission is confirmed.
        // Album photos: never in a slideshow, and ready at once (they are only for guests who reviewed).
        inHeroSlideshow: kind === 'organiser',
        inWritingSlideshow: kind === 'organiser',
        ...(kind === 'album' ? { moderation: 'approved' as const } : {}),
      },
    })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'media.uploaded', entityType: 'media', entityId: m.id })
    res.status(201).json({ media: organiserMediaView(t.org.slug, m) })
  }),
)

const mediaPatch = z.object({
  altText: text(300).optional(),
  caption: text(300).optional(),
  credit: text(200).optional(),
  rightsConfirmed: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
  focalX: z.number().min(0).max(1).optional(),
  focalY: z.number().min(0).max(1).optional(),
  inHeroSlideshow: z.boolean().optional(),
  inWritingSlideshow: z.boolean().optional(),
  /** Earlier images: part of the thank-you album (off takes it out of the album only). */
  inAlbum: z.boolean().optional(),
})

siteRouter.patch(
  '/media/:mediaId',
  route(async (req, res) => {
    const t = tenantOf(req)
    const media = await tenantMedia(t.org.id, uuidParam(req, 'mediaId'))
    if (media.kind === 'guest') throw new HttpError(403, "Guest photos are changed only by the guest's own choices")
    if (media.kind === 'album') {
      // Album photos: only their caption, alt text and order change.
      const body = parseBody(mediaPatch.pick({ altText: true, caption: true, displayOrder: true }), req.body)
      const updated = await prisma.mediaAsset.update({ where: { id: media.id }, data: body })
      return res.json({ media: organiserMediaView(t.org.slug, updated) })
    }
    const body = parseBody(mediaPatch, req.body)
    const { rightsConfirmed, ...rest } = body
    const next = { ...media, ...rest, publishConsent: rightsConfirmed ?? media.publishConsent }
    // The slideshow switches mean 'include when ready'. An organiser image is approved once its
    // permission is confirmed (alt text is recommended, not required); every public query and /media
    // request requires approval.
    const ready = next.publishConsent
    const updated = await prisma.mediaAsset.update({
      where: { id: media.id },
      data: { ...rest, publishConsent: next.publishConsent, moderation: ready ? 'approved' : 'pending' },
    })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'media.updated', entityType: 'media', entityId: media.id, metadata: { fields: Object.keys(body) } })
    res.json({ media: organiserMediaView(t.org.slug, updated) })
  }),
)

// ---------------------------------------------------------------------------------------------
// Thank-you album: everything that can be in it (album uploads and earlier images), its order and title photo.

siteRouter.get(
  '/retreats/:retreatId/album',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const media = await prisma.mediaAsset.findMany({
      where: { organisationId: t.org.id, retreatId: retreat.id, removedAt: null, kind: { in: ['album', 'organiser'] } },
      orderBy: [{ albumOrder: 'asc' }, { createdAt: 'asc' }],
    })
    res.json({ coverId: retreat.rewardAlbumCoverId, media: media.map((m) => organiserMediaView(t.org.slug, m)) })
  }),
)

siteRouter.put(
  '/retreats/:retreatId/album/order',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const { ids } = parseBody(z.object({ ids: z.array(z.uuid()).max(2000) }), req.body)
    const owned = new Set(
      (await prisma.mediaAsset.findMany({ where: { retreatId: retreat.id, id: { in: ids }, kind: { in: ['album', 'organiser'] } }, select: { id: true } })).map((m) => m.id),
    )
    await prisma.$transaction(ids.filter((id) => owned.has(id)).map((id, i) => prisma.mediaAsset.update({ where: { id }, data: { albumOrder: i } })))
    res.json({ ok: true })
  }),
)

siteRouter.post(
  '/retreats/:retreatId/album/cover',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const { mediaId } = parseBody(z.object({ mediaId: z.uuid().nullable() }), req.body)
    if (mediaId) {
      const m = await prisma.mediaAsset.findFirst({ where: { id: mediaId, retreatId: retreat.id, removedAt: null, OR: [{ kind: 'album' }, { kind: 'organiser', inAlbum: true }] } })
      if (!m) throw new HttpError(400, 'Choose a photo that is in the album')
    }
    await prisma.retreat.update({ where: { id: retreat.id }, data: { rewardAlbumCoverId: mediaId } })
    res.json({ coverId: mediaId })
  }),
)

siteRouter.delete(
  '/media/:mediaId',
  route(async (req, res) => {
    const t = tenantOf(req)
    const media = await tenantMedia(t.org.id, uuidParam(req, 'mediaId'))
    if (media.kind === 'guest') throw new HttpError(403, 'Guest photos cannot be deleted here')
    await prisma.mediaAsset.update({ where: { id: media.id }, data: { removedAt: new Date(), inHeroSlideshow: false, inWritingSlideshow: false } })
    await Promise.all([storage.remove(media.originalKey), storage.remove(media.derivativeKey)]).catch(() => {})
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'media.removed', entityType: 'media', entityId: media.id })
    res.status(204).end()
  }),
)
