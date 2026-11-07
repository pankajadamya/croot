import { Prisma } from '@prisma/client'
import { audit } from './audit.js'
import { HttpError } from './http.js'
import { prisma } from './prisma.js'
import { removeObjects } from './storageCleanup.js'

/**
 * The recycle bin for reviews. Deleting a guest's review moves the guest, their review and everything
 * hanging off it (ratings, photos and videos, consents, publications, requests, verification) out of
 * the live tables into one snapshot row, so nothing anywhere has to know about "deleted" reviews: they
 * are simply gone from every page, list, count and album. The photo files stay in storage.
 *
 * Within BIN_DAYS the organiser can restore it exactly (same ids, so the guest's links work again) or
 * delete it for good; after that the retention job erases it, files included.
 */
export const BIN_DAYS = 30

const DAY = 86_400_000

type Media = { originalKey: string | null; derivativeKey: string; thumbKey: string | null; videoKey: string | null; originalPurgedAt: Date | null }
export const fileKeys = (media: Media[]) => media.flatMap((m) => [m.originalPurgedAt ? null : m.originalKey, m.derivativeKey, m.thumbKey, m.videoKey]).filter((k): k is string => Boolean(k))

/** Scalar columns only: relation lists come out of the snapshot separately. */
function scalars<T extends Record<string, unknown>>(row: T, drop: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (drop.includes(k)) continue
    out[k] = v
  }
  return out
}
/** A JSON column that held null has to be written back as the database's NULL. */
const jsonOrNull = (v: unknown) => (v === null || v === undefined ? Prisma.DbNull : (v as Prisma.InputJsonValue))

async function snapshotOf(organisationId: string, attendeeId: string) {
  return prisma.attendee.findFirst({
    where: { id: attendeeId, organisationId },
    include: {
      invitations: true,
      response: {
        include: {
          ratings: true,
          media: { include: { hearts: true } },
          consents: true,
          publications: true,
          helpfulVotes: true,
          changeRequests: true,
          verifications: true,
          verificationRequests: true,
        },
      },
    },
  })
}
type Snapshot = NonNullable<Awaited<ReturnType<typeof snapshotOf>>>

/** Moves a guest and their review into the bin. Returns the bin entry's id. */
export async function binGuest(opts: { organisationId: string; attendeeId: string; actorUserId: string }): Promise<string> {
  const a = await snapshotOf(opts.organisationId, opts.attendeeId)
  if (!a) throw new HttpError(404, 'Guest not found')
  const media = a.response?.media ?? []
  const now = new Date()
  const item = await prisma.$transaction(async (tx) => {
    const binned = await tx.recycledGuest.create({
      data: {
        organisationId: opts.organisationId,
        retreatId: a.retreatId,
        attendeeId: a.id,
        guestName: a.name,
        hadReview: Boolean(a.response?.submittedAt),
        photoCount: media.filter((m) => !m.removedAt).length,
        snapshot: JSON.parse(JSON.stringify(a)) as Prisma.InputJsonValue,
        objectKeys: fileKeys(media),
        deletedById: opts.actorUserId,
        purgeAfter: new Date(now.getTime() + BIN_DAYS * DAY),
      },
    })
    // The album cover can't point at a photo that's no longer there.
    if (media.length) await tx.retreat.updateMany({ where: { id: a.retreatId, rewardAlbumCoverId: { in: media.map((m) => m.id) } }, data: { rewardAlbumCoverId: null } })
    // Cascades take the invitations, review, ratings, photo rows, consents and the rest with it.
    await tx.attendee.delete({ where: { id: a.id } })
    return binned
  })
  await audit({ organisationId: opts.organisationId, actorUserId: opts.actorUserId, actorKind: 'user', action: 'guest.binned', entityType: 'retreat', entityId: a.retreatId, metadata: { hadReview: item.hadReview, photos: item.photoCount } })
  return item.id
}

/** Puts a binned guest and review back exactly as they were. */
export async function restoreGuest(opts: { organisationId: string; binId: string; actorUserId: string }) {
  const item = await prisma.recycledGuest.findFirst({ where: { id: opts.binId, organisationId: opts.organisationId } })
  if (!item) throw new HttpError(404, 'Not in the recycle bin')
  const a = item.snapshot as unknown as Snapshot
  if (a.email && (await prisma.attendee.findUnique({ where: { retreatId_email: { retreatId: a.retreatId, email: a.email } } }))) {
    throw new HttpError(409, 'Another guest on this programme now has the same email address. Change or remove that guest first, then restore.')
  }
  // A party whose other members have since left isn't a party any more.
  const partyLives = a.partyId ? (await prisma.attendee.count({ where: { partyId: a.partyId } })) > 0 : false
  const r = a.response
  try {
    await prisma.$transaction(async (tx) => {
      await tx.attendee.create({ data: { ...(scalars(a, ['invitations', 'response']) as Prisma.AttendeeUncheckedCreateInput), partyId: partyLives ? a.partyId : null } })
      if (a.invitations.length) await tx.invitation.createMany({ data: a.invitations as unknown as Prisma.InvitationCreateManyInput[] })
      if (!r) return
      const response = scalars(r, ['ratings', 'media', 'consents', 'publications', 'helpfulVotes', 'changeRequests', 'verifications', 'verificationRequests'])
      await tx.response.create({ data: { ...(response as Prisma.ResponseUncheckedCreateInput), submittedSnapshot: jsonOrNull(r.submittedSnapshot) } })
      if (r.ratings.length) await tx.feedbackRating.createMany({ data: r.ratings as unknown as Prisma.FeedbackRatingCreateManyInput[] })
      if (r.media.length) {
        await tx.mediaAsset.createMany({ data: r.media.map((m) => scalars(m, ['hearts'])) as unknown as Prisma.MediaAssetCreateManyInput[] })
        const hearts = r.media.flatMap((m) => m.hearts)
        if (hearts.length) await tx.photoHeart.createMany({ data: hearts as unknown as Prisma.PhotoHeartCreateManyInput[] })
      }
      if (r.consents.length) await tx.consentEvent.createMany({ data: r.consents as unknown as Prisma.ConsentEventCreateManyInput[] })
      if (r.publications.length) await tx.publicationRevision.createMany({ data: r.publications as unknown as Prisma.PublicationRevisionCreateManyInput[] })
      if (r.helpfulVotes.length) await tx.reviewHelpful.createMany({ data: r.helpfulVotes as unknown as Prisma.ReviewHelpfulCreateManyInput[] })
      if (r.changeRequests.length) await tx.changeRequest.createMany({ data: r.changeRequests as unknown as Prisma.ChangeRequestCreateManyInput[] })
      if (r.verifications.length) await tx.reviewVerification.createMany({ data: r.verifications.map((v) => ({ ...v, signals: (v.signals ?? {}) as Prisma.InputJsonValue })) as unknown as Prisma.ReviewVerificationCreateManyInput[] })
      if (r.verificationRequests.length) await tx.verificationRequest.createMany({ data: r.verificationRequests as unknown as Prisma.VerificationRequestCreateManyInput[] })
      await tx.recycledGuest.delete({ where: { id: item.id } })
    })
    if (!r) await prisma.recycledGuest.delete({ where: { id: item.id } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new HttpError(409, 'Something with the same address or link now exists on this programme, so this can’t be restored as it was.')
    }
    throw e
  }
  await audit({ organisationId: opts.organisationId, actorUserId: opts.actorUserId, actorKind: 'user', action: 'guest.restored', entityType: 'retreat', entityId: item.retreatId, metadata: { hadReview: item.hadReview, photos: item.photoCount } })
  return { attendeeId: item.attendeeId, responseId: r?.id ?? null }
}

/** Erases a bin entry for good: the snapshot and the photo files. */
export async function purgeBinItem(item: { id: string; organisationId: string; retreatId: string; objectKeys: string[] }, actor: { kind: 'user' | 'system'; userId?: string }) {
  await prisma.recycledGuest.delete({ where: { id: item.id } })
  await removeObjects(item.objectKeys)
  await audit({ organisationId: item.organisationId, actorUserId: actor.userId, actorKind: actor.kind, action: 'guest.bin_purged', entityType: 'retreat', entityId: item.retreatId, metadata: { files: item.objectKeys.length } })
}

/** Entries older than BIN_DAYS (the retention job). */
export async function purgeExpiredBin(now = new Date()): Promise<number> {
  const due = await prisma.recycledGuest.findMany({ where: { purgeAfter: { lte: now } }, select: { id: true, organisationId: true, retreatId: true, objectKeys: true } })
  for (const item of due) await purgeBinItem(item, { kind: 'system' })
  return due.length
}
