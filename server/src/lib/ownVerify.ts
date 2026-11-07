import type { Response as ExpressResponse } from 'express'
import { z } from 'zod'
import { signedIn } from '../modules/auth.js'
import { audit } from './audit.js'
import { normaliseEmail } from './emailGuard.js'
import { checkGroupCode, sendGroupCode, verifiedUserFor } from './groupCodes.js'
import { HttpError, parseBody } from './http.js'
import { requestCode, verifyCode } from './loginCodes.js'
import { prisma } from './prisma.js'
import { removeObjects } from './storageCleanup.js'
import { emailProven, maskEmail } from './verification.js'

/**
 * "Make your review count": a guest confirms their email with a code, which marks the review "Verified
 * email" and signs them in. Offered right after sending (on the private response page) and on the
 * thank-you page of their link: the same steps from either place. A guest who joined by group link
 * gave only a name, so they type the address; if it's already on the guest list (and no review was sent
 * from it), their review is matched to that guest.
 */
export type OwnReview = {
  attendee: { id: string; name: string; email: string | null; source: string }
  retreat: { id: string; organisationId: string; title: string }
  response: { id: string; submittedAt: Date | null; verifiedAt: Date | null } | null
}

/** What the page needs to offer the step (or say it's done). */
export function verificationView(r: OwnReview) {
  return {
    verified: Boolean(r.response?.verifiedAt),
    canVerify: Boolean((r.attendee.email || r.attendee.source === 'group_link') && r.response?.submittedAt && !r.response.verifiedAt),
    maskedEmail: r.attendee.email ? maskEmail(r.attendee.email) : null,
    needsEmail: !r.attendee.email && r.attendee.source === 'group_link',
  }
}

export async function sendOwnCode(r: OwnReview, rawBody: unknown) {
  if (!r.response?.submittedAt) throw new HttpError(409, 'Send your review first.')
  if (r.attendee.email) {
    await requestCode(r.attendee.email, 'signin')
    return { sentTo: maskEmail(r.attendee.email) }
  }
  if (r.attendee.source !== 'group_link') throw new HttpError(400, 'There’s no email address to confirm. Ask the organiser to add yours.')
  const { email } = parseBody(z.object({ email: z.email().max(200) }), rawBody)
  const address = normaliseEmail(email)
  await assertAddressFree(r, address)
  await sendGroupCode({ organisationId: r.retreat.organisationId, retreatId: r.retreat.id, retreatTitle: r.retreat.title, email: address, name: r.attendee.name, attendeeId: r.attendee.id })
  return { sentTo: maskEmail(address) }
}

export async function confirmOwnCode(r: OwnReview, rawBody: unknown, res: ExpressResponse) {
  const body = parseBody(z.object({ code: z.string().trim().max(12), email: z.email().max(200).optional() }), rawBody)
  if (r.attendee.email) {
    const result = await verifyCode(r.attendee.email, body.code.replace(/\s+/g, ''))
    if (!result.ok) throw new HttpError(401, 'That code is not valid or has expired. Request a new one.')
    await emailProven(r.attendee.id, 'code')
    return signedIn(res, result.userId, 'code', result.created)
  }
  if (r.attendee.source !== 'group_link' || !body.email) throw new HttpError(400, 'There’s no email address to confirm.')
  const address = await checkGroupCode(r.retreat.id, body.email, body.code)
  await assertAddressFree(r, address)
  const onList = await prisma.attendee.findUnique({ where: { retreatId_email: { retreatId: r.retreat.id, email: address } }, select: { id: true } })
  let guestId = r.attendee.id
  if (onList && onList.id !== r.attendee.id) {
    // Already on the guest list (the organiser added them): the review moves to their place there, so
    // they're a confirmed guest and the review is matched to them, with nothing for anyone to do.
    guestId = await matchToGuestList(r, onList.id)
  } else {
    // The proven address becomes theirs; the guest typed it (the verification record says so).
    await prisma.attendee.update({ where: { id: r.attendee.id }, data: { email: address } })
  }
  await emailProven(guestId, 'code')
  const user = await verifiedUserFor(address, r.attendee.name)
  const session = await signedIn(res, user.id, 'code', false)
  // A group-link joiner's own link is gone once matched: the page carries on from My reviews.
  return guestId === r.attendee.id ? session : { ...session, movedTo: `/my-reviews/${guestId}` }
}

/**
 * Moves a group-link joiner's review onto their place on the guest list (same retreat, same proven
 * address) and removes the temporary group-link entry. An unsent draft in that place is replaced; a
 * sent review there is never overwritten (assertAddressFree refuses that before we get here).
 */
async function matchToGuestList(r: OwnReview, guestId: string): Promise<string> {
  const old = await prisma.response.findUnique({ where: { attendeeId: guestId }, include: { media: true } })
  await prisma.$transaction(async (tx) => {
    if (old) await tx.response.delete({ where: { id: old.id } })
    if (r.response) await tx.response.update({ where: { id: r.response.id }, data: { attendeeId: guestId } })
    await tx.attendee.delete({ where: { id: r.attendee.id } })
  })
  if (old?.media.length) await removeObjects(old.media.flatMap((m) => [m.originalKey, m.derivativeKey, m.thumbKey]))
  await audit({ organisationId: r.retreat.organisationId, actorKind: 'attendee', action: 'group_link.matched_to_guest', entityType: 'attendee', entityId: guestId })
  return guestId
}

/** One review per email per retreat: an address that already sent its own review can't be used again. */
async function assertAddressFree(r: OwnReview, address: string) {
  const taken = await prisma.attendee.findUnique({
    where: { retreatId_email: { retreatId: r.retreat.id, email: address } },
    select: { id: true, response: { select: { submittedAt: true } } },
  })
  if (taken && taken.id !== r.attendee.id && taken.response?.submittedAt) {
    throw new HttpError(409, 'That email already has its own review for this retreat. Use the link sent to it, or sign in with it to manage that review.')
  }
}
