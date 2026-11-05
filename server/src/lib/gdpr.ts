import type { FeedbackCategory } from '../../../shared/categories.js'
import { audit } from './audit.js'
import { HttpError } from './http.js'
import { prisma } from './prisma.js'
import { storage } from './storage.js'

/**
 * Data-subject rights (GDPR Arts. 15, 17, 20) and controller/processor duties (Art. 28(3)(g)).
 * Everything here is scoped by organisation id. Audit rows written here never contain the erased
 * person's name, email or words: only that an erasure happened, and by whom.
 */

async function removeObjects(keys: string[]) {
  await Promise.all(keys.filter(Boolean).map((k) => storage.remove(k).catch(() => {})))
}

function mediaKeys(media: Array<{ originalKey: string; derivativeKey: string; originalPurgedAt: Date | null }>) {
  return media.flatMap((m) => (m.originalPurgedAt ? [m.derivativeKey] : [m.originalKey, m.derivativeKey]))
}

/** Everything held about one guest, in a portable, machine-readable form. Never includes anonymous notes. */
export async function exportGuestData(organisationId: string, attendeeId: string) {
  const attendee = await prisma.attendee.findFirst({
    where: { id: attendeeId, organisationId },
    include: {
      retreat: { select: { title: true, kind: true, feedbackCategories: true, organisation: { select: { name: true, legalName: true } } } },
      invitations: { select: { issuedAt: true, expiresAt: true, openedAt: true, lastUsedAt: true, revokedAt: true } },
      response: {
        include: {
          ratings: true,
          media: { where: { removedAt: null } },
          consents: { orderBy: { createdAt: 'asc' } },
          publications: { orderBy: { createdAt: 'asc' } },
          changeRequests: { orderBy: { createdAt: 'asc' } },
        },
      },
    },
  })
  if (!attendee) throw new HttpError(404, 'Not found')
  const r = attendee.response
  const labels = new Map(((attendee.retreat.feedbackCategories as unknown as FeedbackCategory[]) ?? []).map((c) => [c.key, c.label]))
  return {
    exportedAt: new Date().toISOString(),
    format: 'croot-guest-export/1',
    controller: attendee.retreat.organisation.legalName || attendee.retreat.organisation.name,
    programme: { title: attendee.retreat.title, type: attendee.retreat.kind },
    you: { name: attendee.name, email: attendee.email, stayStart: attendee.stayStart, stayEnd: attendee.stayEnd, addedAt: attendee.createdAt },
    invitationLinks: attendee.invitations,
    response: r && {
      status: r.status,
      submittedAt: r.submittedAt,
      story: r.storyText,
      overallRating: r.overallRating,
      privateFeedback: {
        ratings: r.ratings.map((x) => ({ area: labels.get(x.categoryKey) ?? x.categoryKey, score: x.score, notApplicable: x.notApplicable, comment: x.comment })),
        keep: r.keepText,
        change: r.changeText,
      },
      permissions: { publishStory: r.consentPublicText, showFirstName: r.consentFirstName, contactAboutFeedback: r.consentFollowUp, marketing: r.consentMarketing },
      permissionHistory: r.consents.map((c) => ({ scope: c.scope, granted: c.granted, wordingVersion: c.wordingVersion, by: c.actor, at: c.createdAt })),
      photos: r.media.map((m) => ({ id: m.id, description: m.altText, caption: m.caption, mayPublish: m.publishConsent, reviewed: m.moderation, uploadedAt: m.createdAt })),
      publicationHistory: r.publications.map((p) => ({ status: p.status, publishedText: p.storyText, excerpt: p.excerpt, nameShown: p.displayName, at: p.createdAt })),
      requests: r.changeRequests.map((c) => ({ kind: c.kind, message: c.message, status: c.status, at: c.createdAt })),
    },
    note: 'Anonymous notes are stored without any link to you, so they cannot be included here.',
  }
}

/** Erases a guest completely: invitation, response, feedback, consents, publications and photo files. */
export async function eraseAttendee(opts: { organisationId: string; attendeeId: string; actorKind: 'user' | 'attendee' | 'system'; actorUserId?: string | null; reason: string }) {
  const attendee = await prisma.attendee.findFirst({
    where: { id: opts.attendeeId, organisationId: opts.organisationId },
    select: { id: true, retreatId: true, response: { select: { id: true, media: { select: { originalKey: true, derivativeKey: true, originalPurgedAt: true } } } } },
  })
  if (!attendee) throw new HttpError(404, 'Not found')
  const keys = mediaKeys(attendee.response?.media ?? [])
  // Cascades remove invitations, response, ratings, media rows, consent events, publications and requests.
  await prisma.attendee.delete({ where: { id: attendee.id } })
  await removeObjects(keys)
  await audit({
    organisationId: opts.organisationId,
    actorUserId: opts.actorUserId,
    actorKind: opts.actorKind,
    action: 'guest.erased',
    entityType: 'retreat',
    entityId: attendee.retreatId,
    metadata: { reason: opts.reason, hadResponse: Boolean(attendee.response), files: keys.length },
  })
}

/** Everything an organisation holds, for return of data at the end of the service (Art. 28(3)(g)). */
export async function exportOrganisation(organisationId: string) {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: organisationId }, include: { domains: true } })
  const retreats = await prisma.retreat.findMany({
    where: { organisationId },
    include: {
      attendees: { include: { response: { include: { ratings: true, consents: true, publications: true, changeRequests: true, media: true } } } },
      anonymousNotes: { select: { message: true }, orderBy: { message: 'asc' } },
      contents: true,
      themes: true,
      media: { where: { kind: 'organiser' } },
    },
  })
  const members = await prisma.membership.findMany({ where: { organisationId }, include: { user: { select: { name: true, email: true } } } })
  return {
    exportedAt: new Date().toISOString(),
    format: 'croot-organisation-export/1',
    organisation: org,
    members: members.map((m) => ({ name: m.user.name, email: m.user.email, role: m.role })),
    programmes: retreats,
    note: 'Photo files are not embedded; ask the platform operator for a storage export if you need them.',
  }
}

/** Deletes an organisation and every file it owns. Irreversible. */
export async function eraseOrganisation(organisationId: string, actorUserId: string) {
  const org = await prisma.organisation.findUnique({ where: { id: organisationId }, select: { slug: true } })
  if (!org) throw new HttpError(404, 'Not found')
  const media = await prisma.mediaAsset.findMany({ where: { organisationId }, select: { originalKey: true, derivativeKey: true, originalPurgedAt: true } })
  const memberIds = (await prisma.membership.findMany({ where: { organisationId }, select: { userId: true } })).map((m) => m.userId)
  await prisma.$transaction([
    prisma.auditEvent.deleteMany({ where: { organisationId } }),
    prisma.organisation.delete({ where: { id: organisationId } }),
    // Organiser accounts that belonged only to this organisation go too (platform admins are kept).
    prisma.user.deleteMany({ where: { id: { in: memberIds }, isPlatformAdmin: false, memberships: { none: {} } } }),
  ])
  await removeObjects(mediaKeys(media))
  await audit({ actorUserId, actorKind: 'platform', action: 'tenant.erased', entityType: 'organisation', entityId: organisationId, metadata: { slug: org.slug, files: media.length } })
}

export async function purgeObjects(keys: string[]) {
  await removeObjects(keys)
}
