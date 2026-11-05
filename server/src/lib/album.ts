import type { Response as ExpressResponse } from 'express'
import sharp from 'sharp'
import { altFor } from './altText.js'
import { HttpError } from './http.js'
import { prisma } from './prisma.js'
import { storage } from './storage.js'

/**
 * The thank-you photo album (itinerary retreats). Unlocked by sending a review: any review, whatever the
 * guest chooses to share or rate. It is never tied to publication consent or a rating. Album photos are
 * never public: only guests who have sent a review can fetch them, through their own link or sign-in.
 */
type RetreatLike = {
  id: string
  kind: 'itinerary' | 'property'
  rewardAlbumEnabled: boolean
  rewardAlbumUrl: string | null
  rewardAlbumNote: string
  rewardAlbumCoverId: string | null
}
type ResponseLike = { submittedAt: Date | null; status: string } | null | undefined

const TEASER_COUNT = 3

/**
 * The album: photos uploaded for it, plus the organiser's own images (from 'Your images') unless taken
 * out of the album. In the organiser's chosen order, with the title photo first.
 */
export async function albumPhotos(retreatId: string, coverId: string | null = null) {
  const photos = await prisma.mediaAsset.findMany({
    where: { retreatId, removedAt: null, OR: [{ kind: 'album' }, { kind: 'organiser', inAlbum: true }] },
    orderBy: [{ albumOrder: 'asc' }, { createdAt: 'asc' }],
  })
  const cover = coverId ? photos.find((p) => p.id === coverId) : undefined
  return cover ? [cover, ...photos.filter((p) => p !== cover)] : photos
}

export function isUnlocked(response: ResponseLike) {
  return Boolean(response?.submittedAt && response.status !== 'withdrawn')
}

/** What the guest sees about the album: a teaser before sending, the album itself after. */
export async function albumSummary(retreat: RetreatLike, response: ResponseLike, base: string) {
  if (retreat.kind !== 'itinerary' || !retreat.rewardAlbumEnabled) return null
  const photos = await albumPhotos(retreat.id, retreat.rewardAlbumCoverId)
  if (!photos.length && !retreat.rewardAlbumUrl) return null
  const unlocked = isUnlocked(response)
  return {
    unlocked,
    photoCount: photos.length,
    teaser: photos.slice(0, TEASER_COUNT).map((p) => `${base}/album/teaser/${p.id}`),
    note: unlocked ? retreat.rewardAlbumNote || null : null,
    url: unlocked ? retreat.rewardAlbumUrl : null,
  }
}

export async function albumListing(retreat: RetreatLike, response: ResponseLike, base: string) {
  if (retreat.kind !== 'itinerary' || !retreat.rewardAlbumEnabled) throw new HttpError(404, 'There is no photo album for this retreat')
  if (!isUnlocked(response)) throw new HttpError(403, 'Send your review to unlock the photo album')
  const photos = await albumPhotos(retreat.id, retreat.rewardAlbumCoverId)
  return {
    note: retreat.rewardAlbumNote || null,
    url: retreat.rewardAlbumUrl,
    coverId: photos[0] && photos[0].id === retreat.rewardAlbumCoverId ? photos[0].id : null,
    photos: photos.map((p) => ({ id: p.id, url: `${base}/album/${p.id}`, alt: altFor(p), caption: p.caption, width: p.width, height: p.height })),
  }
}

async function photoOf(retreatId: string, photoId: string) {
  const photo = await prisma.mediaAsset.findFirst({
    where: { id: photoId, retreatId, removedAt: null, OR: [{ kind: 'album' }, { kind: 'organiser', inAlbum: true }] },
  })
  if (!photo) throw new HttpError(404, 'Photo not found')
  const bytes = await storage.get(photo.derivativeKey)
  if (!bytes) throw new HttpError(404, 'Photo not found')
  return { photo, bytes }
}

/** A full album photo, for a guest who has sent their review. Never cached by shared caches. */
export async function sendAlbumPhoto(res: ExpressResponse, retreat: RetreatLike, response: ResponseLike, photoId: string) {
  if (retreat.kind !== 'itinerary' || !retreat.rewardAlbumEnabled || !isUnlocked(response)) throw new HttpError(403, 'Send your review to unlock the photo album')
  const { bytes } = await photoOf(retreat.id, photoId)
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600', 'Content-Disposition': 'inline' }).send(bytes)
}

/**
 * A tiny, heavily blurred preview of one of the first album photos, so the invitation can tempt
 * without giving the album away. Nothing recognisable survives at this size.
 */
export async function sendTeaser(res: ExpressResponse, retreat: RetreatLike, photoId: string) {
  if (retreat.kind !== 'itinerary' || !retreat.rewardAlbumEnabled) throw new HttpError(404, 'Not found')
  const first = (await albumPhotos(retreat.id, retreat.rewardAlbumCoverId)).slice(0, TEASER_COUNT).map((p) => p.id)
  if (!first.includes(photoId)) throw new HttpError(404, 'Not found')
  const { bytes } = await photoOf(retreat.id, photoId)
  const blurred = await sharp(bytes).resize(48, 48, { fit: 'cover' }).blur(6).webp({ quality: 50 }).toBuffer()
  res.set({ 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=3600' }).send(blurred)
}
