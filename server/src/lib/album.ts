import type { Response as ExpressResponse } from 'express'
import type { Prisma } from '@prisma/client'
import sharp from 'sharp'
import { CONSENT_WORDING_VERSION } from '../../../shared/categories.js'
import { altFor } from './altText.js'
import { env } from './env.js'
import { HttpError } from './http.js'
import { processImage } from './images.js'
import { newToken } from './tokens.js'
import { prisma } from './prisma.js'
import { storage } from './storage.js'

/**
 * The group photo album (itinerary retreats). Unlocked by sending a review, any review, whatever the
 * guest chooses to share or rate. It is never tied to publication consent or a rating. It holds the
 * organiser's album uploads and images, plus photos guests chose to share with the group (opt-in,
 * per photo). It is never listed or indexed. Guests who sent a review reach it through their own private
 * link or sign-in; anyone else needs the album's share link (/album/<random token>), which needs no sign-in
 * and can be replaced by the organiser to stop the old one working.
 */
type RetreatLike = {
  id: string
  title: string
  kind: 'itinerary' | 'property'
  rewardAlbumEnabled: boolean
  rewardAlbumUrl: string | null
  rewardAlbumNote: string
  rewardAlbumCoverId: string | null
  albumShareToken?: string | null
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

/** The album's share token, created the first time anyone asks for it. */
export async function ensureShareToken(retreat: { id: string; albumShareToken?: string | null }) {
  if (retreat.albumShareToken) return retreat.albumShareToken
  const token = newToken(24)
  // Only set it if still empty, so two first requests at once end up with the same link.
  await prisma.retreat.updateMany({ where: { id: retreat.id, albumShareToken: null }, data: { albumShareToken: token } })
  return (await prisma.retreat.findUniqueOrThrow({ where: { id: retreat.id }, select: { albumShareToken: true } })).albumShareToken!
}

/** Replaces the share link; the old one stops working at once. */
export async function resetShareToken(retreatId: string) {
  const token = newToken(24)
  await prisma.retreat.update({ where: { id: retreatId }, data: { albumShareToken: token } })
  return token
}

export const sharePath = (token: string) => `/album/${token}`

/** The retreat behind a share link, if the link is current and the album is on. */
export async function sharedRetreat(token: string) {
  const retreat = token.length >= 16 && token.length <= 64 ? await prisma.retreat.findUnique({ where: { albumShareToken: token } }) : null
  if (!retreat || !available(retreat)) throw new HttpError(404, 'This album link isn’t valid any more. Ask the person who shared it for a new one.')
  return retreat
}

/** The full album, for its own page. With no response, it is being viewed through the share link. */
export async function albumListing(retreat: RetreatLike, response: ResponseLike, base: string, viaShareLink = false) {
  if (!available(retreat)) throw new HttpError(404, 'There is no photo album for this retreat')
  if (!viaShareLink && !isUnlocked(response)) throw new HttpError(403, 'Send your review to unlock the photo album')
  const photos = await albumPhotos(retreat.id, retreat.rewardAlbumCoverId)
  return {
    shareUrl: sharePath(await ensureShareToken(retreat)),
    title: retreat.title,
    note: retreat.rewardAlbumNote || null,
    url: retreat.rewardAlbumUrl,
    coverId: photos[0] && photos[0].id === retreat.rewardAlbumCoverId ? photos[0].id : null,
    canContribute: !viaShareLink,
    photos: photos.map((p) => ({
      id: p.id,
      url: `${base}/album/${p.id}`,
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

/** A full album photo, for a guest who has sent their review or someone with the share link. Never cached by shared caches. */
export async function sendAlbumPhoto(res: ExpressResponse, retreat: RetreatLike, response: ResponseLike, photoId: string, viaShareLink = false) {
  if (!available(retreat) || (!viaShareLink && !isUnlocked(response))) throw new HttpError(403, 'Send your review to unlock the photo album')
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
