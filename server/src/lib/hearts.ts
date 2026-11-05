import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { authSecret } from './env.js'
import { HttpError } from './http.js'
import { prisma } from './prisma.js'

/**
 * Hearts on album photos, for anyone, signed in or not.
 *
 * Abuse controls, none of which store anything about the visitor:
 *   - Each browser keeps a random visitor ID (local storage). Only an HMAC of it is stored, so one
 *     browser gives at most one heart per photo, and tapping again takes it back.
 *   - A per-IP rate limit on heart requests (express-rate-limit, in memory).
 *   - A per-IP, per-photo daily cap, held in memory as a hash (never the IP), so clearing local
 *     storage to heart the same photo over and over stops after a few goes.
 */

export const voterSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/, 'Invalid visitor id')

export const voterHash = (voter: string) => createHmac('sha256', authSecret).update(`heart:${voter}`).digest('base64url')

const DAY_MS = 24 * 60 * 60 * 1000
const PER_PHOTO_PER_IP = 5
const seen = new Map<string, { n: number; until: number }>()

/** Counts a new heart from this IP for this photo; refuses once the daily cap is reached. */
export function checkIpPhotoCap(ip: string | undefined, photoId: string) {
  const key = createHmac('sha256', authSecret).update(`heart-ip:${ip ?? 'unknown'}:${photoId}`).digest('base64url')
  const now = Date.now()
  const entry = seen.get(key)
  if (!entry || entry.until < now) {
    seen.set(key, { n: 1, until: now + DAY_MS })
  } else if (entry.n >= PER_PHOTO_PER_IP) {
    throw new HttpError(429, 'You’ve hearted this photo plenty today. Please try again tomorrow.')
  } else {
    entry.n += 1
  }
  // Keep memory bounded: drop expired entries now and then.
  if (seen.size > 50_000) for (const [k, v] of seen) if (v.until < now) seen.delete(k)
}

/** Test hook: forget the in-memory caps. */
export function resetHeartCaps() {
  seen.clear()
}

/** Heart counts for these photos. */
export async function heartCounts(photoIds: string[]) {
  if (!photoIds.length) return new Map<string, number>()
  const rows = await prisma.photoHeart.groupBy({ by: ['photoId'], where: { photoId: { in: photoIds } }, _count: { _all: true } })
  return new Map(rows.map((r) => [r.photoId, r._count._all]))
}

/** Which of these photos this visitor has hearted. */
export async function heartedBy(voter: string, photoIds: string[]) {
  if (!photoIds.length) return []
  const rows = await prisma.photoHeart.findMany({ where: { voterHash: voterHash(voter), photoId: { in: photoIds } }, select: { photoId: true } })
  return rows.map((r) => r.photoId)
}

/** Adds or removes this visitor's heart; returns the new count. */
export async function setHeart(photoId: string, voter: string, on: boolean, ip: string | undefined) {
  const hash = voterHash(voter)
  if (on) {
    const existing = await prisma.photoHeart.findUnique({ where: { photoId_voterHash: { photoId, voterHash: hash } } })
    if (!existing) {
      checkIpPhotoCap(ip, photoId)
      await prisma.photoHeart.create({ data: { photoId, voterHash: hash } }).catch(() => undefined) // a double tap races harmlessly
    }
  } else {
    await prisma.photoHeart.deleteMany({ where: { photoId, voterHash: hash } })
  }
  return prisma.photoHeart.count({ where: { photoId } })
}
