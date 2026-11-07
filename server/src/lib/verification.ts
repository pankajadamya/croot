import { createHash } from 'node:crypto'
import type { VerificationMethod } from '@prisma/client'
import { audit } from './audit.js'
import { normaliseEmail } from './emailGuard.js'
import { prisma } from './prisma.js'

/**
 * Verified reviews. A review shows "Verified email" once its guest has proved they own the address it
 * was sent from: they wrote it through a link Croot emailed them, sent it while signed in with that
 * address, entered a code Croot emailed to it (the thank-you page), confirmed it from a verification
 * email, or, signed in later, said "Yes, this review is mine". Signing in alone doesn't add the badge:
 * it would vouch for words someone else may have written on a copied link. This proves control of the
 * inbox, not attendance, so each verification also records signals for later credibility checks
 * (e.g. the address belongs to someone in the organisation, or was changed after the review was sent).
 * Only a hash of the address is kept here, so checks can match addresses across reviews.
 */

export function emailHash(email: string) {
  return createHash('sha256').update(normaliseEmail(email)).digest('hex')
}

/** Signals for the credibility checks: facts only, no judgement here. */
async function signalsFor(r: {
  organisationId: string
  retreatId: string
  submittedAt: Date | null
  attendee: { email: string | null; source: string; createdAt: Date; emailChangedAt: Date | null; guestListConfirmedAt: Date | null }
}) {
  const email = r.attendee.email!
  const domain = email.split('@')[1] ?? ''
  const [member, sameDomain] = await Promise.all([
    prisma.membership.findFirst({ where: { organisationId: r.organisationId, user: { email } }, select: { id: true } }),
    prisma.attendee.count({ where: { retreatId: r.retreatId, email: { endsWith: `@${domain}` } } }),
  ])
  return {
    addressIsMember: Boolean(member),
    addressChangedAfterSent: Boolean(r.attendee.emailChangedAt && r.submittedAt && r.attendee.emailChangedAt > r.submittedAt),
    sameDomainOnRetreat: sameDomain,
    minutesToWrite: r.submittedAt ? Math.round((r.submittedAt.getTime() - r.attendee.createdAt.getTime()) / 60_000) : null,
    joinedByGroupLink: r.attendee.source === 'group_link',
    confirmedGuest: r.attendee.source !== 'group_link' || Boolean(r.attendee.guestListConfirmedAt),
  }
}

/** Marks a sent review verified (once). Returns whether it changed. */
export async function verifyResponse(responseId: string, method: VerificationMethod, addressSource?: 'guest' | 'organiser'): Promise<boolean> {
  const r = await prisma.response.findUnique({
    where: { id: responseId },
    select: {
      id: true,
      organisationId: true,
      retreatId: true,
      submittedAt: true,
      verifiedAt: true,
      attendee: { select: { email: true, source: true, createdAt: true, emailChangedAt: true, guestListConfirmedAt: true } },
    },
  })
  if (!r || !r.submittedAt || r.verifiedAt || !r.attendee.email) return false
  const signals = await signalsFor(r)
  await prisma.$transaction([
    prisma.reviewVerification.create({
      data: {
        organisationId: r.organisationId,
        responseId: r.id,
        method,
        emailHash: emailHash(r.attendee.email),
        addressSource: addressSource ?? (r.attendee.source === 'group_link' ? 'guest' : 'organiser'),
        signals,
      },
    }),
    prisma.response.update({ where: { id: r.id }, data: { verifiedAt: new Date() } }),
  ])
  await audit({ organisationId: r.organisationId, actorKind: 'attendee', action: 'response.verified', entityType: 'response', entityId: r.id, metadata: { method } })
  return true
}

/** The guest proved they own their address: remember it, and verify their review if it's been sent. */
export async function emailProven(attendeeId: string, method: VerificationMethod, addressSource?: 'guest' | 'organiser') {
  const a = await prisma.attendee.update({ where: { id: attendeeId }, data: { emailVerifiedAt: new Date() }, select: { response: { select: { id: true } } } })
  if (a.response) await verifyResponse(a.response.id, method, addressSource)
}


/**
 * The organiser changed a guest's address: whatever was proven was about the old one, so the badge
 * goes until the guest proves the new address.
 */
export async function emailChanged(attendeeId: string) {
  await prisma.attendee.update({ where: { id: attendeeId }, data: { emailVerifiedAt: null, emailChangedAt: new Date() } })
  await prisma.response.updateMany({ where: { attendeeId }, data: { verifiedAt: null } })
}

/** "r••••@gmail.com": enough for the guest to recognise their address, not to learn someone else's. */
export function maskEmail(email: string) {
  const [user, domain] = email.split('@')
  // Always three dots, so the mask doesn't hint at how long the name is.
  return `${user.slice(0, 1)}•••@${domain}`
}
