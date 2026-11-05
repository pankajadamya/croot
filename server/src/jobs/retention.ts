import { audit } from '../lib/audit.js'
import { eraseAttendee, purgeObjects } from '../lib/gdpr.js'
import { prisma } from '../lib/prisma.js'
import { livePublication } from '../lib/publication.js'

/**
 * Storage limitation (GDPR Art. 5(1)(e)). Applies each organisation's retention settings:
 *   1. unsent drafts                 → deleted after draftRetentionDays of inactivity
 *   2. guests who never responded    → deleted nonResponderRetentionDays after the programme/stay
 *   3. submitted responses           → after responseRetentionMonths: unpublished ones are erased;
 *                                      published ones keep only the published story, and private
 *                                      feedback, unpublished photos and the email address are deleted
 *   4. original photo uploads        → deleted after originalPhotoRetentionDays (web copies remain)
 *   5. anonymous notes (by the date they arrived; no time is kept), audit events → deleted after their retention period
 * plus platform housekeeping: expired sessions, spent setup links, old invitations and access requests.
 *
 * Idempotent and safe to run often. Returns counts for logging.
 */
const DAY = 86_400_000
const monthsAgo = (now: Date, m: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, now.getUTCDate()))

export async function runRetention(now = new Date()) {
  const counts = { drafts: 0, nonResponders: 0, responsesErased: 0, responsesMinimised: 0, originals: 0, notes: 0, auditEvents: 0, sessions: 0, setupTokens: 0, invitations: 0, tenantRequests: 0, loginCodes: 0, interestUnconfirmed: 0 }
  const orgs = await prisma.organisation.findMany()

  for (const org of orgs) {
    // 1. Stale drafts (the guest's attendee record and link remain until rule 2).
    const drafts = await prisma.response.findMany({
      where: { organisationId: org.id, status: 'draft', updatedAt: { lt: new Date(now.getTime() - org.draftRetentionDays * DAY) } },
      select: { id: true, media: { select: { originalKey: true, derivativeKey: true } } },
    })
    for (const d of drafts) {
      await prisma.response.delete({ where: { id: d.id } })
      await purgeObjects(d.media.flatMap((m) => [m.originalKey, m.derivativeKey]))
      counts.drafts++
    }

    // 2. Guests who never submitted.
    const nonResponderCutoff = new Date(now.getTime() - org.nonResponderRetentionDays * DAY)
    const silent = await prisma.attendee.findMany({
      where: { organisationId: org.id, OR: [{ response: null }, { response: { status: 'draft' } }] },
      select: { id: true, createdAt: true, stayEnd: true, retreat: { select: { kind: true, endDate: true } } },
    })
    for (const a of silent) {
      const anchor = a.retreat.kind === 'itinerary' ? (a.retreat.endDate ?? a.createdAt) : (a.stayEnd ?? a.createdAt)
      if (anchor < nonResponderCutoff) {
        await eraseAttendee({ organisationId: org.id, attendeeId: a.id, actorKind: 'system', reason: 'retention: no response' })
        counts.nonResponders++
      }
    }

    // 3. Submitted responses past their retention period.
    const old = await prisma.response.findMany({
      where: {
        organisationId: org.id,
        status: { not: 'draft' },
        submittedAt: { lt: monthsAgo(now, org.responseRetentionMonths) },
        privateDataPurgedAt: null,
      },
      select: { id: true, attendeeId: true, publicationStatus: true, media: { select: { id: true, originalKey: true, derivativeKey: true, originalPurgedAt: true } } },
    })
    for (const r of old) {
      const live = r.publicationStatus === 'published' ? await livePublication(r.id) : null
      if (!live) {
        await eraseAttendee({ organisationId: org.id, attendeeId: r.attendeeId, actorKind: 'system', reason: 'retention: response period ended' })
        counts.responsesErased++
        continue
      }
      // Keep exactly what the guest agreed to publish; drop everything else.
      const unpublished = r.media.filter((m) => !live.photoIds.includes(m.id))
      await prisma.$transaction([
        prisma.feedbackRating.deleteMany({ where: { responseId: r.id } }),
        prisma.changeRequest.deleteMany({ where: { responseId: r.id } }),
        prisma.mediaAsset.deleteMany({ where: { id: { in: unpublished.map((m) => m.id) } } }),
        prisma.response.update({
          where: { id: r.id },
          data: { keepText: '', changeText: '', consentFollowUp: false, receiptTokenHash: null, privateDataPurgedAt: now },
        }),
        prisma.attendee.update({ where: { id: r.attendeeId }, data: { email: `retained-${r.attendeeId}@invalid`, stayStart: null, stayEnd: null } }),
        prisma.invitation.deleteMany({ where: { attendeeId: r.attendeeId } }),
      ])
      await purgeObjects(unpublished.flatMap((m) => (m.originalPurgedAt ? [m.derivativeKey] : [m.originalKey, m.derivativeKey])))
      await audit({ organisationId: org.id, actorKind: 'system', action: 'retention.response_minimised', entityType: 'response', entityId: r.id })
      counts.responsesMinimised++
    }

    // 4. Original uploads: keep only metadata-stripped web copies.
    const originals = await prisma.mediaAsset.findMany({
      where: {
        organisationId: org.id,
        kind: 'guest',
        originalPurgedAt: null,
        response: { submittedAt: { lt: new Date(now.getTime() - org.originalPhotoRetentionDays * DAY) } },
      },
      select: { id: true, originalKey: true },
    })
    for (const m of originals) {
      await purgeObjects([m.originalKey])
      await prisma.mediaAsset.update({ where: { id: m.id }, data: { originalPurgedAt: now } })
      counts.originals++
    }

    // 5. Anonymous notes and audit events.
    counts.notes += (await prisma.anonymousNote.deleteMany({ where: { organisationId: org.id, receivedOn: { lt: monthsAgo(now, org.anonymousNoteRetentionMonths) } } })).count
    counts.auditEvents += (await prisma.auditEvent.deleteMany({ where: { organisationId: org.id, createdAt: { lt: monthsAgo(now, org.auditRetentionMonths) } } })).count
  }

  // Interest sign-ups never confirmed: gone after 30 days.
  counts.interestUnconfirmed = (await prisma.interestSignup.deleteMany({ where: { confirmedAt: null, createdAt: { lt: new Date(now.getTime() - 30 * DAY) } } })).count

  // Platform housekeeping.
  counts.auditEvents += (await prisma.auditEvent.deleteMany({ where: { organisationId: null, createdAt: { lt: monthsAgo(now, 36) } } })).count
  counts.sessions = (await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } })).count
  counts.setupTokens = (await prisma.setupToken.deleteMany({ where: { OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] } })).count
  counts.invitations = (
    await prisma.invitation.deleteMany({ where: { OR: [{ revokedAt: { lt: new Date(now.getTime() - 90 * DAY) } }, { expiresAt: { lt: new Date(now.getTime() - 90 * DAY) } }] } })
  ).count
  counts.loginCodes = (await prisma.loginCode.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DAY) } } })).count
  counts.tenantRequests = (
    await prisma.tenantRequest.deleteMany({
      where: { OR: [{ status: 'declined', reviewedAt: { lt: monthsAgo(now, 6) } }, { status: 'approved', reviewedAt: { lt: monthsAgo(now, 24) } }] },
    })
  ).count
  return counts
}

const LOCK_ID = 727_001

/** Runs retention under a Postgres advisory lock so only one instance works at a time. */
export async function runRetentionLocked() {
  const [{ locked }] = await prisma.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_lock(${LOCK_ID}) AS locked`
  if (!locked) return null
  try {
    return await runRetention()
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${LOCK_ID})`
  }
}

export function scheduleRetention(intervalMs = 6 * 3600_000) {
  const tick = () =>
    runRetentionLocked()
      .then((c) => c && console.log('retention:', JSON.stringify(c)))
      .catch((e) => console.error('retention failed:', e))
  const first = setTimeout(tick, 60_000)
  const every = setInterval(tick, intervalMs)
  first.unref()
  every.unref()
  return () => {
    clearTimeout(first)
    clearInterval(every)
  }
}
