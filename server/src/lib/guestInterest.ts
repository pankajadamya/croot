import { z } from 'zod'
import { normaliseEmail } from './emailGuard.js'
import { HttpError, parseBody } from './http.js'
import { interestWording, registerInterest } from './interest.js'
import type { OwnReview } from './ownVerify.js'
import { prisma } from './prisma.js'
import { hashToken, newToken } from './tokens.js'
import { maskEmail } from './verification.js'

/**
 * "Notify me about the next retreat" on the thank-you page, for a guest who has just sent a review. The
 * address is already known (their invitation, or the one they confirmed), so it isn't asked for again:
 *  - an address the guest has proven (a code, or signing in with it) joins the list straight away;
 *  - an address only the organiser entered still gets the confirmation email (double opt-in), as on
 *    the public pages, so a forwarded link can't sign someone up;
 *  - a guest with no address types one, and confirms it from the email.
 * The organiser sees them on their Interested list with the rest; unsubscribing deletes the sign-up.
 */
/** signedIn: the request comes from someone signed in with the guest's own address (also proof). */
type Guest = OwnReview & { orgName: string; signedIn?: boolean }

async function addressOf(r: Guest) {
  const a = await prisma.attendee.findUnique({ where: { id: r.attendee.id }, select: { email: true, emailVerifiedAt: true } })
  return { email: a?.email ?? null, proven: Boolean(a?.email && (a.emailVerifiedAt || r.response?.verifiedAt || r.signedIn)) }
}

async function statusOf(organisationId: string, email: string | null) {
  if (!email) return null
  const row = await prisma.interestSignup.findUnique({ where: { organisationId_email: { organisationId, email } }, select: { confirmedAt: true } })
  return row ? (row.confirmedAt ? 'subscribed' : 'pending') : null
}

export async function guestInterestView(r: Guest) {
  const { email, proven } = await addressOf(r)
  return {
    orgName: r.orgName,
    wording: interestWording(r.orgName),
    // Shown masked, like everywhere a forwarded link could be open.
    maskedEmail: email ? maskEmail(email) : null,
    needsEmail: !email,
    // One tap, no confirmation email.
    instant: proven,
    status: await statusOf(r.retreat.organisationId, email),
  }
}

export async function guestInterestSignup(r: Guest, rawBody: unknown) {
  if (!r.response?.submittedAt) throw new HttpError(409, 'Send your review first.')
  const body = parseBody(z.object({ consent: z.literal(true, 'Please tick the box so we can email you.'), email: z.email().max(320).optional() }), rawBody)
  const { email: onFile, proven } = await addressOf(r)
  const email = onFile ?? (body.email ? normaliseEmail(body.email) : null)
  if (!email) throw new HttpError(400, 'Enter your email address.', { email: ['Enter your email address'] })
  const organisationId = r.retreat.organisationId
  if (proven) {
    // Their own proven address: on the list now, with the words they agreed to.
    const data = { confirmedAt: new Date(), retreatId: r.retreat.id, consentWording: interestWording(r.orgName) }
    const existing = await prisma.interestSignup.findUnique({ where: { organisationId_email: { organisationId, email } } })
    if (existing) {
      if (!existing.confirmedAt) await prisma.interestSignup.update({ where: { id: existing.id }, data })
    } else {
      await prisma.interestSignup.create({ data: { ...data, organisationId, email, name: r.attendee.name.split(/\s+/)[0] ?? '', tokenHash: hashToken(newToken(24)) } })
    }
    return { status: 'subscribed' as const }
  }
  await registerInterest({ organisationId, orgName: r.orgName, retreatId: r.retreat.id, email, name: r.attendee.name.split(/\s+/)[0] ?? '' })
  return { status: (await statusOf(organisationId, email)) ?? 'pending', sentTo: onFile ? maskEmail(email) : email }
}
