import type { Prisma } from '@prisma/client'
import { HttpError } from './http.js'
import { prisma } from './prisma.js'
import { hashToken, looksLikeToken, newToken, tokenHint } from './tokens.js'

/** One generic message for every invalid state, so a link reveals nothing about who is registered. */
export const INVALID_LINK = 'This link is not valid or has expired. Please contact the retreat organiser for a new one.'

export async function issueInvitation(
  db: Prisma.TransactionClient | typeof prisma,
  opts: { organisationId: string; attendeeId: string; ttlDays: number },
) {
  const now = new Date()
  // Reissuing revokes any earlier live link for the same attendee (e.g. a forwarded link).
  await db.invitation.updateMany({
    where: { attendeeId: opts.attendeeId, revokedAt: null },
    data: { revokedAt: now },
  })
  const token = newToken()
  const invitation = await db.invitation.create({
    data: {
      organisationId: opts.organisationId,
      attendeeId: opts.attendeeId,
      tokenHash: hashToken(token),
      tokenHint: tokenHint(token),
      expiresAt: new Date(now.getTime() + opts.ttlDays * 86_400_000),
    },
  })
  return { token, invitation }
}

/** Resolves an invite token to its attendee, retreat and response. Throws the generic error on any problem. */
export async function resolveInvite(token: unknown) {
  if (!looksLikeToken(token)) throw new HttpError(404, INVALID_LINK)
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      attendee: {
        include: {
          retreat: { include: { organisation: { select: { id: true, slug: true, name: true, status: true } } } },
          response: true,
        },
      },
    },
  })
  const now = new Date()
  if (!invitation || invitation.revokedAt || invitation.expiresAt < now) throw new HttpError(404, INVALID_LINK)
  const { attendee } = invitation
  const { retreat } = attendee
  if (retreat.organisation.status !== 'active' || retreat.status === 'archived' || retreat.status === 'draft') {
    throw new HttpError(404, INVALID_LINK)
  }
  return { invitation, attendee, retreat, response: attendee.response }
}

export type ResolvedInvite = Awaited<ReturnType<typeof resolveInvite>>

/** Whether the guest may still change their answers through the invite link. */
export function canEdit(r: ResolvedInvite): boolean {
  const now = new Date()
  const { retreat, response } = r
  if (retreat.status !== 'collecting') return false
  if (retreat.inviteOpensAt && retreat.inviteOpensAt > now) return false
  if (retreat.inviteClosesAt && retreat.inviteClosesAt < now) return false
  if (!response) return true
  if (response.status === 'changes_requested') return true
  return response.status === 'draft' && retreat.draftEditingEnabled
}

export async function ensureResponse(r: ResolvedInvite) {
  if (r.response) return r.response
  return prisma.response.upsert({
    where: { attendeeId: r.attendee.id },
    update: {},
    create: { organisationId: r.retreat.organisationId, retreatId: r.retreat.id, attendeeId: r.attendee.id },
  })
}
