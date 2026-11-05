import { HttpError } from './http.js'
import { prisma } from './prisma.js'

export interface AlbumLimits {
  maxPhotos: number
  maxVideos: number
}

/** Platform-wide settings, edited on the Admin screen (a single row, made on first use). */
export async function platformSettings() {
  return prisma.platformSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} })
}

export async function albumLimits(): Promise<AlbumLimits> {
  const s = await platformSettings()
  return { maxPhotos: s.albumMaxPhotos, maxVideos: s.albumMaxVideos }
}

/**
 * What the organiser has put in a retreat's album: their album uploads plus earlier images they kept
 * in it. Guests' shared photos don't count towards the limit.
 */
export async function albumUsage(retreatId: string) {
  // One after another: the local database takes a single query at a time.
  const albumPhotos = await prisma.mediaAsset.count({ where: { retreatId, kind: 'album', videoKey: null, removedAt: null } })
  const keptImages = await prisma.mediaAsset.count({ where: { retreatId, kind: 'organiser', inAlbum: true, removedAt: null } })
  const videos = await prisma.mediaAsset.count({ where: { retreatId, kind: 'album', videoKey: { not: null }, removedAt: null } })
  return { photos: albumPhotos + keptImages, videos }
}

/** Refuses another album photo or video once the retreat's album is at its limit. */
export async function assertAlbumRoom(retreatId: string, what: 'photo' | 'video') {
  const limits = await albumLimits()
  const usage = await albumUsage(retreatId)
  if (what === 'photo' && usage.photos >= limits.maxPhotos) {
    throw new HttpError(409, `The album already has ${limits.maxPhotos} photos, the most it can hold. Take one out to add another.`)
  }
  if (what === 'video' && usage.videos >= limits.maxVideos) {
    throw new HttpError(409, `The album already has ${limits.maxVideos} video${limits.maxVideos === 1 ? '' : 's'}, the most it can hold. Take one out to add another.`)
  }
}

/** Whether there's room for one more photo (used when a new slideshow image would join the album). */
export async function albumHasPhotoRoom(retreatId: string) {
  const limits = await albumLimits()
  const usage = await albumUsage(retreatId)
  return usage.photos < limits.maxPhotos
}
