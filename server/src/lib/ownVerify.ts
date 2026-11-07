import type { Response as ExpressResponse } from 'express'
import { z } from 'zod'
import { signedIn } from '../modules/auth.js'
import { audit } from './audit.js'
import { normaliseEmail } from './emailGuard.js'
import { checkGroupCode, sendGroupCode, verifiedUserFor } from './groupCodes.js'
import { env } from './env.js'
import { HttpError, parseBody } from './http.js'
import { requestCode, verifyCode } from './loginCodes.js'
import { prisma } from './prisma.js'
import { removeObjects } from './storageCleanup.js'
import { emailProven, maskEmail } from './verification.js'

/**
 * "Make your review count": a guest confirms their email with a code, which marks the review "Verified
 * email" and signs them in. Offered right after sending (on the private response page) and on the
 * thank-you page of their link: the same steps from either place. A guest with no email on file (joined
 * by group link, or added by the organiser without one) types the address; if it's already on the guest
 * list (and no review was sent from it), their review is matched to that guest.
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
    canVerify: Boolean(r.response?.submittedAt && !r.response.verifiedAt),
    maskedEmail: r.attendee.email ? maskEmail(r.attendee.email) : null,
    // No email on file (however they joined): they type one, which then becomes theirs.
    needsEmail: !r.attendee.email,
  }
}

/** A new code can be asked for a minute after the last one (the page counts down the same minute). */
export const RESEND_SECONDS = 60

const tooSoon = (last: { createdAt: Date } | null) => Boolean(last && Date.now() - last.createdAt.getTime() < RESEND_SECONDS * 1000)
const waitError = () => new HttpError(429, 'Please wait a minute before asking for another code.')

/**
 * Sends the code. An address the organiser entered is shown masked (so a forwarded link doesn't reveal
 * it); an address the guest just typed is theirs to see, so it comes back in full. The guest may change
 * a typed address (a typo) and ask again, once the minute has passed.
 */
export async function sendOwnCode(r: OwnReview, rawBody: unknown) {
  if (!r.response?.submittedAt) throw new HttpError(409, 'Send your review first.')
  const timing = { validMinutes: env.LOGIN_CODE_TTL_MINUTES, resendSeconds: RESEND_SECONDS }
  if (r.attendee.email) {
    if (tooSoon(await prisma.loginCode.findFirst({ where: { email: r.attendee.email }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }))) throw waitError()
    await requestCode(r.attendee.email, 'signin')
    return { sentTo: maskEmail(r.attendee.email), ...timing }
  }
  const { email } = parseBody(z.object({ email: z.email().max(200) }), rawBody)
  const address = normaliseEmail(email)
  await assertAddressFree(r, address)
  const last = await prisma.groupJoinCode.findFirst({ where: { attendeeId: r.attendee.id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
  if (tooSoon(last)) throw waitError()
  await sendGroupCode({ organisationId: r.retreat.organisationId, retreatId: r.retreat.id, retreatTitle: r.retreat.title, email: address, name: r.attendee.name, attendeeId: r.attendee.id })
  return { sentTo: address, ...timing }
}

export async function confirmOwnCode(r: OwnReview, rawBody: unknown, res: ExpressResponse) {
  const body = parseBody(z.object({ code: z.string().trim().max(12), email: z.email().max(200).optional() }), rawBody)
  if (r.attendee.email) {
    const result = await verifyCode(r.attendee.email, body.code.replace(/\s+/g, ''))
    if (!result.ok) throw new HttpError(401, 'That code is not valid or has expired. Request a new one.')
    await emailProven(r.attendee.id, 'code')
    return signedIn(res, result.userId, 'code', result.created)
  }
  if (!body.email) throw new HttpError(400, 'Enter the email address to confirm.')
  const address = await checkGroupCode(r.retreat.id, body.email, body.code)
  await assertAddressFree(r, address)
  const onList = await prisma.attendee.findUnique({ where: { retreatId_email: { retreatId: r.retreat.id, email: address } }, select: { id: true } })
  let guestId = r.attendee.id
  if (onList && onList.id !== r.attendee.id) {
    // Already on the guest list (the organiser added them): the review moves to their place there, so
    // they're a confirmed guest and the review is matched to them, with nothing for anyone to do.
    guestId = await matchToGuestList(r, onList.id)
    await emailProven(guestId, 'code')
  } else {
    // The proven address becomes theirs; the guest typed it (the verification record says so).
    await prisma.attendee.update({ where: { id: r.attendee.id }, data: { email: address } })
    await emailProven(guestId, 'code', 'guest')
  }
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
