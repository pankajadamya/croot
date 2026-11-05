import type { Response as ExpressResponse } from 'express'
import type { Prisma } from '@prisma/client'
import sharp from 'sharp'
import { CONSENT_WORDING_VERSION } from '../../../shared/categories.js'
import { altFor } from './altText.js'
import { env } from './env.js'
import { HttpError } from './http.js'
import { processImage } from './images.js'
import { prisma } from './prisma.js'
import { storage } from './storage.js'

/**
 * The group photo album (itinerary retreats). Unlocked by sending a review, any review, whatever the
 * guest chooses to share or rate. It is never tied to publication consent or a rating. It holds the
 * organiser's album uploads and images, plus photos guests chose to share with the group (opt-in,
 * per photo, knowing it's public). It is part of the retreat's public site: anyone can view it at
 * /o/<organisation>/r/<retreat>/album without signing in, and it's linked from the retreat and story pages.
 * Guests who sent a review can also add photos to it.
 */
type RetreatLike = {
  id: string
  title: string
  kind: 'itinerary' | 'property'
  rewardAlbumEnabled: boolean
  rewardAlbumUrl: string | null
  rewardAlbumNote: string
  rewardAlbumCoverId: string | null
  organisationId: string
}
type ResponseLike = { id: string; submittedAt: Date | null; status: string } | null | undefined

const TEASER_COUNT = 3
const MAX_CONTRIBUTIONS = 30

/** What belongs in a retreat's album. Guest photos only from guests who sent (and haven't withdrawn) a review. */
function albumWhere(retreatId: string): Prisma.MediaAssetWhereInput {
  return {
    retreatId,
    removedAt: null,
    OR: [
      { kind: 'album' },
      { kind: 'organiser', inAlbum: true },
      { kind: 'guest', albumConsent: true, inAlbum: true, response: { submittedAt: { not: null }, status: { not: 'withdrawn' } } },
    ],
  }
}

/** In the organiser's order, with the title photo first. */
export async function albumPhotos(retreatId: string, coverId: string | null = null) {
  const photos = await prisma.mediaAsset.findMany({ where: albumWhere(retreatId), orderBy: [{ albumOrder: 'asc' }, { createdAt: 'asc' }] })
  const cover = coverId ? photos.find((p) => p.id === coverId) : undefined
  return cover ? [cover, ...photos.filter((p) => p !== cover)] : photos
}

export function isUnlocked(response: ResponseLike) {
  return Boolean(response?.submittedAt && response.status !== 'withdrawn')
}

function available(retreat: RetreatLike) {
  return retreat.kind === 'itinerary' && retreat.rewardAlbumEnabled
}

/** What the review screens show: a blurred teaser before sending; a link card (with the title photo) after. */
export async function albumSummary(retreat: RetreatLike, response: ResponseLike, base: string) {
  if (!available(retreat)) return null
  const photos = await albumPhotos(retreat.id, retreat.rewardAlbumCoverId)
  if (!photos.length && !retreat.rewardAlbumUrl) return null
  const unlocked = isUnlocked(response)
  return {
    unlocked,
    photoCount: photos.length,
    teaser: photos.slice(0, TEASER_COUNT).map((p) => `${base}/album/teaser/${p.id}`),
    cover: unlocked && photos[0] ? `${base}/album/${photos[0].id}` : null,
    note: unlocked ? retreat.rewardAlbumNote || null : null,
    url: unlocked ? retreat.rewardAlbumUrl : null,
  }
}

/** The album's public page: part of the retreat's public site, open to anyone without signing in. */
export const albumPagePath = (orgSlug: string, retreatSlug: string) => `/o/${orgSlug}/r/${retreatSlug}/album`
const publicPhotoBase = (orgSlug: string, retreatSlug: string) => `/api/public/orgs/${orgSlug}/retreats/${retreatSlug}/album`

/** For the public retreat and story pages: a link to the album, led by its title photo. */
export async function publicAlbumLink(retreat: RetreatLike & { slug: string }, orgSlug: string) {
  if (!available(retreat)) return null
  const photos = await albumPhotos(retreat.id, retreat.rewardAlbumCoverId)
  if (!photos.length) return null
  const base = publicPhotoBase(orgSlug, retreat.slug)
  return {
    url: albumPagePath(orgSlug, retreat.slug),
    count: photos.length,
    cover: `${base}/${photos[0].id}`,
    preview: photos.slice(1, 4).map((p) => `${base}/${p.id}`),
  }
}

/**
 * The full album, for its own page. Public visitors (no response) can view it; adding photos stays
 * with guests who sent a review. `pagePath` is the album's public address, for sharing.
 */
export async function albumListing(retreat: RetreatLike, response: ResponseLike, base: string, opts: { pagePath: string; publicView?: boolean }) {
  if (!available(retreat)) throw new HttpError(404, 'There is no photo album for this retreat')
  if (!opts.publicView && !isUnlocked(response)) throw new HttpError(403, 'Send your review to unlock the photo album')
  const photos = await albumPhotos(retreat.id, retreat.rewardAlbumCoverId)
  return {
    pageUrl: opts.pagePath,
    title: retreat.title,
    note: retreat.rewardAlbumNote || null,
    url: retreat.rewardAlbumUrl,
    coverId: photos[0] && photos[0].id === retreat.rewardAlbumCoverId ? photos[0].id : null,
    canContribute: !opts.publicView && isUnlocked(response),
    photos: photos.map((p) => ({
      id: p.id,
      url: opts.publicView ? `${base}/${p.id}` : `${base}/album/${p.id}`,
      alt: altFor(p, p.kind === 'guest' ? 'Photo shared by a guest' : 'Retreat photo'),
      caption: p.caption,
      width: p.width,
      height: p.height,
      sharedByGuest: p.kind === 'guest',
      mine: Boolean(response && p.responseId === response.id),
    })),
  }
}

async function photoOf(retreatId: string, photoId: string) {
  const photo = await prisma.mediaAsset.findFirst({ where: { ...albumWhere(retreatId), id: photoId } })
  if (!photo) throw new HttpError(404, 'Photo not found')
  const bytes = await storage.get(photo.derivativeKey)
  if (!bytes) throw new HttpError(404, 'Photo not found')
  return { photo, bytes }
}

/** A full album photo: public on the album page, or through a guest's own link once they've reviewed. */
export async function sendAlbumPhoto(res: ExpressResponse, retreat: RetreatLike, response: ResponseLike, photoId: string, publicView = false) {
  if (!available(retreat) || (!publicView && !isUnlocked(response))) throw new HttpError(403, 'Send your review to unlock the photo album')
  const { bytes } = await photoOf(retreat.id, photoId)
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' }).send(bytes)
}

/** A tiny, heavily blurred preview of one of the first album photos. Nothing recognisable survives. */
export async function sendTeaser(res: ExpressResponse, retreat: RetreatLike, photoId: string) {
  if (!available(retreat)) throw new HttpError(404, 'Not found')
  const first = (await albumPhotos(retreat.id, retreat.rewardAlbumCoverId)).slice(0, TEASER_COUNT).map((p) => p.id)
  if (!first.includes(photoId)) throw new HttpError(404, 'Not found')
  const { bytes } = await photoOf(retreat.id, photoId)
  const blurred = await sharp(bytes).resize(48, 48, { fit: 'cover' }).blur(6).webp({ quality: 50 }).toBuffer()
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600' }).send(blurred)
}

async function nextAlbumOrder(retreatId: string) {
  const max = (await prisma.mediaAsset.aggregate({ where: { retreatId, removedAt: null }, _max: { albumOrder: true } }))._max.albumOrder
  return (max ?? -1) + 1
}

async function recordAlbumConsent(response: { id: string; organisationId: string }, photoId: string, granted: boolean) {
  await prisma.consentEvent.create({
    data: { organisationId: response.organisationId, responseId: response.id, scope: `album_photo:${photoId}`, granted, wordingVersion: CONSENT_WORDING_VERSION, actor: 'attendee' },
  })
}

/** Switches group-album sharing on or off for one of the guest's own photos. */
export async function setAlbumSharing(response: { id: string; organisationId: string; retreatId: string }, photoId: string, share: boolean) {
  const photo = await prisma.mediaAsset.findFirst({ where: { id: photoId, responseId: response.id, kind: 'guest', removedAt: null } })
  if (!photo) throw new HttpError(404, 'Photo not found')
  if (photo.albumConsent === share) return photo
  const updated = await prisma.mediaAsset.update({
    where: { id: photo.id },
    data: { albumConsent: share, ...(share ? { albumOrder: await nextAlbumOrder(response.retreatId), inAlbum: true } : {}) },
  })
  await recordAlbumConsent(response, photo.id, share)
  return updated
}

/** A guest adds a photo straight to the album: uploading there is their choice to share it with the group. */
export async function addContribution(retreat: RetreatLike, response: ResponseLike, file: Buffer) {
  if (!available(retreat) || !isUnlocked(response) || !response) throw new HttpError(403, 'Send your review to add photos to the album')
  const already = await prisma.mediaAsset.count({ where: { responseId: response.id, albumConsent: true, removedAt: null } })
  if (already >= MAX_CONTRIBUTIONS) throw new HttpError(409, `You can share up to ${MAX_CONTRIBUTIONS} photos in the album`)
  const image = await processImage(file)
  const id = crypto.randomUUID()
  const prefix = `org/${retreat.organisationId}/retreat/${retreat.id}/guest/${id}`
  await storage.put(`${prefix}/original`, image.original, image.originalMime)
  await storage.put(`${prefix}/web.webp`, image.derivative, 'image/webp')
  const asset = await prisma.mediaAsset.create({
    data: {
      id,
      organisationId: retreat.organisationId,
      retreatId: retreat.id,
      responseId: response.id,
      kind: 'guest',
      originalKey: `${prefix}/original`,
      derivativeKey: `${prefix}/web.webp`,
      mime: image.originalMime,
      sizeBytes: image.original.length,
      width: image.width,
      height: image.height,
      albumConsent: true,
      albumOrder: await nextAlbumOrder(retreat.id),
    },
  })
  await recordAlbumConsent({ id: response.id, organisationId: retreat.organisationId }, asset.id, true)
  return asset
}

export const MAX_ALBUM_UPLOAD_BYTES = env.MAX_UPLOAD_BYTES
