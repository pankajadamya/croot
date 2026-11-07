import { Router } from 'express'
import { normaliseEmail, sendOrgMail, suppressedAmong } from '../../lib/emailGuard.js'
import { z } from 'zod'
import { audit } from '../../lib/audit.js'
import { parseAttendeeCsv } from '../../lib/csv.js'
import { env } from '../../lib/env.js'
import { HttpError, parseBody, route, text, uuidParam } from '../../lib/http.js'
import { issueInvitation } from '../../lib/invites.js'
import { invitationEmail } from '../../lib/mailer.js'
import { firstName } from '../../../../shared/slug.js'
import { prisma } from '../../lib/prisma.js'
import { tenantAttendee, tenantRetreat } from '../../lib/tenant.js'
import { emailChanged } from '../../lib/verification.js'
import { tenantOf } from '../../middleware/auth.js'

export const attendeesRouter = Router({ mergeParams: true })

/** Links point at the tenant's own domain when one is mapped, so guests see the organiser's brand. */
export async function siteOrigin(orgId: string) {
  const domain = await prisma.orgDomain.findFirst({ where: { organisationId: orgId }, orderBy: { createdAt: 'asc' } })
  return domain ? `https://${domain.hostname}` : env.WEB_ORIGIN
}

type InviteState = 'not_invited' | 'revoked' | 'expired' | 'sent' | 'opened' | 'draft' | 'submitted' | 'changes_requested' | 'consented' | 'published' | 'withdrawn'

attendeesRouter.get(
  '/retreats/:retreatId/attendees',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const attendees = await prisma.attendee.findMany({
      where: { organisationId: t.org.id, retreatId: retreat.id },
      orderBy: { name: 'asc' },
      include: {
        invitations: { orderBy: { issuedAt: 'desc' }, take: 1 },
        response: { select: { id: true, status: true, consentPublicText: true, publicationStatus: true, updatedAt: true, verifiedAt: true, submittedAt: true } },
      },
    })
    const now = new Date()
    const problems = await suppressedAmong(attendees.flatMap((a) => (a.email ? [a.email] : [])))
    res.json({
      attendees: attendees.map((a) => {
        const inv = a.invitations[0]
        const r = a.response
        let state: InviteState = 'not_invited'
        if (inv) state = inv.revokedAt ? 'revoked' : inv.expiresAt < now ? 'expired' : inv.openedAt ? 'opened' : 'sent'
        if (r && (state === 'opened' || state === 'sent' || state === 'expired')) {
          if (r.publicationStatus === 'withdrawn' || r.status === 'withdrawn') state = 'withdrawn'
          else if (r.publicationStatus === 'published') state = 'published'
          else if (r.status === 'changes_requested') state = 'changes_requested'
          else if (r.status === 'submitted') state = r.consentPublicText ? 'consented' : 'submitted'
          else state = 'draft'
        }
        return {
          id: a.id,
          name: a.name,
          email: a.email,
          // bounced / complained: SES reported it; Croot won't email it until the address is corrected.
          emailProblem: (a.email && problems.get(normaliseEmail(a.email))) ?? null,
          stayStart: a.stayStart,
          stayEnd: a.stayEnd,
          state,
          responseId: r && r.status !== 'draft' ? r.id : null,
          // "Verified email" on their review; how they joined (group link guests need confirming before publishing).
          verified: Boolean(r?.verifiedAt),
          source: a.source,
          guestConfirmed: a.source !== 'group_link' || Boolean(a.guestListConfirmedAt),
          // Guests who came together (organiser-grouped): one review from the party counts it as responded.
          partyId: a.partyId,
          sent: Boolean(r?.submittedAt),
          invitation: inv
            ? { hint: inv.tokenHint, issuedAt: inv.issuedAt, expiresAt: inv.expiresAt, openedAt: inv.openedAt, lastUsedAt: inv.lastUsedAt, revoked: Boolean(inv.revokedAt), emailedAt: inv.emailedAt }
            : null,
        }
      }),
    })
  }),
)

const csvSchema = z.object({ csv: z.string().max(500_000) })

/** Step 1 of import: validate and show duplicates/invalid rows. Nothing is stored. */
attendeesRouter.post(
  '/retreats/:retreatId/attendees/preview',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const { csv } = parseBody(csvSchema, req.body)
    const existing = await prisma.attendee.findMany({ where: { retreatId: retreat.id }, select: { email: true } })
    const rows = parseAttendeeCsv(csv, new Set(existing.flatMap((e) => (e.email ? [e.email] : []))))
    if (rows.length > 2000) throw new HttpError(400, 'Import at most 2,000 attendees at a time')
    res.json({ rows })
  }),
)

const stayDate = z.iso.date().nullable().optional()
/** A guest's email is optional: without one, the organiser shares their private link another way. */
const optionalEmail = z
  .union([z.email().max(200), z.literal('')])
  .nullable()
  .optional()
  .transform((v) => (v ? v.toLowerCase() : null))
const importSchema = z.object({
  rows: z.array(z.object({ name: text(120), email: optionalEmail, stayStart: stayDate, stayEnd: stayDate })).min(1).max(2000),
})
const day = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00Z`) : null)

/** Step 2: commit the validated rows. The CSV itself is never stored. */
attendeesRouter.post(
  '/retreats/:retreatId/attendees/import',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const { rows } = parseBody(importSchema, req.body)
    const batch = new Date().toISOString()
    const result = await prisma.attendee.createMany({
      data: rows.map((r) => ({
        organisationId: t.org.id,
        retreatId: retreat.id,
        name: r.name,
        email: r.email,
        stayStart: day(r.stayStart),
        stayEnd: day(r.stayEnd),
        importBatch: batch,
      })),
      skipDuplicates: true,
    })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'attendees.imported', entityType: 'retreat', entityId: retreat.id, metadata: { count: result.count } })
    res.json({ imported: result.count, skipped: rows.length - result.count })
  }),
)

attendeesRouter.post(
  '/retreats/:retreatId/attendees',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const body = parseBody(
      z.object({ name: text(120).refine((v) => v.length > 0, 'Required'), email: optionalEmail, stayStart: stayDate, stayEnd: stayDate }),
      req.body,
    )
    const email = body.email
    if (body.stayStart && body.stayEnd && body.stayEnd < body.stayStart) throw new HttpError(400, 'Check-out is before check-in')
    if (email && (await prisma.attendee.findUnique({ where: { retreatId_email: { retreatId: retreat.id, email } } }))) {
      throw new HttpError(409, 'That email is already on this list')
    }
    const a = await prisma.attendee.create({
      data: { organisationId: t.org.id, retreatId: retreat.id, name: body.name, email, stayStart: day(body.stayStart), stayEnd: day(body.stayEnd) },
    })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'attendee.added', entityType: 'attendee', entityId: a.id })
    res.status(201).json({ id: a.id })
  }),
)

/**
 * Issue (or reissue) a link. The plain token is returned exactly once, for the organiser to copy;
 * only its hash is kept. Reissuing revokes the previous link but keeps the guest's draft.
 */
attendeesRouter.post(
  '/attendees/:attendeeId/invite',
  route(async (req, res) => {
    const t = tenantOf(req)
    const attendee = await tenantAttendee(t.org.id, uuidParam(req, 'attendeeId'))
    const { token } = await prisma.$transaction((tx) => issueInvitation(tx, { organisationId: t.org.id, attendeeId: attendee.id, ttlDays: attendee.retreat.inviteTtlDays }))
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'invitation.issued', entityType: 'attendee', entityId: attendee.id })
    // ?via= says how the guest arrived (page statistics, src/lib/analytics.ts); the page ignores it.
    res.json({ url: `${await siteOrigin(t.org.id)}/invite/${token}?via=link` })
  }),
)

// ---------------------------------------------------------------------------------------------
// Email invitations from Croot. Each send issues a fresh link (only its hash is stored, so the old one
// can't be re-sent), which cancels any earlier link but keeps the guest's draft.

type RetreatForMail = { id: string; title: string; kind: 'itinerary' | 'property'; status: string; organiserName: string; inviteTtlDays: number }

type OrgForMail = { id: string; name: string; slug: string; legalName: string | null; legalAddress: string | null; nonResponderRetentionDays: number }

async function emailInvite(org: OrgForMail, retreat: RetreatForMail, attendee: { id: string; name: string; email: string | null }) {
  if (!attendee.email) throw new HttpError(400, `There’s no email address for ${attendee.name}. Copy their link and send it another way, or add their email.`)
  const to = attendee.email
  const orgId = org.id
  const orgName = org.name
  const origin = await siteOrigin(orgId)
  if (retreat.status !== 'collecting') throw new HttpError(409, 'Start collecting reviews first, so the links work.')
  const { token, invitation } = await prisma.$transaction((tx) => issueInvitation(tx, { organisationId: orgId, attendeeId: attendee.id, ttlDays: retreat.inviteTtlDays }))
  await sendOrgMail(
    orgId,
    invitationEmail({
      to,
      firstName: firstName(attendee.name),
      retreatTitle: retreat.title,
      from: retreat.organiserName || orgName,
      url: `${origin}/invite/${token}?via=email`,
      expiresAt: invitation.expiresAt,
      kind: retreat.kind,
      privacyUrl: `${origin}/o/${org.slug}/privacy`,
      controller: org.legalName ? [org.legalName, org.legalAddress].filter(Boolean).join(', ') : orgName,
      nonResponderDays: org.nonResponderRetentionDays,
    }),
  )
  await prisma.invitation.update({ where: { id: invitation.id }, data: { emailedAt: new Date() } })
}

attendeesRouter.post(
  '/attendees/:attendeeId/email-invite',
  route(async (req, res) => {
    const t = tenantOf(req)
    const attendee = await tenantAttendee(t.org.id, uuidParam(req, 'attendeeId'))
    await emailInvite(t.org, attendee.retreat, attendee)
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'invitation.emailed', entityType: 'attendee', entityId: attendee.id })
    res.json({ ok: true })
  }),
)

/** Emails everyone who hasn't been emailed a link yet and hasn't sent a review. */
attendeesRouter.post(
  '/retreats/:retreatId/invites/email-all',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    if (retreat.status !== 'collecting') throw new HttpError(409, 'Start collecting reviews first, so the links work.')
    const partiesDone = await partiesThatReviewed(retreat.id)
    const attendees = await prisma.attendee.findMany({
      where: {
        organisationId: t.org.id,
        retreatId: retreat.id,
        AND: [{ OR: [{ partyId: null }, { partyId: { notIn: partiesDone } }] }],
        email: { not: null }, // guests without an email get their link from the organiser
        invitations: { none: { emailedAt: { not: null }, revokedAt: null } },
        OR: [{ response: null }, { response: { submittedAt: null } }],
      },
      orderBy: { name: 'asc' },
    })
    let sent = 0
    const failed: string[] = []
    let stopped: string | null = null
    for (const a of attendees) {
      try {
        await emailInvite(t.org, retreat, a)
        sent++
      } catch (e) {
        // Over today's limit, or email paused: the rest wait; say why instead of failing each one.
        if (e instanceof HttpError && (e.status === 429 || e.message.includes('paused'))) {
          stopped = e.message
          break
        }
        failed.push(a.email ?? a.name)
      }
    }
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'invitation.bulk_emailed', entityType: 'retreat', entityId: retreat.id, metadata: { sent, failed: failed.length, stopped: Boolean(stopped) } })
    res.json({ sent, failed, stopped, notYet: attendees.length - sent - failed.length })
  }),
)

attendeesRouter.post(
  '/retreats/:retreatId/invites/generate-missing',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const pending = await prisma.attendee.findMany({
      where: { organisationId: t.org.id, retreatId: retreat.id, invitations: { none: {} } },
      orderBy: { name: 'asc' },
    })
    const origin = await siteOrigin(t.org.id)
    const links: Array<{ attendeeId: string; name: string; email: string | null; url: string }> = []
    for (const a of pending) {
      const { token } = await prisma.$transaction((tx) => issueInvitation(tx, { organisationId: t.org.id, attendeeId: a.id, ttlDays: retreat.inviteTtlDays }))
      links.push({ attendeeId: a.id, name: a.name, email: a.email, url: `${origin}/invite/${token}?via=link` })
    }
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'invitation.bulk_issued', entityType: 'retreat', entityId: retreat.id, metadata: { count: links.length } })
    res.json({ links })
  }),
)

attendeesRouter.post(
  '/attendees/:attendeeId/revoke',
  route(async (req, res) => {
    const t = tenantOf(req)
    const attendee = await tenantAttendee(t.org.id, uuidParam(req, 'attendeeId'))
    await prisma.invitation.updateMany({ where: { attendeeId: attendee.id, revokedAt: null }, data: { revokedAt: new Date() } })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'invitation.revoked', entityType: 'attendee', entityId: attendee.id })
    res.json({ ok: true })
  }),
)

/** Corrects a guest's email address (say, after it bounced). Their private link keeps working. */
attendeesRouter.patch(
  '/attendees/:attendeeId',
  route(async (req, res) => {
    const t = tenantOf(req)
    const attendee = await tenantAttendee(t.org.id, uuidParam(req, 'attendeeId'))
    const body = parseBody(z.object({ email: z.email().max(320) }), req.body)
    const email = normaliseEmail(body.email)
    if (email !== attendee.email && (await prisma.attendee.findUnique({ where: { retreatId_email: { retreatId: attendee.retreatId, email } } }))) {
      throw new HttpError(409, 'Another guest on this programme already has that address', { email: ['Already used by another guest'] })
    }
    const updated = await prisma.attendee.update({ where: { id: attendee.id }, data: { email } })
    // A new address isn't proven yet: the review loses its "Verified email" badge until the guest proves it.
    if (email !== attendee.email) await emailChanged(attendee.id)
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'attendee.email_corrected', entityType: 'attendee', entityId: attendee.id })
    const problem = (await suppressedAmong([email])).get(email) ?? null
    res.json({ attendee: { id: updated.id, email: updated.email, emailProblem: problem } })
  }),
)

attendeesRouter.delete(
  '/attendees/:attendeeId',
  route(async (req, res) => {
    const t = tenantOf(req)
    const attendee = await tenantAttendee(t.org.id, uuidParam(req, 'attendeeId'))
    const response = await prisma.response.findUnique({ where: { attendeeId: attendee.id }, select: { status: true } })
    if (response && response.status !== 'draft') throw new HttpError(409, 'This guest has submitted a response; remove it through the retention process instead.')
    await prisma.attendee.delete({ where: { id: attendee.id } })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'attendee.removed', entityType: 'attendee', entityId: attendee.id })
    res.status(204).end()
  }),
)

/** Parties on a retreat where at least one member has sent a review. */
export async function partiesThatReviewed(retreatId: string): Promise<string[]> {
  const rows = await prisma.attendee.findMany({
    where: { retreatId, partyId: { not: null }, response: { submittedAt: { not: null } } },
    select: { partyId: true },
    distinct: ['partyId'],
  })
  return rows.map((r) => r.partyId!)
}

/**
 * Groups guests who came together (a couple, a family) into one party. Anyone already in a party brings
 * their whole party along, so groups merge rather than split.
 */
attendeesRouter.post(
  '/retreats/:retreatId/parties',
  route(async (req, res) => {
    const t = tenantOf(req)
    const retreat = await tenantRetreat(t.org.id, uuidParam(req, 'retreatId'))
    const { attendeeIds } = parseBody(z.object({ attendeeIds: z.array(z.uuid()).min(2, 'Choose at least two guests').max(50) }), req.body)
    const chosen = await prisma.attendee.findMany({ where: { id: { in: attendeeIds }, organisationId: t.org.id, retreatId: retreat.id }, select: { id: true, partyId: true } })
    if (chosen.length !== new Set(attendeeIds).size) throw new HttpError(404, 'Some of those guests aren’t on this list')
    const existing = [...new Set(chosen.map((a) => a.partyId).filter((p): p is string => Boolean(p)))]
    const partyId = existing[0] ?? crypto.randomUUID()
    await prisma.attendee.updateMany({
      where: { retreatId: retreat.id, OR: [{ id: { in: attendeeIds } }, ...(existing.length ? [{ partyId: { in: existing } }] : [])] },
      data: { partyId },
    })
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'attendees.grouped', entityType: 'retreat', entityId: retreat.id, metadata: { count: attendeeIds.length } })
    res.json({ partyId })
  }),
)

/** Takes a guest out of their party (a party of one isn't a party, so the last member leaves too). */
attendeesRouter.delete(
  '/attendees/:attendeeId/party',
  route(async (req, res) => {
    const t = tenantOf(req)
    const attendee = await tenantAttendee(t.org.id, uuidParam(req, 'attendeeId'))
    if (attendee.partyId) {
      await prisma.attendee.update({ where: { id: attendee.id }, data: { partyId: null } })
      const left = await prisma.attendee.findMany({ where: { partyId: attendee.partyId }, select: { id: true } })
      if (left.length === 1) await prisma.attendee.update({ where: { id: left[0].id }, data: { partyId: null } })
      await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'attendees.ungrouped', entityType: 'attendee', entityId: attendee.id })
    }
    res.status(204).end()
  }),
)
