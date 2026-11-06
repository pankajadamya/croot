import { readFile, rm } from 'node:fs/promises'
import { sensibleTime } from '../../../../shared/captureTime.js'
import { tmpdir } from 'node:os'
import { Router } from 'express'
import sharp from 'sharp'
import multer from 'multer'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { DEFAULT_THEME, THEME_PRESETS, validateTheme } from '../../../../shared/themes.js'
import { ensureShareToken, resetShareToken, sameFileKey, sharePath } from '../../lib/album.js'
import { audit } from '../../lib/audit.js'
import { env } from '../../lib/env.js'
import { HttpError, parseBody, route, text, uuidParam } from '../../lib/http.js'
import { processImage } from '../../lib/images.js'
import { albumHasPhotoRoom, albumLimits, albumUsage, assertAlbumRoom } from '../../lib/platformSettings.js'
import { sniffVideo, streamVideo, stripVideoMetadata, videoCreationTime } from '../../lib/video.js'
import { prisma } from '../../lib/prisma.js'
import { storage } from '../../lib/storage.js'
import { removeObjects } from '../../lib/storageCleanup.js'
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
  ctaUrl: z.union([z.url({ protocol: /^https?$/ }), z.literal('')]).default(''),
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
// Videos go to a temporary file, not memory; the poster frame comes from the organiser's browser.
const videoUpload = multer({ dest: tmpdir(), limits: { fileSize: env.MAX_VIDEO_BYTES, files: 2 } })

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
    sharedByGuest: m.kind === 'guest',
    albumOrder: m.albumOrder,
    isVideo: Boolean(m.videoKey),
    videoUrl: m.videoKey ? `/api/admin/orgs/${orgSlug}/media/${m.id}/video` : null,
    durationSec: m.durationSec,
    takenAt: m.takenAt,
  }
}

/** The public slideshow (and the guest form's) shows at most this many photos. */
export const MAX_SLIDESHOW = 10

async function slideshowCount(retreatId: string) {
  return prisma.mediaAsset.count({ where: { retreatId, kind: 'organiser', removedAt: null, inHeroSlideshow: true } })
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

siteRouter.put(
  '/retreats/:retreatId/media/order',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const { ids } = parseBody(z.object({ ids: z.array(z.uuid()).max(1000) }), req.body)
    const current = await prisma.mediaAsset.findMany({ where: { organisationId: t.org.id, retreatId: retreat.id, kind: 'organiser', removedAt: null }, select: { id: true } })
    if (ids.length !== current.length || new Set(ids).size !== ids.length || current.some((m) => !ids.includes(m.id))) {
      throw new HttpError(400, 'Include every current retreat image exactly once')
    }
    await prisma.$transaction(ids.map((id, displayOrder) => prisma.mediaAsset.update({ where: { id }, data: { displayOrder } })))
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'media.reordered', entityType: 'retreat', entityId: retreat.id })
    res.json({ ok: true })
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
    if (req.body.rightsConfirmed !== 'true') throw new HttpError(400, 'Confirm you have permission to share these photos before uploading')
    // ?album=1: a thank-you album photo (not on the public site; guests who reviewed and anyone with the share link see it).
    const kind = req.query.album ? 'album' : 'organiser'
    if (kind === 'album') await assertAlbumRoom(retreat.id, 'photo')
    const image = await processImage(req.file.buffer, req.body.takenAt)
    const id = crypto.randomUUID()
    // A slideshow image joins the album too, unless the album is already full.
    // Already in the album (the same file uploaded before): don't add a second copy of it.
    const inAlbumAlready = (await prisma.mediaAsset.findMany({
      where: { retreatId: retreat.id, removedAt: null, OR: [{ kind: 'album' }, { kind: 'organiser', inAlbum: true }] },
      select: { width: true, height: true, sizeBytes: true, videoKey: true },
    })).some((m) => sameFileKey(m) === sameFileKey({ width: image.width, height: image.height, sizeBytes: image.original.length }))
    if (kind === 'album' && inAlbumAlready) throw new HttpError(409, 'That photo is already in the album')
    const joinsAlbum = kind === 'organiser' ? !inAlbumAlready && (await albumHasPhotoRoom(retreat.id)) : true
    // A new image joins the slideshow while it has room; past MAX_SLIDESHOW it waits in "Your images".
    const joinsSlideshow = kind === 'organiser' && (await slideshowCount(retreat.id)) < MAX_SLIDESHOW
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
        takenAt: image.takenAt,
        displayOrder: count,
        // New photos go to the end of the album.
        albumOrder: (await prisma.mediaAsset.aggregate({ where: { retreatId: retreat.id, removedAt: null }, _max: { albumOrder: true } }))._max.albumOrder! + 1 || 0,
        // The upload acknowledges rights; organiser slideshow photos also join the album when space allows.
        publishConsent: true,
        moderation: 'approved',
        inHeroSlideshow: joinsSlideshow,
        inWritingSlideshow: joinsSlideshow,
        inAlbum: joinsAlbum,
      },
    })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'media.uploaded', entityType: 'media', entityId: m.id })
    res.status(201).json({ media: organiserMediaView(t.org.slug, m) })
  }),
)

// Album videos (organisers only). The browser sends the video plus a poster frame it captured.
siteRouter.post(
  '/retreats/:retreatId/album/videos',
  uploadLimiter,
  videoUpload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'poster', maxCount: 1 },
  ]),
  route(async (req, res) => {
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>
    const video = files.video?.[0]
    const poster = files.poster?.[0]
    try {
      const t = tenantOf(req)
      const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
      if (retreat.kind !== 'itinerary') throw new HttpError(400, 'Albums are for itinerary retreats')
      if (!video) throw new HttpError(400, 'Choose a video')
      if (req.body.rightsConfirmed !== 'true') throw new HttpError(400, 'Confirm you have permission to share this video before uploading')
      await assertAlbumRoom(retreat.id, 'video')
      const type = await sniffVideo(video.path)
      const meta = parseBody(
        z.object({
          width: z.coerce.number().int().min(16).max(8000).optional(),
          height: z.coerce.number().int().min(16).max(8000).optional(),
          duration: z.coerce.number().min(0).max(24 * 3600).optional(),
        }),
        req.body,
      )
      // A poster from the browser if it could make one, else a plain dark frame.
      const posterImage = poster
        ? await processImage(await readFile(poster.path))
        : await processImage(await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#183d3b' } }).jpeg().toBuffer())
      const id = crypto.randomUUID()
      const prefix = `org/${t.org.id}/retreat/${retreat.id}/album/${id}`
      // Phones record where a video was taken; the album can be public, so that never leaves here.
      // When it was filmed: the container's creation time, read first; the browser's reading otherwise.
      const filmedAt = (await videoCreationTime(video.path)) ?? sensibleTime(req.body.takenAt)
      if (type.ext !== 'webm') await stripVideoMetadata(video.path)
      await storage.putFile(`${prefix}/video.${type.ext}`, video.path, type.mime)
      await storage.put(`${prefix}/poster.webp`, posterImage.derivative, 'image/webp')
      const m = await prisma.mediaAsset.create({
        data: {
          id,
          organisationId: t.org.id,
          retreatId: retreat.id,
          kind: 'album',
          originalKey: `${prefix}/video.${type.ext}`,
          derivativeKey: `${prefix}/poster.webp`,
          videoKey: `${prefix}/video.${type.ext}`,
          mime: type.mime,
          sizeBytes: video.size,
          width: meta.width ?? posterImage.width,
          height: meta.height ?? posterImage.height,
          durationSec: meta.duration ?? null,
          takenAt: filmedAt ? new Date(filmedAt) : null,
          albumOrder: ((await prisma.mediaAsset.aggregate({ where: { retreatId: retreat.id, removedAt: null }, _max: { albumOrder: true } }))._max.albumOrder ?? -1) + 1,
          inHeroSlideshow: false,
          inWritingSlideshow: false,
          publishConsent: true,
          moderation: 'approved',
        },
      })
      await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'media.video_uploaded', entityType: 'media', entityId: m.id })
      res.status(201).json({ media: organiserMediaView(t.org.slug, m) })
    } finally {
      await Promise.all([video, poster].filter(Boolean).map((f) => rm(f!.path, { force: true })))
    }
  }),
)

/** The organiser's own preview of an album video. */
siteRouter.get(
  '/media/:mediaId/video',
  route(async (req, res) => {
    const t = tenantOf(req)
    const media = await tenantMedia(t.org.id, uuidParam(req, 'mediaId'))
    if (!media.videoKey) throw new HttpError(404, 'Not a video')
    await streamVideo(req, res, media.videoKey, media.mime, 'private, no-store')
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
    if (media.kind === 'guest') {
      // An organiser can take a guest-shared photo out of the group album (or put it back); nothing else.
      const body = parseBody(z.object({ inAlbum: z.boolean() }), req.body)
      if (!media.albumConsent) throw new HttpError(409, 'The guest hasn’t shared this photo in the album')
      const updated = await prisma.mediaAsset.update({ where: { id: media.id }, data: { inAlbum: body.inAlbum } })
      await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: body.inAlbum ? 'album.guest_photo_restored' : 'album.guest_photo_removed', entityType: 'media', entityId: media.id })
      return res.json({ media: organiserMediaView(t.org.slug, updated) })
    }
    if (media.kind === 'album') {
      // Album photos: only their caption, alt text and order change.
      const body = parseBody(mediaPatch.pick({ altText: true, caption: true, displayOrder: true }), req.body)
      const updated = await prisma.mediaAsset.update({ where: { id: media.id }, data: body })
      return res.json({ media: organiserMediaView(t.org.slug, updated) })
    }
    const body = parseBody(mediaPatch, req.body)
    if (body.inAlbum && !media.inAlbum) await assertAlbumRoom(media.retreatId, 'photo')
    if (body.inHeroSlideshow && !media.inHeroSlideshow && (await slideshowCount(media.retreatId)) >= MAX_SLIDESHOW) {
      throw new HttpError(409, `The slideshow holds up to ${MAX_SLIDESHOW} photos. Take one out first.`)
    }
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
      where: {
        organisationId: t.org.id,
        retreatId: retreat.id,
        removedAt: null,
        OR: [
          { kind: { in: ['album', 'organiser'] } },
          // Photos guests chose to share with the group (from guests who sent their review).
          { kind: 'guest', albumConsent: true, response: { submittedAt: { not: null }, status: { not: 'withdrawn' } } },
        ],
      },
      orderBy: [{ albumOrder: 'asc' }, { createdAt: 'asc' }],
    })
    const limits = await albumLimits()
    const usage = await albumUsage(retreat.id)
    // Later copies of a picture already in the album are marked, so the organiser can delete them.
    const firstOf = new Map<string, string>()
    const duplicateOf = new Map<string, string>()
    for (const m of media) {
      if (!(m.kind === 'album' || m.inAlbum)) continue
      const key = sameFileKey(m)
      const first = firstOf.get(key)
      if (first) duplicateOf.set(m.id, first)
      else firstOf.set(key, m.id)
    }
    res.json({
      limits,
      usage,
      duplicates: Object.fromEntries(duplicateOf),
      coverId: retreat.rewardAlbumCoverId,
      pageUrl: retreat.kind === 'itinerary' ? sharePath(await ensureShareToken(retreat)) : null,
      media: media.map((m) => organiserMediaView(t.org.slug, m)),
    })
  }),
)

/** A new album link; the old one stops working. */
siteRouter.post(
  '/retreats/:retreatId/album/share-link',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const token = await resetShareToken(retreat.id)
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'album.share_link_reset', entityType: 'retreat', entityId: retreat.id })
    res.json({ pageUrl: sharePath(token) })
  }),
)

siteRouter.put(
  '/retreats/:retreatId/album/order',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const { ids } = parseBody(z.object({ ids: z.array(z.uuid()).max(2000) }), req.body)
    const owned = new Set(
      (await prisma.mediaAsset.findMany({ where: { retreatId: retreat.id, id: { in: ids }, kind: { in: ['album', 'organiser', 'guest'] } }, select: { id: true } })).map((m) => m.id),
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

/**
 * Empties the album in one go: album uploads are deleted; images from "Your images" and guests'
 * photos are only taken out of it (they stay where they came from). The title photo is cleared.
 */
siteRouter.post(
  '/retreats/:retreatId/album/clear',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const uploads = await prisma.mediaAsset.findMany({ where: { organisationId: t.org.id, retreatId: retreat.id, kind: 'album', removedAt: null } })
    const now = new Date()
    const [, takenOut] = await prisma.$transaction([
      prisma.mediaAsset.updateMany({ where: { id: { in: uploads.map((m) => m.id) } }, data: { removedAt: now } }),
      prisma.mediaAsset.updateMany({ where: { organisationId: t.org.id, retreatId: retreat.id, kind: { in: ['organiser', 'guest'] }, removedAt: null, inAlbum: true }, data: { inAlbum: false } }),
      prisma.retreat.update({ where: { id: retreat.id }, data: { rewardAlbumCoverId: null } }),
    ])
    await removeObjects(uploads.flatMap((m) => [m.originalKey, m.derivativeKey, m.videoKey]))
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'album.cleared', entityType: 'retreat', entityId: retreat.id, metadata: { deleted: uploads.length, takenOut: takenOut.count } })
    res.json({ deleted: uploads.length, takenOut: takenOut.count })
  }),
)

/** Deletes every image in "Your images" (the slideshow's photos) in one go; those in the album leave it too. */
siteRouter.post(
  '/retreats/:retreatId/media/clear',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const images = await prisma.mediaAsset.findMany({ where: { organisationId: t.org.id, retreatId: retreat.id, kind: 'organiser', removedAt: null } })
    const ids = images.map((m) => m.id)
    await prisma.$transaction([
      prisma.mediaAsset.updateMany({ where: { id: { in: ids } }, data: { removedAt: new Date(), inHeroSlideshow: false, inWritingSlideshow: false, inAlbum: false } }),
      ...(retreat.rewardAlbumCoverId && ids.includes(retreat.rewardAlbumCoverId) ? [prisma.retreat.update({ where: { id: retreat.id }, data: { rewardAlbumCoverId: null } })] : []),
    ])
    await removeObjects(images.flatMap((m) => [m.originalKey, m.derivativeKey, m.videoKey]))
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'media.cleared', entityType: 'retreat', entityId: retreat.id, metadata: { deleted: ids.length } })
    res.json({ deleted: ids.length })
  }),
)

siteRouter.delete(
  '/media/:mediaId',
  route(async (req, res) => {
    const t = tenantOf(req)
    const media = await tenantMedia(t.org.id, uuidParam(req, 'mediaId'))
    if (media.kind === 'guest') throw new HttpError(403, 'Guest photos cannot be deleted here')
    await prisma.mediaAsset.update({ where: { id: media.id }, data: { removedAt: new Date(), inHeroSlideshow: false, inWritingSlideshow: false } })
    await removeObjects([media.originalKey, media.derivativeKey, media.videoKey])
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'media.removed', entityType: 'media', entityId: media.id })
    res.status(204).end()
  }),
)
