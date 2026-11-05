import { Router } from 'express'
import { z } from 'zod'
import { PROCESSING_TERMS_VERSION, RETENTION_LIMITS, type RetentionKey } from '../../../../shared/legal.js'
import { audit } from '../../lib/audit.js'
import { eraseAttendee, exportGuestData, exportOrganisation } from '../../lib/gdpr.js'
import { parseBody, route, text, uuidParam } from '../../lib/http.js'
import { prisma } from '../../lib/prisma.js'
import { tenantAttendee } from '../../lib/tenant.js'
import { requireOwner, tenantOf } from '../../middleware/auth.js'

/** Controller settings, data-subject requests handled by the organiser, and whole-organisation export. */
export const privacyRouter = Router({ mergeParams: true })

const PRIVACY_FIELDS = {
  legalName: true,
  legalAddress: true,
  privacyEmail: true,
  dpoContact: true,
  contactEmail: true,
  dpaVersion: true,
  dpaAcceptedAt: true,
  draftRetentionDays: true,
  nonResponderRetentionDays: true,
  responseRetentionMonths: true,
  originalPhotoRetentionDays: true,
  anonymousNoteRetentionMonths: true,
  auditRetentionMonths: true,
} as const

privacyRouter.get(
  '/privacy',
  route(async (req, res) => {
    const t = tenantOf(req)
    const org = await prisma.organisation.findUniqueOrThrow({ where: { id: t.org.id }, select: PRIVACY_FIELDS })
    res.json({ settings: org, currentTermsVersion: PROCESSING_TERMS_VERSION, limits: RETENTION_LIMITS })
  }),
)

const retentionShape = Object.fromEntries(
  (Object.keys(RETENTION_LIMITS) as RetentionKey[]).map((k) => [k, z.number().int().min(RETENTION_LIMITS[k].min).max(RETENTION_LIMITS[k].max).optional()]),
) as Record<RetentionKey, z.ZodOptional<z.ZodNumber>>

const privacySchema = z.object({
  legalName: text(200).nullable().optional(),
  legalAddress: text(400).nullable().optional(),
  privacyEmail: z.email().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  dpoContact: text(300).nullable().optional(),
  acceptTerms: z.literal(true).optional(),
  ...retentionShape,
})

privacyRouter.patch(
  '/privacy',
  requireOwner,
  route(async (req, res) => {
    const t = tenantOf(req)
    const { acceptTerms, ...body } = parseBody(privacySchema, req.body)
    const org = await prisma.organisation.update({
      where: { id: t.org.id },
      data: { ...body, ...(acceptTerms ? { dpaVersion: PROCESSING_TERMS_VERSION, dpaAcceptedAt: new Date() } : {}) },
      select: PRIVACY_FIELDS,
    })
    await audit({
      organisationId: t.org.id,
      actorUserId: t.userId,
      actorKind: 'user',
      action: acceptTerms ? 'privacy.terms_accepted' : 'privacy.settings_updated',
      entityType: 'organisation',
      entityId: t.org.id,
      metadata: { fields: Object.keys(body), termsVersion: acceptTerms ? PROCESSING_TERMS_VERSION : undefined },
    })
    res.json({ settings: org })
  }),
)

/** Answer a guest's access request on their behalf (e.g. received by email). */
privacyRouter.get(
  '/attendees/:attendeeId/export',
  route(async (req, res) => {
    const t = tenantOf(req)
    const attendee = await tenantAttendee(t.org.id, uuidParam(req, 'attendeeId'))
    const data = await exportGuestData(t.org.id, attendee.id)
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'guest.exported', entityType: 'attendee', entityId: attendee.id })
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="guest-data-export.json"', 'Cache-Control': 'no-store' })
    res.send(JSON.stringify(data, null, 2))
  }),
)

/** Erase a guest on request. Owners only; the reason is kept in the audit log, the person is not. */
privacyRouter.post(
  '/attendees/:attendeeId/erase',
  requireOwner,
  route(async (req, res) => {
    const t = tenantOf(req)
    const attendee = await tenantAttendee(t.org.id, uuidParam(req, 'attendeeId'))
    const body = parseBody(z.object({ confirm: z.literal('DELETE'), reason: text(300).refine((v) => v.length > 0, 'Give a reason for the audit log') }), req.body)
    await eraseAttendee({ organisationId: t.org.id, attendeeId: attendee.id, actorKind: 'user', actorUserId: t.userId, reason: body.reason })
    res.json({ ok: true })
  }),
)

/** Everything the organisation holds, for its own records or when leaving the platform. */
privacyRouter.get(
  '/export',
  requireOwner,
  route(async (req, res) => {
    const t = tenantOf(req)
    const data = await exportOrganisation(t.org.id)
    await audit({ organisationId: t.org.id, actorUserId: t.userId, actorKind: 'user', action: 'organisation.exported', entityType: 'organisation', entityId: t.org.id })
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${t.org.slug}-export.json"`, 'Cache-Control': 'no-store' })
    res.send(JSON.stringify(data, null, 2))
  }),
)
