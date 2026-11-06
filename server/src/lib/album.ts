import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import type { Prisma } from '@prisma/client'
import sharp from 'sharp'
import { CONSENT_WORDING_VERSION, FIRST_NAME_CREDITS_FROM, wordingVersionNumber } from '../../../shared/categories.js'
import { firstName } from '../../../shared/slug.js'
import { altFor } from './altText.js'
import { env } from './env.js'
import { HttpError } from './http.js'
import { heartCounts } from './hearts.js'
import { processImage } from './images.js'
import { newToken } from './tokens.js'
import { streamVideo } from './video.js'
import { prisma } from './prisma.js'
import { storage } from './storage.js'

/**
 * The retreat's photo album (itinerary retreats). It holds the organiser's album uploads and images, plus
 * photos guests chose to share in it (opt-in, per photo), which appear once the organiser approves them.
 * Anyone with the album's unguessable link (/album/<token>) can view it without signing in; it isn't
 * linked from the public pages. Guests get the link when they send their review (any review, whatever
 * they share or rate) and can add photos to it.
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
  /** For the memory film's title card and music. */
  startDate?: Date | null
  endDate?: Date | null
  organiserName?: string
  filmMusic?: string
  filmStyle?: string
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
      // Guests' photos: shared by them, approved by the organiser, from a review that was sent.
      { kind: 'guest', albumConsent: true, inAlbum: true, moderation: 'approved', response: { submittedAt: { not: null }, status: { not: 'withdrawn' } } },
    ],
  }
}

/** In the organiser's order, with the title photo first. */
export async function albumPhotos(retreatId: string, coverId: string | null = null) {
  const photos = await prisma.mediaAsset.findMany({
    where: albumWhere(retreatId),
    orderBy: [{ albumOrder: 'asc' }, { createdAt: 'asc' }],
    // For guests' photos: whether they agreed to be credited by first name.
    include: { response: { select: { consentFirstName: true, consentWordingVersion: true, attendee: { select: { name: true } } } } },
  })
  const cover = coverId ? photos.find((p) => p.id === coverId) : undefined
  return withoutDuplicates(cover ? [cover, ...photos.filter((p) => p !== cover)] : photos)
}

/**
 * The same picture uploaded twice (say, to the slideshow, which also adds it to the album, and then
 * to the album itself) gives byte-identical stored copies: same size and dimensions. The album and
 * its memory film show it once, at its first place.
 */
export const sameFileKey = (m: { width: number; height: number; sizeBytes: number; videoKey?: string | null }) =>
  `${m.videoKey ? 'video' : 'photo'}:${m.width}x${m.height}:${m.sizeBytes}`
export function withoutDuplicates<T extends { width: number; height: number; sizeBytes: number; videoKey?: string | null }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((m) => {
    const key = sameFileKey(m)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

/**
 * Who a photo is credited to. A guest's photo names them only if they agreed to show their first
 * name under wording that covers album credits (v9 on); otherwise it says a guest shared it.
 * The organiser's photos carry the credit the organiser typed, if any.
 */
export function creditFor(p: {
  kind: string
  credit: string
  response?: { consentFirstName: boolean; consentWordingVersion: string | null; attendee: { name: string } } | null
}): string | null {
  if (p.kind !== 'guest') return p.credit || null
  const r = p.response
  const named = r?.consentFirstName && wordingVersionNumber(r.consentWordingVersion) >= FIRST_NAME_CREDITS_FROM && r.attendee.name.trim()
  return named ? firstName(r.attendee.name) : 'a guest'
}

/** The album's link token, created the first time anyone asks for it. */
export async function ensureShareToken(retreat: { id: string; albumShareToken?: string | null }) {
  if (retreat.albumShareToken) return retreat.albumShareToken
  // Only set if still empty, so two first requests at once end up with the same link.
  await prisma.retreat.updateMany({ where: { id: retreat.id, albumShareToken: null }, data: { albumShareToken: newToken(24) } })
  return (await prisma.retreat.findUniqueOrThrow({ where: { id: retreat.id }, select: { albumShareToken: true } })).albumShareToken!
}

/** A new link; the old one stops working at once. */
export async function resetShareToken(retreatId: string) {
  const token = newToken(24)
  await prisma.retreat.update({ where: { id: retreatId }, data: { albumShareToken: token } })
  return token
}

export const sharePath = (token: string) => `/album/${token}`

/** For the top of the public retreat page: a card linking to the album, led by its title photo. */
export async function publicAlbumLink(retreat: RetreatLike) {
  if (!available(retreat)) return null
  const photos = await albumPhotos(retreat.id, retreat.rewardAlbumCoverId)
  if (!photos.length) return null
  const token = await ensureShareToken(retreat)
  const api = `/api/albums/${token}`
  return {
    url: sharePath(token),
    count: photos.length,
    cover: `${api}/${photos[0].id}`,
    preview: photos.slice(1, 4).map((ph) => `${api}/${ph.id}`),
  }
}
export const shareApi = (token: string) => `/api/albums/${token}`

/** The retreat behind an album link, if the link is current and the album is on. */
export async function sharedRetreat(token: string) {
  const retreat =
    token.length >= 16 && token.length <= 64
      ? await prisma.retreat.findUnique({ where: { albumShareToken: token }, include: { organisation: { select: { name: true, slug: true, status: true } } } })
      : null
  if (!retreat || !available(retreat) || retreat.organisation.status !== 'active' || retreat.status === 'draft' || retreat.status === 'archived') {
    throw new HttpError(404, 'This album link isn’t valid any more. Ask the person who shared it for a new one.')
  }
  return retreat
}

/**
 * The full album, for its own page. Anyone with the link (no response) can view it; adding photos stays
 * with guests who sent a review. Photos, videos and hearts always go through the album link.
 */
export async function albumListing(
  retreat: RetreatLike,
  response: ResponseLike,
  base: string,
  opts: { publicView?: boolean; orgName?: string; retreatPath?: string | null } = {},
) {
  if (!available(retreat)) throw new HttpError(404, 'There is no photo album for this retreat')
  if (!opts.publicView && !isUnlocked(response)) throw new HttpError(403, 'Send your review to unlock the photo album')
  const photos = await albumPhotos(retreat.id, retreat.rewardAlbumCoverId)
  const hearts = await heartCounts(photos.map((p) => p.id))
  const token = await ensureShareToken(retreat)
  const api = shareApi(token)
  return {
    pageUrl: sharePath(token),
    heartsApi: api,
    orgName: opts.orgName ?? null,
    retreatPath: opts.retreatPath ?? null,
    title: retreat.title,
    note: retreat.rewardAlbumNote || null,
    url: retreat.rewardAlbumUrl,
    coverId: photos[0] && photos[0].id === retreat.rewardAlbumCoverId ? photos[0].id : null,
    canContribute: !opts.publicView && isUnlocked(response),
    // The memory film plays exactly these photos and videos, in this order (src/components/MemoryFilm.tsx).
    film: {
      music: retreat.filmMusic ?? 'calm',
      style: retreat.filmStyle ?? 'mix',
      startDate: retreat.startDate ?? null,
      endDate: retreat.endDate ?? null,
      organiser: retreat.organiserName || opts.orgName || null,
    },
    photos: photos.map((p) => ({
      id: p.id,
      url: opts.publicView ? `${api}/${p.id}` : `${base}/album/${p.id}`,
      alt: altFor(p, p.kind === 'guest' ? 'Photo shared by a guest' : 'Retreat photo'),
      caption: p.caption,
      credit: creditFor(p),
      width: p.width,
      height: p.height,
      sharedByGuest: p.kind === 'guest',
      mine: Boolean(response && p.responseId === response.id),
      hearts: hearts.get(p.id) ?? 0,
      video: p.videoKey ? `${api}/${p.id}/video` : null,
      duration: p.durationSec,
      focalX: p.focalX,
      focalY: p.focalY,
    })),
  }
}

/** An album video, streamed with Range support, for anyone with the album link. */
export async function sendAlbumVideo(req: ExpressRequest, res: ExpressResponse, retreat: RetreatLike, id: string) {
  if (!available(retreat)) throw new HttpError(404, 'There is no photo album for this retreat')
  const item = await prisma.mediaAsset.findFirst({ where: { ...albumWhere(retreat.id), id, videoKey: { not: null } } })
  if (!item?.videoKey) throw new HttpError(404, 'Video not found')
  await streamVideo(req, res, item.videoKey, item.mime, 'private, max-age=3600')
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
export async function addContribution(retreat: RetreatLike, response: ResponseLike, file: Buffer, takenAtHint?: unknown) {
  if (!available(retreat) || !isUnlocked(response) || !response) throw new HttpError(403, 'Send your review to add photos to the album')
  const already = await prisma.mediaAsset.count({ where: { responseId: response.id, albumConsent: true, removedAt: null } })
  if (already >= MAX_CONTRIBUTIONS) throw new HttpError(409, `You can share up to ${MAX_CONTRIBUTIONS} photos in the album`)
  const image = await processImage(file, takenAtHint)
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
      takenAt: image.takenAt,
      albumConsent: true,
      albumOrder: await nextAlbumOrder(retreat.id),
    },
  })
  await recordAlbumConsent({ id: response.id, organisationId: retreat.organisationId }, asset.id, true)
  return asset
}

export const MAX_ALBUM_UPLOAD_BYTES = env.MAX_UPLOAD_BYTES
