import { checkIpPhotoCap, voterHash } from './hearts.js'
import { prisma } from './prisma.js'

/**
 * "Found this review helpful" votes, for anyone, signed in or not. The same abuse controls as hearts
 * (see hearts.ts): one vote per browser (only an HMAC of its random visitor id is stored), a per-IP
 * rate limit, and a per-IP, per-review daily cap held in memory only.
 */

export async function helpfulCounts(responseIds: string[]) {
  if (!responseIds.length) return new Map<string, number>()
  const rows = await prisma.reviewHelpful.groupBy({ by: ['responseId'], where: { responseId: { in: responseIds } }, _count: { _all: true } })
  return new Map(rows.map((r) => [r.responseId, r._count._all]))
}

export async function helpfulBy(voter: string, responseIds: string[]) {
  if (!responseIds.length) return []
  const rows = await prisma.reviewHelpful.findMany({ where: { voterHash: voterHash(voter), responseId: { in: responseIds } }, select: { responseId: true } })
  return rows.map((r) => r.responseId)
}

/** Adds or removes this visitor's vote; returns the new count. */
export async function setHelpful(responseId: string, voter: string, on: boolean, ip: string | undefined) {
  const hash = voterHash(voter)
  if (on) {
    const existing = await prisma.reviewHelpful.findUnique({ where: { responseId_voterHash: { responseId, voterHash: hash } } })
    if (!existing) {
      checkIpPhotoCap(ip, `review:${responseId}`)
      await prisma.reviewHelpful.create({ data: { responseId, voterHash: hash } }).catch(() => undefined)
    }
  } else {
    await prisma.reviewHelpful.deleteMany({ where: { responseId, voterHash: hash } })
  }
  return prisma.reviewHelpful.count({ where: { responseId } })
}
