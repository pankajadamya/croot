import type { Prisma, PublicationRevision, Response as ResponseRow } from '@prisma/client'
import { autoExcerpt, isVerbatimExcerpt } from '../../../shared/excerpt.js'
import { firstName, slugify } from '../../../shared/slug.js'
import { audit } from './audit.js'
import { HttpError } from './http.js'
import { prisma } from './prisma.js'
import { shortId } from './tokens.js'

type Tx = Prisma.TransactionClient

/** The live public snapshot for a response, or null if nothing is public. */
export async function livePublication(responseId: string, db: Tx | typeof prisma = prisma): Promise<PublicationRevision | null> {
  const latest = await db.publicationRevision.findFirst({
    where: { responseId },
    orderBy: { createdAt: 'desc' },
  })
  return latest?.status === 'published' ? latest : null
}

export interface PublishInput {
  organisationId: string
  responseId: string
  reviewerId: string
  excerpt?: string
  photoIds: string[]
  reason?: string
}

/**
 * Publishing is the only path to a public URL. It re-checks every gate on the server, from the
 * stored consent state, regardless of what the organiser UI sent:
 *   - the response is submitted and has non-empty public text
 *   - the guest consented to public text (first name only with its own consent)
 *   - every photo has the guest's per-photo consent and organiser approval
 *   - the excerpt is a verbatim substring of the guest's words
 */
export async function publishResponse(input: PublishInput) {
  return prisma.$transaction(async (tx) => {
    const response = await tx.response.findFirst({
      where: { id: input.responseId, organisationId: input.organisationId },
      include: { attendee: { select: { name: true, source: true, guestListConfirmedAt: true } }, media: true, retreat: { select: { slug: true, showPublicRating: true } } },
    })
    if (!response) throw new HttpError(404, 'Response not found')
    if (response.status !== 'submitted') throw new HttpError(409, 'Only submitted responses can be published')
    const story = response.storyText.trim()
    if (!story) throw new HttpError(409, 'This response has no public story')
    if (!response.consentPublicText) throw new HttpError(409, 'The guest has not consented to publishing their story')
    // Someone who joined by the group link must be confirmed as a guest first (anyone with the link can write).
    if (response.attendee.source === 'group_link' && !response.attendee.guestListConfirmedAt) {
      throw new HttpError(409, `${response.attendee.name} joined by the group link. Confirm they were your guest before publishing their review.`)
    }

    const excerpt = input.excerpt?.trim() ? input.excerpt.trim() : autoExcerpt(story)
    if (!isVerbatimExcerpt(story, excerpt)) throw new HttpError(400, "The excerpt must be the guest's exact words")

    const photoIds = [...new Set(input.photoIds)]
    for (const id of photoIds) {
      const photo = response.media.find((m) => m.id === id)
      if (!photo || photo.removedAt) throw new HttpError(400, 'Unknown photo')
      if (!photo.publishConsent) throw new HttpError(409, 'The guest has not consented to publishing one of these photos')
      if (photo.moderation !== 'approved') throw new HttpError(409, 'Approve each photo before publishing it')
    }

    const publicSlug = response.publicSlug ?? (await uniqueStorySlug(tx, response))
    const revision = await tx.publicationRevision.create({
      data: {
        organisationId: response.organisationId,
        responseId: response.id,
        retreatId: response.retreatId,
        title: response.storyTitle.trim() || null,
        storyText: story,
        excerpt,
        displayName: response.consentFirstName ? firstName(response.attendee.name) : null,
        // Kept with the story; whether it shows is the retreat's "show ratings" setting, applied when read.
        overallRating: response.overallRating,
        photoIds,
        status: 'published',
        reviewerId: input.reviewerId,
        reason: input.reason ?? null,
      },
    })
    await tx.response.update({
      where: { id: response.id },
      data: { publicationStatus: 'published', publicSlug },
    })
    await audit(
      {
        organisationId: response.organisationId,
        actorUserId: input.reviewerId,
        actorKind: 'user',
        action: 'story.published',
        entityType: 'response',
        entityId: response.id,
        metadata: { revisionId: revision.id, photoCount: photoIds.length },
      },
      tx,
    )
    return { revision, publicSlug }
  })
}

async function uniqueStorySlug(tx: Tx, response: ResponseRow & { attendee: { name: string } }) {
  // The slug never contains the guest's name unless they consented to it being shown.
  const base = response.consentFirstName ? slugify(firstName(response.attendee.name), 20) : 'story'
  for (let i = 0; i < 5; i++) {
    const candidate = `${base || 'story'}-${shortId(8)}`
    const clash = await tx.response.findUnique({ where: { publicSlug: candidate }, select: { id: true } })
    if (!clash) return candidate
  }
  throw new HttpError(500, 'Could not allocate a story link')
}

/** Takes a story off the public site immediately. `withdrawn` = guest's choice; `unpublished` = organiser's. */
export async function takeDown(opts: {
  organisationId: string
  responseId: string
  status: 'unpublished' | 'withdrawn'
  reason: string
  actorUserId?: string | null
  actorKind: 'user' | 'attendee'
}) {
  return prisma.$transaction(async (tx) => {
    const live = await livePublication(opts.responseId, tx)
    if (live) {
      await tx.publicationRevision.create({
        data: {
          organisationId: opts.organisationId,
          responseId: opts.responseId,
          retreatId: live.retreatId,
          storyText: '',
          excerpt: '',
          displayName: null,
          photoIds: [],
          status: opts.status,
          reason: opts.reason,
          reviewerId: opts.actorUserId ?? null,
        },
      })
    }
    await tx.response.update({
      where: { id: opts.responseId },
      data: { publicationStatus: opts.status, pinned: false },
    })
    await audit(
      {
        organisationId: opts.organisationId,
        actorUserId: opts.actorUserId,
        actorKind: opts.actorKind,
        action: `story.${opts.status}`,
        entityType: 'response',
        entityId: opts.responseId,
        metadata: { reason: opts.reason, wasLive: Boolean(live) },
      },
      tx,
    )
  })
}

/** Re-snapshots a live story without one photo (consent withdrawn or photo rejected). */
export async function dropPhotoFromLive(opts: { organisationId: string; responseId: string; photoId: string; reason: string; actorUserId?: string | null }) {
  await prisma.$transaction(async (tx) => {
    const live = await livePublication(opts.responseId, tx)
    if (!live || !live.photoIds.includes(opts.photoId)) return
    const { id: _id, createdAt: _c, ...rest } = live
    await tx.publicationRevision.create({
      data: { ...rest, photoIds: live.photoIds.filter((p) => p !== opts.photoId), reason: opts.reason, reviewerId: opts.actorUserId ?? null },
    })
  })
}

/**
 * Re-snapshots a live story with one more photo: approving a photo of an already-published story puts it
 * live too. Every gate is re-checked here (guest's per-photo consent, approval, belongs to this response).
 */
export async function addPhotoToLive(opts: { organisationId: string; responseId: string; photoId: string; actorUserId?: string | null }) {
  await prisma.$transaction(async (tx) => {
    const live = await livePublication(opts.responseId, tx)
    if (!live || live.photoIds.includes(opts.photoId)) return
    const photo = await tx.mediaAsset.findFirst({
      where: { id: opts.photoId, responseId: opts.responseId, organisationId: opts.organisationId, kind: 'guest', publishConsent: true, moderation: 'approved', removedAt: null },
    })
    if (!photo) return
    const { id: _id, createdAt: _c, ...rest } = live
    await tx.publicationRevision.create({
      data: { ...rest, photoIds: [...live.photoIds, photo.id], reason: 'Photo approved', reviewerId: opts.actorUserId ?? null },
    })
  })
}

/** Re-snapshots a live story without the display name (first-name consent withdrawn). */
export async function dropNameFromLive(organisationId: string, responseId: string) {
  await prisma.$transaction(async (tx) => {
    const live = await livePublication(responseId, tx)
    if (!live || !live.displayName) return
    const { id: _id, createdAt: _c, ...rest } = live
    await tx.publicationRevision.create({ data: { ...rest, organisationId, displayName: null, reason: 'First-name consent withdrawn' } })
  })
}
